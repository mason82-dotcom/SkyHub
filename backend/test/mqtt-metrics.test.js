'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');
const {createMqttMetrics}=require('../mqtt-metrics');

function receive(topic,data,timestamp) {
  return parseMessage(topic,Buffer.from(JSON.stringify({timestamp,data})));
}
test('Broker connection and subscriptions alone never count as DJI telemetry',()=>{
  const m=createMqttMetrics();
  m.connected(1000);
  let s=m.snapshot();
  assert.equal(s.mqttLastConnectedAt,1000);
  assert.equal(s.mqttLastMessageAt,null);
  assert.equal(s.mqttLastOsdAt,null);
  assert.equal(s.mqttLastTelemetryAt,null);
  assert.equal(s.mqttValidTelemetryUpdates,0);
});
test('state and status packets are not OSD or valid telemetry',()=>{
  const registry=createRegistry(),m=createMqttMetrics();
  const state=receive('thing/product/AIR01/state',{firmware_version:'1.2.3'},1760000000000);
  m.accepted(state,registry.ingest(state,2000),2000);
  const status=receive('sys/product/RC01/status',{},1760000000000);
  m.accepted(status,registry.ingest(status,2001),2001);
  let s=m.snapshot();
  assert.equal(s.mqttAcceptedMessages,2);
  assert.deepEqual(s.mqttChannelCounts,{osd:0,state:1,status:1,events:0,services_reply:0});
  assert.equal(s.mqttLastOsdAt,null);
  assert.equal(s.mqttLastTelemetryAt,null);
});
test('empty OSD counts as received but not valid telemetry',()=>{
  const registry=createRegistry(),m=createMqttMetrics();
  const empty=receive('thing/product/AIR01/osd',{},1760000000001);
  m.accepted(empty,registry.ingest(empty,3000),3000);
  const s=m.snapshot();
  assert.equal(s.mqttOsdMessages,1);
  assert.equal(s.mqttLastOsdAt,3000);
  assert.equal(s.mqttLastTelemetryAt,null);
  assert.equal(s.mqttValidTelemetryUpdates,0);
});
test('valid OSD updates telemetry; old packets do not refresh it',()=>{
  const registry=createRegistry(),m=createMqttMetrics();
  const current=receive('thing/product/AIR01/osd',{latitude:49,longitude:8,capacity_percent:77},1760000000200);
  m.accepted(current,registry.ingest(current,4000),4000);
  const old=receive('thing/product/AIR01/osd',{latitude:50,longitude:9},1760000000100);
  m.accepted(old,registry.ingest(old,4001),4001);
  const s=m.snapshot();
  assert.equal(s.mqttOsdMessages,1);
  assert.equal(s.mqttLastOsdAt,4000);
  assert.equal(s.mqttValidTelemetryUpdates,1);
  assert.equal(s.mqttLastTelemetryAt,4000);
  assert.equal(registry.get('AIR01',4001).telemetry.latitude,49);
});
test('rejected packets are counted without exposing payloads or device identifiers',()=>{
  const m=createMqttMetrics();
  m.rejected();
  m.disconnected(5000);
  const s=m.snapshot();
  assert.equal(s.mqttRejectedMessages,1);
  assert.equal(s.mqttLastDisconnectedAt,5000);
  assert.doesNotMatch(JSON.stringify(s),/AIR01|RC01|password|secret/);
});
