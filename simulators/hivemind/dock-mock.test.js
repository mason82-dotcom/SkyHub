'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createResponder, parseRequest, validRequest, METHODS} = require('./dock-mock');

const T = 1790000000000;
const GATEWAY = 'LAB_DOCK_GW';
const DRONE = 'LAB_DRONE_01';
const TOPIC = `thing/product/${GATEWAY}/requests`;
const ID = 'f88caf13-0df1-44c7-a379-f1b7861a8c91';
const BID = 'f88caf13-0df1-44c7-a379-f1b7861a8c92';
const base = (method, data, overrides = {}) => Buffer.from(JSON.stringify({
  method, data, tid: ID, bid: BID, timestamp: T, gateway: GATEWAY, ...overrides
}));
const reqs = [
 ['config', {config_type:'json',config_scope:'product'}],
 ['airport_bind_status', {devices:[{sn:GATEWAY},{sn:DRONE}]}],
 ['airport_organization_get', {organization_id:'skyhub-lab-org', device_binding_code:'skyhub-lab-code'}],
 ['airport_organization_bind', {bind_devices:[GATEWAY,DRONE].map(sn=>({
   sn, device_model_key:'0-1-1',device_callsign:sn,
   organization_id:'skyhub-lab-org',device_binding_code:'skyhub-lab-code'
 }))}]
];

test('DJI Dock registration rejects out-of-order commands and honors tid/bid',()=>{
 const mock=createResponder(()=>T);
 assert.equal(mock.reply(TOPIC,base(...reqs[1])),null);
 for (const [method, data] of reqs) {
   const response=mock.reply(TOPIC,base(method,data));
   assert.ok(response,'expected test-only reply: '+method);
   assert.equal(response.topic,`thing/product/${GATEWAY}/requests_reply`);
   const value=JSON.parse(response.payload);
   assert.equal(value.tid,ID);
   assert.equal(value.bid,BID);
   assert.equal(value.method,method);
   assert.equal(value.data.result,0);
 }
 assert.equal(mock.reply(TOPIC,base(...reqs[0])),null);
 assert.deepEqual(METHODS,reqs.map(x=>x[0]));
 assert.deepEqual(mock.snapshot(),{
   config:1,airport_bind_status:1,airport_organization_get:1,
   airport_organization_bind:1,update_topo:0
 });
});

test('only registered synthetic Dock gets an update_topo acknowledgement',()=>{
 const mock=createResponder(()=>T);
 const statusTopic=`sys/product/${GATEWAY}/status`;
 const status=Buffer.from(JSON.stringify({
    method:'update_topo',tid:ID,bid:BID,timestamp:T,
    data:{sub_devices:[{sn:DRONE}],device_secret:'never_reply_with_this'}
 }));
 assert.equal(mock.topologyReply(statusTopic,status),null);
 for(const [method,data] of reqs)assert.ok(mock.reply(TOPIC,base(method,data)));
 const res=mock.topologyReply(statusTopic,status);
 assert.ok(res);
 assert.equal(res.topic,`sys/product/${GATEWAY}/status_reply`);
 assert.deepEqual(JSON.parse(res.payload).data,{result:0});
 assert.ok(!res.payload.includes('never_reply_with_this'));
 assert.equal(mock.snapshot().update_topo,1);
});

test('unknown topics, forged identities, timestamps, binary payloads and unapproved requests are denied',()=>{
 const mock=createResponder(()=>T);
 const payload=base(...reqs[0]);
 for(const [topic,raw] of [
   [`thing/product/${GATEWAY}/requests_reply`,payload],
   [`thing/product/${GATEWAY}/services`,payload],
   [TOPIC,base(...reqs[0],{gateway:'real-unit'})],
   [TOPIC,base(...reqs[0],{timestamp:T-61000})],
   [TOPIC,base(...reqs[0],{timestamp:1})],
   [TOPIC,base(...reqs[0],{tid:'oops'})],
   [TOPIC,base(...reqs[0],{method:'flightcontrol_takeoff'})],
   [TOPIC,Buffer.from('{bad')],
   [TOPIC,Buffer.alloc(8193)]
 ]) assert.equal(mock.reply(topic,raw),null);
 assert.equal(mock.snapshot().config,0);
 assert.equal(parseRequest(TOPIC, Buffer.from('null'),T),null);
 assert.equal(validRequest('airport_organization_get',{
   organization_id:'some-real-org',device_binding_code:'some-real-code'
 },GATEWAY),false);
});

test('binding requires the exact disposable org/code; no fallback to missing fields',()=>{
 const mock=createResponder(()=>T);
 assert.ok(mock.reply(TOPIC,base(...reqs[0])));
 assert.ok(mock.reply(TOPIC,base(...reqs[1])));
 assert.equal(mock.reply(TOPIC,base('airport_organization_get',{
   organization_id:'skyhub-lab-org',device_binding_code:'real-code'
 })),null);
 assert.equal(mock.reply(TOPIC,base('airport_organization_bind',reqs[3][1])),null);
 assert.ok(mock.reply(TOPIC,base(...reqs[2])));
 assert.equal(mock.reply(TOPIC,base('airport_organization_bind',{
   bind_devices:reqs[3][1].bind_devices.map(d=>({...d,organization_id:'anything'}))
 })),null);
 assert.ok(mock.reply(TOPIC,base(...reqs[3])));
 assert.equal(mock.snapshot().airport_organization_bind,1);
});

test('maximum eight distinct synthetic gateways per mock lifetime',()=>{
 const mock=createResponder(()=>T);
 for(let i=0;i<8;i++){
   const sn='LAB_DOCK_'+i;
   const b=base(...reqs[0],{gateway:sn});
   assert.ok(mock.reply(`thing/product/${sn}/requests`,b));
 }
 const ninth=base(...reqs[0],{gateway:'LAB_DOCK_8'});
 assert.equal(mock.reply('thing/product/LAB_DOCK_8/requests',ninth),null);
});
