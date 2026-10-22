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
