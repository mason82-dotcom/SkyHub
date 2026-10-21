'use strict';
const express=require('express');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const mqtt=require('mqtt');
const Redis=require('ioredis');
const {Pool}=require('pg');
const {Server}=require('socket.io');
const {parseMessage,serial}=require('./dji');
const {fieldDefinitions}=require('./dji-properties');
const {classifyMessage}=require('./message-guard');
const {validateBrokerConfig}=require('./mqtt-config');
const {createMqttMetrics}=require('./mqtt-metrics');
const {createShapeCatalog}=require('./mqtt-shape');
const {createRegistry}=require('./registry');
const {pilotConfiguration}=require('./pilot-config');
const {createStatusReply}=require('./topology-ack');
const {createPilotPairing,redisStore}=require('./pilot-pairing');
const {createTopologyStore}=require('./topology-store');
const {createLanAccess}=require('./lan-access');
const {createTrackPolicy}=require('./track-policy');
const {createTrackStore,retentionDays}=require('./track-store');
const {createTrackRecorder}=require('./track-recorder');
const {createMapElementStore}=require('./map-element-store');
const {createMapElementHandler}=require('./map-element-api');
const {mapPrincipal}=require('./map-element-permissions');

const secret=process.env.SKYHUB_VIEW_TOKEN;
if(!secret || secret.length<24 || secret.startsWith('REPLACE_')){
  console.error('SKYHUB_VIEW_TOKEN (minimum 24 characters) is mandatory');
  process.exit(1);
}
let broker;
try {
  broker=validateBrokerConfig(process.env.MQTT_BROKER_URL,process.env.SKYHUB_MQTT_REQUIRED_PORT);
} catch(err) {
  console.error('[mqtt config]',err.message);
  process.exit(1);
}
const pilot=pilotConfiguration(process.env);
let lanAccess,trackRetentionDays;
try {
  lanAccess=createLanAccess(process.env.SKYHUB_LAN_VIEW_CIDR);
  trackRetentionDays=retentionDays(process.env.SKYHUB_TRACK_RETENTION_DAYS);
} catch(err) {
  console.error('[config]',err.message);
  process.exit(1);
}
const app=express(),server=http.createServer(app);
// Do not trust forged X-Forwarded-Proto when SkyHub occupies the legacy LAN port.
// Trust proxy headers only when the backend is published exclusively on loopback.
if(['127.0.0.1','::1'].includes(process.env.SKYHUB_BIND_ADDRESS||'127.0.0.1')){
  app.set('trust proxy',['loopback','linklocal','uniquelocal']);
}
const io=new Server(server,{maxHttpBufferSize:131072});
const registry=createRegistry();
let mqttConnected=false;
let mqttSubscribed=false;
const mqttStats=createMqttMetrics();
const mqttShapes=createShapeCatalog();
const topologyAckEnabled=process.env.SKYHUB_TOPOLOGY_ACK_ENABLED==='true';
const topologyAckCredentials={
  username:process.env.SKYHUB_TOPOLOGY_ACK_MQTT_USER||'',
  password:process.env.SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD||''
};
// A dedicated, ACL-restricted publisher is required; read-only credentials remain unchanged.
if(topologyAckEnabled && (!topologyAckCredentials.username ||
    !topologyAckCredentials.password ||
    topologyAckCredentials.username.startsWith('REPLACE_') ||
    topologyAckCredentials.password.startsWith('REPLACE_'))){
  console.error('[topology ack] dedicated publisher credentials are required');
  process.exit(1);
}
let topologyAckConnected=false;
let topologyAckSent=0;
let topologyAckFailed=0;
let topologyAckSkipped=0;
let topologyAckLastAt=null;
let topologyAckClient=null;
// Last successful status_reply per gateway, so Pilot 2 can detect an unacknowledged session.
const topologyAcks=new Map();

