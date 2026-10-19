'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const receive=(topic,message)=>parseMessage(topic,Buffer.from(JSON.stringify(message)));
const topology=(children,ts=1760000000001)=>receive('sys/product/RC123/status',{
  method:'update_topo',timestamp:ts,data:{type:99,sub_type:0,device_secret:'TOPSECRET',nonce:'VERYSECRET',
    sub_devices:children.map(sn=>({sn,type:116,sub_type:1,device_secret:'CHILDSECRET',nonce:'CHILDNONCE'}))}
});

test('a gateway and its aircraft are linked by topology, without any secret exposure',()=>{
  const registry=createRegistry();
  const {updates}=registry.ingest(topology(['AIR01']),1760000001000);
  assert.equal(updates.length,2);
  const [air,gateway]=[registry.get('AIR01'),registry.get('RC123')];
  assert.equal(gateway.role,'gateway');
  assert.equal(air.role,'subdevice');
  assert.equal(air.gatewaySn,'RC123');
  assert.equal(air.topologyOnline,true);
  assert.deepEqual(gateway.children,['AIR01']);
  for(const response of [registry.snapshot(),registry.events(),updates]){
    assert.doesNotMatch(JSON.stringify(response),/TOPSECRET|VERYSECRET|CHILDSECRET|CHILDNONCE/);
  }
});
test('topology empty snapshot marks disconnected child, but does not invent flight status',()=>{
  const registry=createRegistry();
  registry.ingest(topology(['AIR01']),1760000001000);
  registry.ingest(topology([],1760000000002),1760000002000);
  assert.equal(registry.get('AIR01').topologyOnline,false);
  assert.equal(registry.get('AIR01').telemetry.latitude,null);
  assert.deepEqual(registry.get('RC123').children,[]);
});
test('status and state do not make OSD freshness positive',()=>{
  const registry=createRegistry();
  const ts=1760000000001;
  registry.ingest(topology(['AIR01'],ts),1760000001000);
  registry.ingest(receive('thing/product/AIR01/state',{timestamp:ts,data:{mode_code:5,firmware_version:'10.0.1'}}),1760000001001);
  const d=registry.get('AIR01',1760000001002);
  assert.equal(d.modeCode,5);
  assert.equal(d.firmwareVersion,'10.0.1');
  assert.equal(d.fresh,false);
});
test('older OSD cannot overwrite newer telemetry or refresh freshness',()=>{
  const registry=createRegistry();
  registry.ingest(receive('thing/product/AIR01/osd',{timestamp:1760000000200,gateway:'RC123',data:{latitude:49,longitude:8,height:10}}),1760000001000);
  const old=registry.ingest(receive('thing/product/AIR01/osd',{timestamp:1760000000100,gateway:'RC123',data:{latitude:50,longitude:9,height:20}}),1760000001100);
  assert.equal(old.updates.length,0);
  const d=registry.get('AIR01',1760000001100);
  assert.equal(d.telemetry.latitude,49);
  assert.equal(d.lastTelemetryAt,1760000001000);
  assert.equal(d.gatewaySn,'RC123');
});
test('OSD point persisted only if both coordinates occur in same packet',()=>{
  const registry=createRegistry();
  let result=registry.ingest(receive('thing/product/AIR01/osd',{data:{latitude:49}}),1760000001000);
  assert.equal(result.point,null);
  result=registry.ingest(receive('thing/product/AIR01/osd',{data:{longitude:8}}),1760000002000);
  assert.equal(result.point,null);
  result=registry.ingest(receive('thing/product/AIR01/osd',{data:{latitude:0,longitude:0,capacity_percent:0}}),1760000003000);
  assert.equal(result.point.latitude,0);
  assert.equal(result.point.longitude,0);
  assert.equal(result.point.battery,0);
});
test('empty OSD does not pretend to be fresh telemetry',()=>{
  const registry=createRegistry();
  registry.ingest(receive('thing/product/AIR01/osd',{data:{}}),1760000001000);
  assert.equal(registry.get('AIR01',1760000001001).fresh,false);
});
