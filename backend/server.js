'use strict';
const express=require('express');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const mqtt=require('mqtt');
const Redis=require('ioredis');
const {Pool}=require('pg');
const {Server}=require('socket.io');
const {parseMessage,fresh}=require('./dji');

const secret=process.env.SKYHUB_VIEW_TOKEN;
if(!secret || secret.length<24){
  console.error('SKYHUB_VIEW_TOKEN (minimum 24 characters) is mandatory');
  process.exit(1);
}
const brokerUrl=process.env.MQTT_BROKER_URL;
if(!brokerUrl){
  console.error('MQTT_BROKER_URL must point to an authenticated MQTT broker');
  process.exit(1);
}
const app=express(),server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:131072});
const devices=new Map(),events=[];
let mqttConnected=false;

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
function publicDevice(d){
  return {sn:d.sn,channel:d.channel,lastSeenAt:d.lastSeenAt,
    lastTelemetryAt:d.lastTelemetryAt,fresh:fresh(d.lastTelemetryAt),telemetry:d.telemetry};
}
io.use((socket,next)=>authorized(socket.handshake.auth?.token)?next():next(new Error('Unauthorized')));
io.on('connection',socket=>socket.emit('snapshot',[...devices.values()].map(publicDevice)));

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
  try{
    const parsed=parseMessage(topic,payload);
    if(!parsed)return;
    const now=Date.now(),sn=parsed.sn;
    const d=devices.get(sn)||{sn,telemetry:{latitude:null,longitude:null,altitude:null,battery:null,heading:null},lastTelemetryAt:null};
    d.channel=parsed.channel;
    d.lastSeenAt=now;
    if(parsed.telemetry){
      for(const [k,v] of Object.entries(parsed.telemetry)){
        if(v!==null)d.telemetry[k]=v;
      }
      d.lastTelemetryAt=now;
    }
    if(!devices.has(sn)&&devices.size>=200)devices.delete(devices.keys().next().value);
    devices.set(sn,d);
    const item=publicDevice(d);
    io.emit('device_update',item);
    redis.set('skyhub:device:'+sn,JSON.stringify(item),'EX',3600)
      .catch(err=>console.error('[redis write]',err.message));
    if(pool && parsed.channel==='osd' && parsed.telemetry
      && parsed.telemetry.latitude!==null && parsed.telemetry.longitude!==null){
      const t=parsed.telemetry;
      pool.query('INSERT INTO drone_telemetry (gateway_sn,latitude,longitude,altitude,battery_percentage,geom) '+
        'VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($3,$2),4326))',
        [sn,t.latitude,t.longitude,t.altitude,t.battery]
      ).catch(err=>console.error('[postgres insert]',err.message));
    }
    if(['events','status','services_reply'].includes(parsed.channel)){
      const event={sn,channel:parsed.channel,method:parsed.method,at:now};
      events.unshift(event);
      if(events.length>100)events.pop();
      io.emit('device_event',event);
    }
  }catch(err){console.error('[mqtt message rejected]',err.message);}
}

const options={clientId:'skyhub_next_readonly_'+process.pid,protocolVersion:5,
  reconnectPeriod:3000,connectTimeout:10000};
if(process.env.MQTT_USER)options.username=process.env.MQTT_USER;
if(process.env.MQTT_PASSWORD)options.password=process.env.MQTT_PASSWORD;
const client=mqtt.connect(brokerUrl,options);
client.on('connect',()=>{
  mqttConnected=true;
  console.log('[mqtt] connected; subscribing read-only');
  client.subscribe([
    'sys/product/+/status','thing/product/+/osd','thing/product/+/state',
    'thing/product/+/events','thing/product/+/services_reply'
  ],{qos:0},err=>{if(err)console.error('[mqtt subscribe]',err.message);});
});
client.on('close',()=>{mqttConnected=false;});
client.on('error',err=>console.error('[mqtt]',err.message));
client.on('message',onMessage);

app.get('/api/health',(req,res)=>res.json({
  status:mqttConnected?'online':'degraded',mqtt:mqttConnected,
  redis:redis.status==='ready',devices:devices.size,readOnly:true
}));
app.use('/api',auth);
app.get('/api/devices',(req,res)=>res.json([...devices.values()].map(publicDevice)));
app.get('/api/events',(req,res)=>res.json(events));
app.get('/api/drone/:sn/telemetry',(req,res)=>{
  const d=devices.get(req.params.sn);
  if(!d)return res.status(404).json({error:'Device not observed'});
  res.json(publicDevice(d));
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
