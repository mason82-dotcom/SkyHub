'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {classifyMessage}=require('../message-guard');
const {createStatusReply}=require('../topology-ack');

const now=1792518000000;
const tid='6a7bfe89-c386-4043-b600-b518e10096cc';
const bid='42a19f36-5117-4520-bd13-fd61d818d52e';
function sample(overrides={}) {
  const envelope={
    tid,bid,timestamp:now-1000,method:'update_topo',
    data:{domain:'3',type:119,sub_type:0,sub_devices:[{
      sn:'AIR01',domain:'0',type:60,sub_type:0,device_secret:'HIDDEN'
    }]},...overrides
  };
  const raw=Buffer.from(JSON.stringify(envelope));
  const parsed=parseMessage('sys/product/RC01/status',raw);
  return {raw,parsed};
}
test('creates exact DJI status_reply with transaction identifiers and no topology secrets',()=>{
  const {raw,parsed}=sample();
  assert.equal(classifyMessage(parsed,{},now).accept,true);
  const reply=createStatusReply(parsed,raw,now);
  assert.equal(reply.topic,'sys/product/RC01/status_reply');
  assert.deepEqual(JSON.parse(reply.payload),{
    tid,bid,timestamp:now,method:'update_topo',data:{result:0}
  });
  assert.doesNotMatch(reply.payload,/AIR01|HIDDEN|device_secret|nonce/);
});
test('refuses status replies for wrong channel or method',()=>{
  const {raw,parsed}=sample();
  assert.equal(createStatusReply({...parsed,channel:'osd'},raw,now),null);
  assert.equal(createStatusReply({...parsed,method:'other'},raw,now),null);
  assert.equal(createStatusReply({...parsed,topology:null},raw,now),null);
});
test('rejects unverified, absent and malformed transaction IDs',()=>{
  for (const overrides of [{tid:'bad'},{bid:'bad'},{tid:null},{bid:null}]) {
    const {raw,parsed}=sample(overrides);
    assert.equal(createStatusReply(parsed,raw,now),null);
  }
});
test('rejects envelope mismatch and missing validated topology',()=>{
  const {raw,parsed}=sample();
  assert.equal(createStatusReply({...parsed,timestamp:now},raw,now),null);
  const wrong=sample({data:{}}); 
  assert.equal(createStatusReply(wrong.parsed,wrong.raw,now),null);
});
test('rejects malformed and oversized raw MQTT payload',()=>{
  const {parsed}=sample();
  assert.equal(createStatusReply(parsed,Buffer.from('{'),now),null);
  assert.equal(createStatusReply(parsed,Buffer.alloc(131073),now),null);
});
test('rejects invalid outbound identifier (topic injection)',()=>{
  const {raw,parsed}=sample();
  assert.equal(createStatusReply({...parsed,sn:'RC01/other'},raw,now),null);
});
test('returned reply never grants a flight-control topic',()=>{
  const {raw,parsed}=sample();
  const reply=createStatusReply(parsed,raw,now);
  assert.match(reply.topic,/^sys\/product\/[\w.-]+\/status_reply$/);
  assert.doesNotMatch(reply.topic,/services|property|drc/);
});