app.disable('x-powered-by');
app.use(express.json({limit:'128kb'}));
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','no-referrer');
  res.set('Cache-Control','no-store');
  next();
});
function authorized(value){
  if(typeof value!=='string')return false;
  const a=Buffer.from(value),b=Buffer.from(secret);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
// Token-free viewing from the configured home LAN: read-only, never pairing administration.
const lanReadPaths=new Set(['/devices','/topology','/events','/diagnostics/mqtt-shapes']);
function lanView(req){
  const readPath=lanReadPaths.has(req.path) || /^\/drone\/[^/]+\/(track|telemetry)$/.test(req.path);
  return req.method==='GET' && readPath &&
    lanAccess.allows(req.socket.remoteAddress,req.headers['x-forwarded-for']);
}
function auth(req,res,next){
  const hdr=req.headers.authorization||'';
  if(lanView(req))return next();
  if(!authorized(hdr.startsWith('Bearer ')?hdr.slice(7):'')){
    return res.status(401).json({error:'Unauthorized'});
  }
  next();
}
io.use((socket,next)=>authorized(socket.handshake.auth?.token) ||
  lanAccess.allows(socket.request.socket.remoteAddress,socket.handshake.headers['x-forwarded-for'])
  ?next():next(new Error('Unauthorized')));
io.on('connection',socket=>socket.emit('snapshot',registry.snapshot()));

const redis=new Redis(process.env.REDIS_URL||'redis://redis:6379',{
  lazyConnect:true,maxRetriesPerRequest:1,
  retryStrategy:attempts=>Math.min(attempts*1000,5000)
});
redis.on('error',err=>console.error('[redis]',err.message));
const topologyStore=createTopologyStore(redis);
let topologyRestored=0;
redis.connect()
  .then(()=>topologyStore.load())
  .then(records=>{
    topologyRestored=registry.restoreTopology(records);
    // Count only; never log serial numbers.
    if(topologyRestored)console.log('[topology] restored '+topologyRestored+' devices from Redis');
  })
  .catch(err=>console.error('[redis connect]',err.message));
const pairing=createPilotPairing({store:redisStore(redis),workspaceId:pilot.workspaceId});
const pool=process.env.DATABASE_URL?
  new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000}):null;
if(pool)pool.on('error',err=>console.error('[postgres]',err.message));
const trackPolicy=createTrackPolicy();
const trackStore=createTrackStore(pool);
// Historical GPS recording is opt-in; live DJI telemetry remains available.
const trackRecordingEnabled=process.env.SKYHUB_TRACK_RECORDING_ENABLED==='true';
const trackRecorder=createTrackRecorder({store:trackStore,policy:trackPolicy,enabled:Boolean(pool),
  recordingEnabled:trackRecordingEnabled,
  onWriteError:()=>console.error('[postgres insert] failed')});
async function pruneTracks(){
  try{
    const removed=await trackRecorder.prune(trackRetentionDays);
    if(removed)console.log('[track] removed '+removed+' points older than '+trackRetentionDays+' days');
  }catch(err){console.error('[track prune]',err.message);}
}
async function initializeTracks(){
  if(!pool || trackRecorder.snapshot().postgresMigrationReady)return;
  try{await trackRecorder.migrate();await pruneTracks();}
  catch(_err){console.error('[track migrate] failed; will retry');}
}
initializeTracks();
setInterval(initializeTracks,60000).unref();
setInterval(pruneTracks,3600000).unref();

