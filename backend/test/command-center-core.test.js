'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../../frontend/public/command-center-core');
const now=200000;

test('missing and expired measurements never display as live',()=>{
  assert.equal(c.metric({telemetry:{altitude:120}},'altitude',' m',now).value,'—');
  assert.equal(c.metric({telemetry:{altitude:120},telemetryFieldAt:{altitude:now-16000}},'altitude',' m',now).state,'stale');
  assert.equal(c.metric({aircraftConnected:false,telemetry:{altitude:120},telemetryFieldAt:{altitude:now-1000}},'altitude',' m',now).state,'stale');
  assert.equal(c.metric({telemetry:{altitude:120},telemetryFieldAt:{altitude:now-1000},telemetryFieldTimeVerified:{altitude:false}},'altitude',' m',now).state,'time-unverified');
});
test('unknown positions and DJI null fix 0/0 stay unavailable',()=>{
  assert.equal(c.knownPosition({telemetry:{latitude:0,longitude:0},lastPositionAt:now}),null);
  assert.equal(c.knownPosition({telemetry:{latitude:49,longitude:8},positionUnavailable:true,lastPositionAt:now}),null);
  assert.equal(c.knownPosition({telemetry:{latitude:91,longitude:8},lastPositionAt:now}),null);
  assert.deepEqual(c.knownPosition({telemetry:{latitude:49,longitude:8},lastPositionAt:now}),{lat:49,lon:8});
});
test('HMS is cleared for stale reports even if messages linger',()=>{
  const d={hms:[{level:2}],lastHmsAt:now-31000};
  assert.deepEqual(c.hmsAlerts(d,now),[]);
  assert.deepEqual(c.summarize([d],now),{devices:1,live:0,warnings:0});
});
test('device status distinguishes unverified clocks and offline aircraft',()=>{
  assert.equal(c.deviceState({lastTelemetryAt:now-1000,telemetryTimeVerified:false},now),'OSD empfangen · Zeit ungeprüft');
  assert.equal(c.deviceState({lastTelemetryAt:now-1000,aircraftConnected:false},now),'Fluggerät nicht verbunden');
  assert.equal(c.deviceState({lastTelemetryAt:now-16000},now),'Keine aktuelle OSD-Telemetrie');
});
test('only real recent device OSD contributes to live count',()=>{
  const list=[{lastTelemetryAt:now-1000},{lastTelemetryAt:now-16000},{lastTelemetryAt:now-200,aircraftConnected:false}];
  assert.deepEqual(c.summarize(list,now),{devices:3,live:1,warnings:0});
});

test('S3 inventory page is prefix-scoped, bounded and correctly classified',()=>{
  const page=c.parseMediaPage({
    bucket:'dji-cloud',prefix:'missions/2026/',truncated:true,nextCursor:'opaque-next',
    objects:[
      {key:'missions/2026/a_MS_NIR.TIF',size:120,lastModified:'2026-10-22T11:00:00.000Z'},
      {key:'missions/2026/a_D.JPG',size:66,lastModified:null}
    ]
  },{bucket:'dji-cloud',prefix:'missions/2026/',limit:100});
  assert.equal(page.objects.length,2);
  assert.equal(page.objects[0].type,'TIFF');
  assert.equal(page.objects[1].type,'JPEG');
  assert.equal(page.nextCursor,'opaque-next');
  assert.equal(page.truncated,true);
});
test('reject forged object keys, wrong buckets, oversized pages and malformed pagination',()=>{
  const config={bucket:'dji-cloud',prefix:'missions/',limit:1};
  const good={
    bucket:'dji-cloud',prefix:'missions/',truncated:false,nextCursor:null,
    objects:[{key:'missions/photo.DNG',size:100,lastModified:null}]
  };
  for(const patch of [
    {bucket:'farming'}, {prefix:'other/'},
    {objects:[{key:'elsewhere.jpg',size:100}]},
    {objects:[{key:'missions/photo.TIF',size:-1}]},
    {objects:[{key:'missions/a.TIF',size:0},{key:'missions/b.TIF',size:0}]},
    {truncated:true,nextCursor:null},
    {truncated:true,nextCursor:'x'.repeat(4097)},
    {truncated:'yes'},
    {nextCursor:'unexpected'}
  ]){
    assert.throws(()=>c.parseMediaPage({...good,...patch},config));
  }
});
test('browser listing does not infer photogrammetry or calibration readiness',()=>{
  const page=c.parseMediaPage({
    bucket:'dji-cloud',prefix:'',truncated:false,nextCursor:null,
    objects:[{key:'DJI_20261022_RGB.PNG',size:1024,lastModified:null}]
  },{bucket:'dji-cloud'});
  assert.deepEqual(page.objects.map(x=>x.type),['PNG']);
  assert.equal(Object.hasOwn(page,'ndviReady'),false);
  assert.equal(Object.hasOwn(page,'reflectanceReady'),false);
});

test('disconnected aircraft cannot show an active HMS warning',()=>{
  const d={aircraftConnected:false,hms:[{level:2,code:'test'}],lastHmsAt:now-100};
  assert.deepEqual(c.hmsAlerts(d,now),[]);
  assert.equal(c.summarize([d],now).warnings,0);
});
