'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

function receive(sn,stamp,data) {
  return parseMessage('thing/product/'+sn+'/osd',
    Buffer.from(JSON.stringify(stamp===null?{data}:{timestamp:stamp,data})));
}
const t=1760000000000;

test('each OSD field is refreshed only by its own normalized sample',()=>{
  const registry=createRegistry();
  registry.ingest(receive('AIR01',t+1000,{latitude:49,longitude:8,
    capacity_percent:52,horizontal_speed:0,position_state:{is_fixed:0}}),t+1000);
  registry.ingest(receive('AIR01',t+2000,{capacity_percent:51,wind_speed:3.6}),t+2000);
  const d=registry.get('AIR01',t+2001);
  assert.equal(d.lastTelemetryAt,t+2000);
  assert.equal(d.lastPositionAt,t+1000);
  assert.equal(d.telemetryFieldAt.battery,t+2000);
  assert.equal(d.telemetryFieldAt.windSpeed,t+2000);
  assert.equal(d.telemetryFieldAt.latitude,t+1000);
  assert.equal(d.telemetryFieldAt.longitude,t+1000);
  assert.equal(d.telemetryFieldAt.horizontalSpeed,t+1000);
  assert.equal(d.telemetryFieldAt.rtkFixState,t+1000);
  assert.equal(d.telemetryFieldTimeVerified.battery,true);
  assert.equal(d.telemetryFieldTimeVerified.latitude,true);
  assert.equal(d.telemetryFieldAt.heading,undefined);
  assert.equal(d.telemetry.horizontalSpeed,0);
  assert.equal(d.telemetry.rtkFixState,0);
});

test('null position and incomplete GPS readings preserve the last true GPS timestamp',()=>{
  const registry=createRegistry();
  registry.ingest(receive('AIR01',t+1000,{
    latitude:49.2,longitude:8.4,battery_percentage:60}),t+1000);
  const zero=registry.ingest(receive('AIR01',t+2000,{
    latitude:0,longitude:0,battery_percentage:59}),t+2000);
  assert.equal(zero.point,null);
  registry.ingest(receive('AIR01',t+3000,{
    latitude:49.3,capacity_percent:58}),t+3000);
  const d=registry.get('AIR01',t+3001);
  assert.equal(d.positionUnavailable,true);
  assert.equal(d.positionFresh,false);
  assert.equal(d.telemetry.latitude,49.2);
  assert.equal(d.telemetry.longitude,8.4);
  assert.equal(d.telemetryFieldAt.latitude,t+1000);
  assert.equal(d.telemetryFieldAt.longitude,t+1000);
  assert.equal(d.telemetryFieldAt.battery,t+3000);
  assert.equal(d.lastPositionAt,t+1000);
  assert.equal(d.lastTelemetryAt,t+3000);
});

test('partial-only, empty and out-of-range OSD packets do not invent timestamps',()=>{
  const registry=createRegistry();
  registry.ingest(receive('AIR01',t+1000,{latitude:49}),t+1000);
  let d=registry.get('AIR01',t+1001);
  assert.equal(d.lastTelemetryAt,null);
  assert.deepEqual(d.telemetryFieldAt,{});
  registry.ingest(receive('AIR01',t+2000,{latitude:99,longitude:181}),t+2000);
  registry.ingest(receive('AIR01',t+3000,{}),t+3000);
  d=registry.get('AIR01',t+3001);
  assert.equal(d.lastTelemetryAt,null);
  assert.equal(d.lastPositionAt,null);
  assert.deepEqual(d.telemetryFieldAt,{});
});

