'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTopic,parseMessage,extractTelemetry,fresh}=require('../dji');
test('DJI status, osd, state and service topic definitions',()=>{
  assert.deepEqual(parseTopic('sys/product/RC123/status'),{source:'sys',sn:'RC123',channel:'status'});
  assert.equal(parseTopic('thing/product/RC123/status'),null);
  assert.equal(parseTopic('sys/product/RC123/osd'),null);
  assert.equal(parseTopic('thing/product/RC123/services'),null);
});
test('nested data and aircraft battery are parsed',()=>{
  const msg=Buffer.from(JSON.stringify({data:{latitude:49.1,longitude:8.4,height:120,battery:{batteries:[{capacity_percent:76}]}}}));
  assert.deepEqual(parseMessage('thing/product/AIR/osd',msg).telemetry,
    {latitude:49.1,longitude:8.4,altitude:120,battery:76,heading:null});
});
test('zero values are real measurements, invalid values are unknown',()=>{
  assert.deepEqual(extractTelemetry({latitude:0,longitude:0,height:0,capacity_percent:0}),
    {latitude:0,longitude:0,altitude:0,battery:0,heading:null});
  assert.equal(extractTelemetry({latitude:95}).latitude,null);
  assert.equal(extractTelemetry({longitude:181}).longitude,null);
});
test('state is not mistaken for osd',()=>{
  assert.equal(parseMessage('thing/product/RC/state',Buffer.from('{"data":{"firmware_version":"1"}}')).telemetry,null);
});
test('OSD freshness expires after 15 seconds',()=>{
  assert.equal(fresh(null,50000),false);
  assert.equal(fresh(35001,50000),true);
  assert.equal(fresh(35000,50000),false);
});
test('invalid and oversize messages are rejected',()=>{
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.from('{')),SyntaxError);
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.alloc(131073)),/length/);
});