function onMessage(topic,payload,packet){
  // Passive transport diagnostics, without recording device IDs or payloads.
  mqttStats.observed(topic);
  // A retained MQTT delivery is not evidence of a currently connected DJI device.
  if(packet?.retain===true){mqttStats.rejected('retained');return;}
  try {
    const parsed=parseMessage(topic,payload);
    if(!parsed)return;
    const observedAt=Date.now();
    mqttShapes.record(parsed,observedAt);
    const decision=classifyMessage(parsed,packet,observedAt);
    if(!decision.accept){mqttStats.rejected(decision.reason);return;}
    const result=registry.ingest(parsed,observedAt);
    if(result.dropReason){mqttStats.rejected(result.dropReason);return;}
    mqttStats.accepted(parsed,result,observedAt);
    // DJI topology acknowledgement is a protocol reply, never a flight command.
    // Only send for a validated, accepted, non-retained update_topo message.
    if(topologyAckEnabled && parsed.channel==='status' && parsed.topology){
      const reply=createStatusReply(parsed,payload,observedAt);
      if(reply && topologyAckClient && topologyAckConnected){
        topologyAckClient.publish(reply.topic,reply.payload,{qos:1,retain:false},err=>{
          if(err){topologyAckFailed++;console.error('[topology ack] publish failed');}
          else {
            topologyAckSent++;topologyAckLastAt=Date.now();
            if(topologyAcks.size>=200 && !topologyAcks.has(parsed.sn))
              topologyAcks.delete(topologyAcks.keys().next().value);
            topologyAcks.set(parsed.sn,topologyAckLastAt);
          }
        });
      }else{
        // Without status_reply Pilot 2 keeps resending update_topo and withholds OSD.
        topologyAckSkipped++;
        console.error('[topology ack] skipped: '+(reply?'publisher not connected':'reply validation failed'));
      }
    }
    for(const item of result.updates){
      io.emit('device_update',item);
      redis.set('skyhub:device:'+item.sn,JSON.stringify(item),'EX',3600)
        .catch(err=>console.error('[redis write]',err.message));
    }
    if(result.event)io.emit('device_event',result.event);
    if(result.topologyChanged){
      topologyStore.save(registry.topologyRecords(result.updates.map(item=>item.sn)))
        .catch(err=>console.error('[redis topology]',err.message));
    }
    // Persist only movement or a 60 s heartbeat, never 0/0 without a fix (track-policy.js).
    if(pool && trackRecordingEnabled && result.point){
      const sampleAt=parsed.timestamp===null?observedAt:Math.min(parsed.timestamp,observedAt);
      const t=parsed.telemetry;
      trackRecorder.record(result.point,sampleAt,{sourceTs:sampleAt,timeVerified:parsed.timestamp!==null,
        heightEllipsoid:t.heightEllipsoid,gpsSatellites:t.gpsSatellites,rtkSatellites:t.rtkSatellites,
        rtkFixState:t.rtkFixState,positionQuality:t.positionQuality});
    }
  }catch(_err){
    // Parsing errors may contain snippets of sensitive DJI messages. Never log them.
    mqttStats.rejected('malformed');
    console.error('[mqtt message rejected] malformed DJI message');
  }
}

const options={clientId:'skyhub_next_readonly_'+process.pid,protocolVersion:5,
  reconnectPeriod:3000,connectTimeout:10000};
if(process.env.MQTT_USER)options.username=process.env.MQTT_USER;
if(process.env.MQTT_PASSWORD)options.password=process.env.MQTT_PASSWORD;
const client=mqtt.connect(broker.url,options);
if(topologyAckEnabled){
  topologyAckClient=mqtt.connect(broker.url,{
    clientId:'skyhub_next_topology_ack_'+process.pid,
    protocolVersion:5,reconnectPeriod:3000,connectTimeout:10000,
    username:topologyAckCredentials.username,
    password:topologyAckCredentials.password
  });
  topologyAckClient.on('connect',()=>{topologyAckConnected=true;});
  topologyAckClient.on('close',()=>{topologyAckConnected=false;});
  topologyAckClient.on('error',()=>{topologyAckFailed++;console.error('[topology ack] broker connection failed');});
}
client.on('connect',()=>{
  mqttConnected=true;
  mqttStats.connected();
  mqttSubscribed=false;
  console.log('[mqtt] connected; subscribing read-only');
  client.subscribe([
    'sys/product/+/status','thing/product/+/osd','thing/product/+/state',
    'thing/product/+/events','thing/product/+/services_reply'
  ],{qos:0},(err,granted)=>{
    mqttSubscribed = !err && Array.isArray(granted) && granted.length===5 &&
      granted.every(item=>item.qos!==128);
    if(!mqttSubscribed)console.error('[mqtt subscribe] subscriptions not confirmed');
  });
});
client.on('close',()=>{mqttConnected=false;mqttSubscribed=false;mqttStats.disconnected();});
client.on('error',err=>console.error('[mqtt]',err.message));
client.on('message',onMessage);

