'use strict';
// DJI Cloud API topic and envelope parsing. Missing telemetry stays null.
function finite(value,min=-Infinity,max=Infinity){
  return typeof value === 'number' && Number.isFinite(value) && value>=min && value<=max ? value : null;
}
function parseTopic(topic){
  const match=/^(thing|sys)\/product\/([^/]{1,100})\/(osd|state|events|services_reply|status)$/.exec(topic);
  if(!match || (match[1]==='sys' && match[3]!=='status') ||
    (match[1]==='thing' && match[3]==='status')) return null;
  return {source:match[1],sn:match[2],channel:match[3]};
}
function extractTelemetry(p){
  if(!p || typeof p!=='object' || Array.isArray(p)) return null;
  const nested=p.battery && typeof p.battery==='object' ? p.battery : {};
  const bat=Array.isArray(nested.batteries) ? nested.batteries[0]?.capacity_percent : null;
  return {
    latitude:finite(p.latitude,-90,90),
    longitude:finite(p.longitude,-180,180),
    altitude:finite(p.height ?? p.altitude ?? p.height_above_takeoff),
    battery:finite(p.battery_percentage ?? p.capacity_percent ?? nested.capacity_percent ?? bat,0,100),
    heading:finite(p.attitude_head ?? p.heading,-360,360)
  };
}
function parseMessage(topic,raw){
  const meta=parseTopic(topic);if(!meta)return null;
  if(!raw || raw.length>131072)throw new Error('Invalid MQTT payload length');
  const envelope=JSON.parse(raw.toString('utf8'));
  if(!envelope || typeof envelope!=='object' || Array.isArray(envelope))throw new Error('Invalid DJI envelope');
  return {...meta,method:typeof envelope.method==='string'?envelope.method:null,
    telemetry:meta.channel==='osd'?extractTelemetry(envelope.data):null};
}
function fresh(last,now=Date.now()){
  return Number.isFinite(last) && last<=now && now-last<15000;
}
module.exports={finite,parseTopic,extractTelemetry,parseMessage,fresh};
