'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');
const {classifyMessage,MAX_OSD_AGE_MS,MAX_OTHER_AGE_MS,MAX_FUTURE_SKEW_MS}=require('../message-guard');

const now=1760000001000;
const NO_TIMESTAMP=Symbol('no timestamp');
const packet=(data,timestamp=now,channel='osd')=>{
  const env={data};
  if(timestamp!==NO_TIMESTAMP)env.timestamp=timestamp;
  return parseMessage('thing/product/AIR01/'+channel,Buffer.from(JSON.stringify(env)));
};

test('retained MQTT packets must never refresh device state',()=>{
  const parsed=packet({latitude:49,longitude:8});
  assert.deepEqual(classifyMessage(parsed,{retain:true},now),{
    accept:false,reason:'retained',timestampVerified:false
  });
});

test('OSD packets outside replay-age window are refused',()=>{
  assert.equal(classifyMessage(packet({battery_percentage:55},now-MAX_OSD_AGE_MS),{},now).accept,true);
  const refused=classifyMessage(packet({latitude:49,longitude:8},now-MAX_OSD_AGE_MS-1),{},now);
  assert.equal(refused.reason,'stale');
});

test('future-dated DJI timestamp is rejected even when payload is valid',()=>{
  assert.equal(classifyMessage(packet({},now+MAX_FUTURE_SKEW_MS),{},now).accept,true);
  assert.equal(classifyMessage(packet({},now+MAX_FUTURE_SKEW_MS+1),{},now).reason,'future');
});

test('non-OSD state channel allows a longer asynchronous delivery window',()=>{
  assert.equal(classifyMessage(packet({},now-MAX_OTHER_AGE_MS,'state'),{},now).accept,true);
  assert.equal(classifyMessage(packet({},now-MAX_OTHER_AGE_MS-1,'state'),{},now).reason,'stale');
});

test('timestampless historical compatibility is explicitly unverified',()=>{
  const msg=packet({battery_percentage:30},NO_TIMESTAMP);
  assert.equal(msg.timestamp,null);
  assert.deepEqual(classifyMessage(msg,{},now),{
    accept:true,reason:null,timestampVerified:false
  });
});

test('explicit malformed timestamp cannot bypass timestamp validation',()=>{
  for(const value of [null,'1760000001000',42,1760000001000.5,1e16]){
    assert.throws(()=>packet({},value),/Invalid DJI timestamp/);
  }
});

test('out-of-order and duplicate source timestamps cannot mutate the registry',()=>{
  const registry=createRegistry();
  registry.ingest(packet({latitude:49,longitude:8},now-1000),now);
  const duplicate=registry.ingest(packet({latitude:51,longitude:10},now-1000),now+100);
  assert.equal(duplicate.dropReason,'duplicate');
  assert.deepEqual([registry.get('AIR01',now+100).telemetry.latitude,
    registry.get('AIR01',now+100).telemetry.longitude],[49,8]);
  const missing=registry.ingest(packet({latitude:52,longitude:11},NO_TIMESTAMP),now+200);
  assert.equal(missing.dropReason,'missing_timestamp_after_verified');
});

test('verified source timestamps control both OSD and GPS freshness',()=>{
  const registry=createRegistry();
  const sampleAt=now-20000;
  registry.ingest(packet({latitude:49,longitude:8,battery_percentage:65},sampleAt),now);
  const d=registry.get('AIR01',now);
  assert.equal(d.lastTelemetryAt,sampleAt);
  assert.equal(d.lastPositionAt,sampleAt);
  assert.equal(d.telemetryTimeVerified,true);
  assert.equal(d.positionTimeVerified,true);
  assert.equal(d.fresh,false);
  assert.equal(d.positionFresh,false);
  assert.equal(d.telemetry.battery,65);
});

test('timestampless packets never claim verified source time',()=>{
  const registry=createRegistry();
  registry.ingest(packet({latitude:49,longitude:8},NO_TIMESTAMP),now);
  const d=registry.get('AIR01',now+1);
  assert.equal(d.telemetryTimeVerified,false);
  assert.equal(d.positionTimeVerified,false);
});
