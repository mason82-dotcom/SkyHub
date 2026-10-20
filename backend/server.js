'use strict';
const express=require('express');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const mqtt=require('mqtt');
const Redis=require('ioredis');
const {Pool}=require('pg');
const {Server}=require('socket.io');
const {parseMessage}=require('./dji');
const {validateBrokerConfig}=require('./mqtt-config');
const {createMqttMetrics}=require('./mqtt-metrics');
const {createRegistry}=require('./registry');
const {pilotConfiguration}=require('./pilot-config');

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
const app=express(),server=http.createServer(app);
// The pilot page must only be exposed through a trusted HTTPS reverse proxy.
// Docker publishes SkyHub Next to host loopback by default.
app.set('trust proxy',['loopback','linklocal','uniquelocal']);
const io=new Server(server,{maxHttpBufferSize:131072});
const registry=createRegistry();
let mqttConnected=false;
let mqttSubscribed=false;
const mqttStats=createMqttMetrics();

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
function auth(req,res,next){
  const hdr=req.headers.authorization||'';
  if(!authorized(hdr.startsWith('Bearer ')?hdr.slice(7):'')){
    return res.status(401).json({error:'Unauthorized'});
  }
  next();
}
io.use((socket,next)=>authorized(socket.handshake.auth?.token)?next():next(new Error('Unauthorized')));
io.on('connection',socket=>socket.emit('snapshot',registry.snapshot()));

const redis=new Redis(process.env.REDIS_URL||'redis://redis:6379',{
  lazyConnect:true,maxRetriesPerRequest:1,
  retryStrategy:attempts=>Math.min(attempts*1000,5000)
});
redis.on('error',err=>console.error('[redis]',err.message));
redis.connect().catch(err=>console.error('[redis connect]',err.message));
const pool=process.env.DATABASE_URL?
  new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000}):null;
if(pool)pool.on('error',err=>console.error('[postgres]',err.message));

function onMessage(topic,payload){
  try {
    const parsed=parseMessage(topic,payload);
    if(!parsed)return;
    const observedAt=Date.now();
    const result=registry.ingest(parsed,observedAt);
    mqttStats.accepted(parsed,result,observedAt);
    for(const item of result.updates){
      io.emit('device_update',item);
      redis.set('skyhub:device:'+item.sn,JSON.stringify(item),'EX',3600)
        .catch(err=>console.error('[redis write]',err.message));
    }
    if(result.event)io.emit('device_event',result.event);
    if(pool && result.point){
      const p=result.point;
      pool.query(
        'INSERT INTO drone_telemetry (gateway_sn,device_sn,latitude,longitude,altitude,battery_percentage,geom) '+
        'VALUES ($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_MakePoint($4,$3),4326))',
        [p.gatewaySn,p.deviceSn,p.latitude,p.longitude,p.altitude,p.battery]
      ).catch(err=>console.error('[postgres insert]',err.message));
    }
  }catch(err){ mqttStats.rejected();console.error('[mqtt message rejected]',err.message); }
}

const options={clientId:'skyhub_next_readonly_'+process.pid,protocolVersion:5,
  reconnectPeriod:3000,connectTimeout:10000};
if(process.env.MQTT_USER)options.username=process.env.MQTT_USER;
if(process.env.MQTT_PASSWORD)options.password=process.env.MQTT_PASSWORD;
const client=mqtt.connect(broker.url,options);
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

// DJl Pilot 2 entry point is a real H5 page rather than the legacy 404.
// By default it is a read-only readiness page; no MQTT credentials are exposed.
app.get('/pilot-login',(req,res)=>{
  res.set('Cache-Control','no-store');
  res.sendFile(path.resolve(__dirname,'../frontend/public/pilot-login.html'));
});
app.get('/api/pilot/status',(req,res)=>res.json({
  configured:pilot.ready,missing:pilot.missing,
  mqttPort:1884,requiresHttps:true
}));
app.post('/api/pilot/bootstrap',(req,res)=>{
  if(!pilot.ready)return res.status(503).json({error:'Pilot 2 not configured'});
  if(!req.secure)return res.status(403).json({error:'HTTPS required'});
  // Credentials are issued only after separate strong Pilot access token validation.
  const hdr=req.headers.authorization||'';
  const token=hdr.startsWith('Bearer ')?hdr.slice(7):'';
  const a=Buffer.from(token),b=Buffer.from(pilot.accessToken);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){
    return res.status(401).json({error:'Unauthorized'});
  }
  res.set('Cache-Control','no-store');
  res.json(pilot.bootstrap());
});

app.get('/api/health',(req,res)=>res.json({
  status:mqttConnected&&mqttSubscribed?'online':'degraded',mqtt:mqttConnected,
  subscribed:mqttSubscribed,redis:redis.status==='ready',devices:registry.count(),readOnly:true,
  mqttBrokerPort:broker.port,...mqttStats.snapshot()
}));
app.use('/api',auth);
app.get('/api/devices',(req,res)=>res.json(registry.snapshot()));
app.get('/api/topology',(req,res)=>res.json(registry.snapshot().map(d=>({sn:d.sn,role:d.role,gatewaySn:d.gatewaySn,model:d.model,topologyOnline:d.topologyOnline,children:d.children}))));
app.get('/api/events',(req,res)=>res.json(registry.events()));
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
server.listen(port,'0.0.0.0',()=>console.log('[skyhub] Port '+port+' / read-only'));
function stop(){
  client.end(true);io.close();server.close();
  redis.disconnect();if(pool)pool.end().catch(()=>{});
}
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
