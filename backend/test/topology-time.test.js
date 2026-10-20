'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const now=1760000001000;
const topo=(children,timestamp)=>parseMessage('sys/product/RC123/status',
  Buffer.from(JSON.stringify({
    method:'update_topo',timestamp,
    data:{
      domain:'2',type:119,sub_type:0,
      device_secret:'KEEP_PRIVATE',
      sub_devices:children.map(sn=>({
        sn,domain:'0',type:77,sub_type:0,device_secret:'CHILD_PRIVATE'
      }))
    }
  }))
);

test('gateway and children expose last reported topology time, not inferred current presence',()=>{
  const registry=createRegistry();
  const sampleAt=now-20000;
  registry.ingest(topo(['AIR01'],sampleAt),now);
  const controller=registry.get('RC123',now);
  const aircraft=registry.get('AIR01',now);
  assert.equal(controller.lastTopologyAt,sampleAt);
  assert.equal(aircraft.lastTopologyAt,sampleAt);
  assert.equal(controller.topologyTimeVerified,true);
  assert.equal(aircraft.topologyTimeVerified,true);
  assert.equal(aircraft.gatewaySn,'RC123');
  assert.doesNotMatch(JSON.stringify(registry.snapshot(now)),/KEEP_PRIVATE|CHILD_PRIVATE/);
});

test('topology removal records when disconnection was last reported',()=>{
  const registry=createRegistry();
  registry.ingest(topo(['AIR01'],now-10000),now);
  registry.ingest(topo([],now+1000),now+2000);
  const child=registry.get('AIR01',now+2000);
  assert.equal(child.topologyOnline,false);
  assert.equal(child.lastTopologyAt,now+1000);
  assert.equal(child.topologyTimeVerified,true);
});