test('0 is observed; invalid readings and replayed packets never overwrite field ages',()=>{
  const registry=createRegistry();
  registry.ingest(receive('AIR01',t+2000,{battery_percentage:0,
    position_state:{is_fixed:0},wind_speed:-3,heading:'bad'}),t+2000);
  const dropped=registry.ingest(receive('AIR01',t+1000,{battery_percentage:99}),t+2100);
  assert.equal(dropped.dropReason,'duplicate');
  const d=registry.get('AIR01',t+2101);
  assert.equal(d.telemetry.battery,0);
  assert.equal(d.telemetryFieldAt.battery,t+2000);
  assert.equal(d.telemetryFieldAt.rtkFixState,t+2000);
  assert.equal(d.telemetryFieldAt.windSpeed,undefined);
  assert.equal(d.telemetryFieldAt.heading,undefined);
});

test('unverified device timestamp is recorded as arrival time and marked unverified',()=>{
  const registry=createRegistry();
  registry.ingest(receive('RC01',null,{
    capacity_percent:50,wireless_link:{sdr_quality:3}}),t+1000);
  let d=registry.get('RC01',t+1001);
  assert.equal(d.telemetryFieldAt.battery,t+1000);
  assert.equal(d.telemetryFieldTimeVerified.battery,false);
  assert.equal(d.telemetryFieldTimeVerified.linkQuality,false);
  registry.ingest(receive('RC01',t+2000,{capacity_percent:48}),t+2000);
  const rejected=registry.ingest(receive('RC01',null,{capacity_percent:47}),t+3000);
  assert.equal(rejected.dropReason,'missing_timestamp_after_verified');
  d=registry.get('RC01',t+3001);
  assert.equal(d.telemetryFieldAt.battery,t+2000);
  assert.equal(d.telemetryFieldTimeVerified.battery,true);
  assert.equal(d.telemetryFieldAt.linkQuality,t+1000);
  assert.equal(d.telemetryFieldTimeVerified.linkQuality,false);
});

test('state and disconnection do not refresh OSD field ages',()=>{
  const registry=createRegistry();
  registry.ingest(receive('AIR01',t+1000,{
    latitude:49,longitude:8,capacity_percent:30}),t+1000);
  const state=parseMessage('thing/product/AIR01/state',Buffer.from(JSON.stringify({
    timestamp:t+2000,data:{firmware_version:'2.0.0'}})));
  registry.ingest(state,t+2000);
  const d=registry.get('AIR01',t+2001);
  assert.equal(d.telemetryFieldAt.battery,t+1000);
  assert.equal(d.telemetryFieldAt.latitude,t+1000);
  assert.equal(d.telemetryFieldAt.firmwareVersion,undefined);
  const copy=registry.get('AIR01',t+2001);
  copy.telemetryFieldAt.battery=999;
  copy.telemetryFieldTimeVerified.battery=false;
  assert.equal(registry.get('AIR01',t+2001).telemetryFieldAt.battery,t+1000);
  assert.equal(registry.get('AIR01',t+2001).telemetryFieldTimeVerified.battery,true);
});

test('RC and aircraft maintain independent field timestamp dictionaries',()=>{
  const registry=createRegistry();
  registry.ingest(receive('RC01',t+1000,{capacity_percent:85}),t+1000);
  registry.ingest(receive('AIR01',t+2000,{
    capacity_percent:40,wind_speed:0}),t+2000);
  const rc=registry.get('RC01',t+2001),air=registry.get('AIR01',t+2001);
  assert.equal(rc.telemetryFieldAt.battery,t+1000);
  assert.equal(air.telemetryFieldAt.battery,t+2000);
  assert.equal(air.telemetryFieldAt.windSpeed,t+2000);
  assert.equal(rc.telemetryFieldAt.windSpeed,undefined);
});

test('null GPS without other values still updates OSD receipt but never GPS fix',()=>{
  const registry=createRegistry();
  const result=registry.ingest(receive('AIR01',t+1000,{
    latitude:0,longitude:0}),t+1000);
  assert.equal(result.point,null);
  const device=registry.get('AIR01',t+1001);
  assert.equal(device.positionUnavailable,true);
  assert.equal(device.lastTelemetryAt,t+1000);
  assert.equal(device.lastPositionAt,null);
  assert.deepEqual(device.telemetryFieldAt,{});
});
