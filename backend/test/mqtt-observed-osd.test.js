'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMqttMetrics}=require('../mqtt-metrics');

test('raw DJI OSD deliveries count even before JSON validation',()=>{
  const m=createMqttMetrics();
  m.observed('thing/product/RC01/osd',1234);
  const snap=m.snapshot();
  assert.equal(snap.mqttObservedPackets,1);
  assert.equal(snap.mqttObservedOsdPackets,1);
  assert.equal(snap.mqttLastObservedOsdAt,1234);
  assert.equal(snap.mqttOsdMessages,0);
  assert.equal(snap.mqttValidTelemetryUpdates,0);
  assert.equal(snap.mqttAcceptedMessages,0);
});
test('allowlisted status messages do not imply OSD',()=>{
  const m=createMqttMetrics();
  m.observed('sys/product/RC01/status');
  m.observed('thing/product/RC01/state');
  const snap=m.snapshot();
  assert.equal(snap.mqttObservedPackets,2);
  assert.equal(snap.mqttObservedOsdPackets,0);
  assert.equal(snap.mqttObservedChannelCounts.status,1);
  assert.equal(snap.mqttObservedChannelCounts.state,1);
});
test('invalid and unrelated MQTT topics do not enter counters',()=>{
  const m=createMqttMetrics();
  m.observed('sys/product/RC01/osd');
  m.observed('thing/product/RC01/status');
  m.observed('thing/product/RC01/../../services');
  m.observed('arbitrary/secret/topic');
  assert.equal(m.snapshot().mqttObservedPackets,0);
});
test('diagnostic counters never contain device identifiers or payloads',()=>{
  const m=createMqttMetrics();
  m.observed('thing/product/PRIVATE_SERIAL_123/osd');
  m.rejected('malformed');
  const serialized=JSON.stringify(m.snapshot());
  assert.doesNotMatch(serialized,/PRIVATE_SERIAL_123/);
  assert.equal(m.snapshot().mqttRejectedMessages,1);
  assert.equal(m.snapshot().mqttObservedOsdPackets,1);
});
