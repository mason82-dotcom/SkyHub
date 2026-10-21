'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');
const osd=(timestamp,data)=>parseMessage('thing/product/AIR/osd',
  Buffer.from(JSON.stringify({...(timestamp===null?{}:{timestamp}),data})));

test('field times change only for measurements present in accepted OSD packets',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(t,{latitude:49.1,longitude:8.4,capacity_percent:80,wind_speed:3}),t);
  r.ingest(osd(t+20000,{wind_speed:5,position_state:{is_fixed:0}}),t+20000);
  const d=r.get('AIR',t+20001);
  assert.equal(d.telemetryFieldAt.battery,t);
  assert.equal(d.telemetryFieldAt.windSpeed,t+20000);
  assert.equal(d.telemetryFieldAt.latitude,t);
  assert.equal(d.telemetryFieldAt.longitude,t);
  assert.equal(d.telemetryFieldAt.rtkFixState,t+20000);
  assert.equal(d.lastTelemetryAt,t+20000);
  assert.equal(d.telemetryFieldTimeVerified.windSpeed,true);
});

test('0/0 does not update GPS field times but battery still updates',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(t,{latitude:49,longitude:8,capacity_percent:50}),t);
  assert.equal(r.ingest(osd(t+1000,{latitude:0,longitude:0,capacity_percent:40}),t+1000).point,null);
  const d=r.get('AIR',t+1001);
  assert.equal(d.positionUnavailable,true);
  assert.equal(d.telemetryFieldAt.latitude,t);
  assert.equal(d.telemetryFieldAt.longitude,t);
  assert.equal(d.telemetryFieldAt.battery,t+1000);
  assert.equal(d.telemetry.latitude,49);
  assert.equal(d.telemetry.longitude,8);
});

test('partial GNSS packets do not update coordinates or per-field source times',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(t,{latitude:49,longitude:8}),t);
  r.ingest(osd(t+1000,{latitude:50,capacity_percent:30}),t+1000);
  const d=r.get('AIR',t+1001);
  assert.equal(d.telemetryFieldAt.latitude,t);
  assert.equal(d.telemetryFieldAt.longitude,t);
  assert.equal(d.telemetryFieldAt.battery,t+1000);
  assert.equal(d.telemetry.latitude,49);
});

test('unverified arrival times are recorded explicitly as unverified',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(null,{capacity_percent:0,wind_speed:2}),t);
  const d=r.get('AIR',t+1);
  assert.equal(d.telemetryFieldAt.battery,t);
  assert.equal(d.telemetryFieldAt.windSpeed,t);
  assert.equal(d.telemetryFieldTimeVerified.battery,false);
  assert.equal(d.telemetryFieldTimeVerified.windSpeed,false);
});

test('delayed packets cannot alter per-field freshness and values',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(t+2000,{capacity_percent:42}),t+2000);
  const drop=r.ingest(osd(t+1000,{capacity_percent:99}),t+3000);
  assert.equal(drop.updates.length,0);
  const d=r.get('AIR',t+3001);
  assert.equal(d.telemetryFieldAt.battery,t+2000);
  assert.equal(d.telemetry.battery,42);
});

test('state updates do not update OSD field provenance, snapshots cannot mutate it',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest(osd(t,{capacity_percent:40}),t);
  r.ingest(parseMessage('thing/product/AIR/state',
    Buffer.from(JSON.stringify({timestamp:t+1000,data:{mode_code:5}}))),t+1000);
  const s=r.get('AIR',t+1001);
  assert.equal(s.telemetryFieldAt.battery,t);
  s.telemetryFieldAt.battery=123;
  s.telemetryFieldTimeVerified.battery=false;
  assert.equal(r.get('AIR',t+1001).telemetryFieldAt.battery,t);
  assert.equal(r.get('AIR',t+1001).telemetryFieldTimeVerified.battery,true);
});

test('unexpected telemetry keys cannot enter field maps',()=>{
  const r=createRegistry(),t=1760000000000;
  r.ingest({sn:'AIR',channel:'osd',timestamp:null,telemetry:{
    battery:42,device_secret:'PRIVATE',unknown_metric:3,
    latitude:null,longitude:null
  }},t);
  const d=r.get('AIR',t+1);
  assert.deepEqual(Object.keys(d.telemetryFieldAt),['battery']);
  assert.doesNotMatch(JSON.stringify(d),/PRIVATE|unknown_metric|device_secret/);
});