// Existing DJI Pilot 2 URL /pilot-login now resolves when v3 takes over port 4000.
// Login/bootstrap remains opt-in; secret provisioning is forbidden over plaintext HTTP.
app.get('/pilot-login',(req,res)=>{
  res.set('Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.sendFile(path.resolve(__dirname,'../frontend/public/pilot-login.html'));
});
app.get('/api/pilot/status',(req,res)=>res.json({
  configured:pilot.ready,missing:pilot.missing,mqttPort:1884,requiresHttps:true
}));
function pilotGuard(req,res){
  if(!pilot.ready){res.status(503).json({error:'Pilot 2 not configured'});return false;}
  if(!req.secure){res.status(403).json({error:'HTTPS required'});return false;}
  return true;
}
// Accepts the shared operator access token or a paired device token.
async function pilotAuthorized(req){
  const hdr=req.headers.authorization||'';
  const token=hdr.startsWith('Bearer ')?hdr.slice(7):'';
  return pilotAuthorizedToken(token);
}
async function pilotAuthorizedToken(token){
  if(typeof token!=='string')return false;
  const a=Buffer.from(token),b=Buffer.from(pilot.accessToken);
  if(a.length===b.length && crypto.timingSafeEqual(a,b))return true;
  if(redis.status!=='ready')return false;
  return Boolean(await pairing.verify(token));
}
// Map scope is distinct from bootstrap/session access. A previously paired RC
// without stored workspace binding can still bootstrap, but cannot read any
// map groups until it is paired again for this workspace.
async function mapElementPrincipal(token){
  if(typeof token!=='string'||!token)return null;
  const a=Buffer.from(token),b=Buffer.from(pilot.accessToken);
  if(a.length===b.length&&crypto.timingSafeEqual(a,b))
    return mapPrincipal('pilot',pilot.workspaceId);
  if(redis.status!=='ready')return null;
  const device=await pairing.verify(token);
  return device&&device.workspaceId===pilot.workspaceId?
    mapPrincipal('pilot',device.workspaceId):null;
}
if(process.env.SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'&&pilot.ready){
  app.get('/map/api/v1/workspaces/:workspaceId/element-groups',createMapElementHandler({
    store:pool?createMapElementStore(pool):null,
    workspaceId:pilot.workspaceId,
    authorize:mapElementPrincipal
  }));
}else if(process.env.SKYHUB_DJI_MAP_ELEMENTS_ENABLED==='true'){
  console.error('[map elements] disabled: Pilot 2 configuration is incomplete');
}
app.post('/api/pilot/bootstrap',async(req,res)=>{
  if(!pilotGuard(req,res))return;
  try{
    if(!await pilotAuthorized(req))return res.status(401).json({error:'Unauthorized'});
    res.json(pilot.bootstrap());
  }catch(_err){res.status(503).json({error:'Pilot authorization unavailable'});}
});
// Pairing: unauthenticated start/poll over HTTPS; approval requires the view token.
app.post('/api/pilot/pair',(req,res)=>{
  if(!pilotGuard(req,res))return;
  if(redis.status!=='ready')return res.status(503).json({error:'Pairing store unavailable'});
  const userAgent=String(req.headers['user-agent']||'').slice(0,300);
  const started=pairing.start(userAgent,Date.now(),req.ip+'|'+userAgent);
  if(!started)return res.status(429).json({error:'Too many pending pairings'});
  console.log('[pilot pairing] code issued; approve with scripts/pi-pilot-pair.js');
  res.json(started);
});
app.get('/api/pilot/pair/:id',async(req,res)=>{
  if(!pilotGuard(req,res))return;
  try{
    const result=await pairing.poll(req.params.id);
    if(result.status==='approved')console.log('[pilot pairing] device paired');
    res.json(result);
  }catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
});
// Lets the Pilot page see whether SkyHub acknowledged this RC's topology.
app.get('/api/pilot/session',async(req,res)=>{
  if(!pilotGuard(req,res))return;
  try{
    if(!await pilotAuthorized(req))return res.status(401).json({error:'Unauthorized'});
  }catch(_err){return res.status(503).json({error:'Pilot authorization unavailable'});}
  const gateway=serial(req.query.gateway);
  const device=gateway?registry.get(gateway):null;
  res.json({
    topologyReplyEnabled:topologyAckEnabled,
    topologyAckAt:gateway?topologyAcks.get(gateway)??null:null,
    lastTopologyAt:device?.lastTopologyAt??null,
    lastTelemetryAt:device?.lastTelemetryAt??null
  });
});

app.get('/api/health',(req,res)=>res.json({
  status:mqttConnected&&mqttSubscribed?'online':'degraded',mqtt:mqttConnected,
  subscribed:mqttSubscribed,redis:redis.status==='ready',devices:registry.count(),readOnly:true,
  mqttBrokerPort:broker.port,topologyReplyEnabled:topologyAckEnabled,
  topologyReplyConnected:topologyAckConnected,topologyReplySent:topologyAckSent,
  topologyReplyErrors:topologyAckFailed,topologyReplySkipped:topologyAckSkipped,
  topologyReplyLastAt:topologyAckLastAt,topologyRestoredDevices:topologyRestored,
  lanViewEnabled:lanAccess.enabled,...trackRecorder.snapshot(),
  trackRetentionDays,...mqttStats.snapshot()
}));
app.use('/api',auth);
app.get('/api/devices',(req,res)=>res.json(registry.snapshot()));
app.get('/api/topology',(req,res)=>res.json(registry.snapshot().map(d=>({sn:d.sn,role:d.role,gatewaySn:d.gatewaySn,model:d.model,topologyOnline:d.topologyOnline,
  lastTopologyAt:d.lastTopologyAt,topologyTimeVerified:d.topologyTimeVerified,children:d.children}))));
app.get('/api/events',(req,res)=>res.json(registry.events()));
// Pairing administration: loopback/SSH tunnel only (not routed by Caddy) plus view token.
app.get('/api/pilot-admin/pairings',async(req,res)=>{
  try{res.json({pending:pairing.pending(),devices:await pairing.devices()});}
  catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
});
app.post('/api/pilot-admin/approve',(req,res)=>{
  if(!pairing.approve(req.body?.code))return res.status(404).json({error:'No pending pairing with this code'});
  console.log('[pilot pairing] code approved');
  res.json({approved:true});
});
app.delete('/api/pilot-admin/devices/:id',async(req,res)=>{
  try{
    if(!await pairing.revoke(req.params.id))return res.status(404).json({error:'Unknown device'});
    res.json({revoked:true});
  }catch(_err){res.status(503).json({error:'Pairing store unavailable'});}
});
// Field names per channel/method as actually received; no values or serial numbers.
app.get('/api/diagnostics/mqtt-shapes',(req,res)=>res.json(mqttShapes.snapshot()));
// Authenticated, value-free property definitions for the six targeted devices.
// Example: /api/diagnostics/dji-fields?model=0:77:2
app.get('/api/diagnostics/dji-fields',(req,res)=>{
  const key=req.query.model;
  if (typeof key!=='string' || !/^[02]:\\d{1,3}:\\d{1,3}$/.test(key))
    return res.status(400).json({error:'Expected domain:type:sub_type'});
  const [domain,type,subType]=key.split(':');
  const schema=fieldDefinitions({domain,type:Number(type),subType:Number(subType)});
  if (!schema) return res.status(404).json({error:'Model not in schema catalogue'});
  return res.json(schema);
});
// Persisted track for the map: newest points within ?minutes (1-1440, default 60).
app.get('/api/drone/:sn/track',async(req,res)=>{
  const sn=serial(req.params.sn);
  if(!sn)return res.status(400).json({error:'Invalid serial'});
  try{res.json(await trackStore.track(sn,req.query.minutes));}
  catch(_err){res.status(503).json({error:'Track history unavailable'});}
});
app.get('/api/drone/:sn/telemetry',(req,res)=>{
  const d=registry.get(req.params.sn);
  if(!d)return res.status(404).json({error:'Device not observed'});
  res.json(d);
});
app.post('/api/mission/create',(req,res)=>res.status(501).json({
  error:'DJI mission dispatch is disabled pending protocol and hardware validation'
}));
app.use(express.static(path.resolve(__dirname,'../frontend/public'),{index:'index.html'}));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
const port=Number(process.env.PORT||4000);
const listenAddress=process.env.NODE_ENV==='test'?'127.0.0.1':'0.0.0.0';
server.listen(port,listenAddress,()=>console.log('[skyhub] Port '+server.address().port+' / read-only'));
function stop(){
  client.end(true);if(topologyAckClient)topologyAckClient.end(true);
  io.close();server.close();
  redis.disconnect();if(pool)pool.end().catch(()=>{});
}
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
module.exports={server,stop};
