'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTopic,parseMessage,extractTelemetry,extractTopology,fresh}=require('../dji');

test('DJI topics: status only under sys, state/OSD under thing',()=>{
  assert.deepEqual(parseTopic('sys/product/RC123/status'),{source:'sys',sn:'RC123',channel:'status'});
  assert.equal(parseTopic('thing/product/RC123/status'),null);
  assert.equal(parseTopic('sys/product/RC123/osd'),null);
  assert.equal(parseTopic('thing/product/RC123/services'),null);
});
test('DJI 1.18 OSD nested data and relative/absolute height stay distinct',()=>{
  const msg=Buffer.from(JSON.stringify({data:{
    latitude:49.1,longitude:8.4,height:420,elevation:120,mode_code:5,
    battery:{batteries:[{capacity_percent:76}]},horizontal_speed:6.5,vertical_speed:-1.2
  }}));
  const result=parseMessage('thing/product/AIR/osd',msg);
  assert.deepEqual(result.telemetry,{
    latitude:49.1,longitude:8.4,altitude:120,heightEllipsoid:420,
    battery:76,heading:null,horizontalSpeed:6.5,verticalSpeed:-1.2
  });
  assert.equal(result.state.modeCode,5);
});
test('height alone must not be mislabeled as altitude relative to takeoff',()=>{
  const data=extractTelemetry({height:420,latitude:0,longitude:0,capacity_percent:0});
  assert.equal(data.altitude,null);
  assert.equal(data.heightEllipsoid,420);
  assert.equal(data.latitude,0);
  assert.equal(data.battery,0);
});
test('out-of-range readings are unknown rather than zero',()=>{
  const data=extractTelemetry({latitude:95,longitude:181,capacity_percent:105,horizontal_speed:-1});
  assert.equal(data.latitude,null);
  assert.equal(data.longitude,null);
  assert.equal(data.battery,null);
  assert.equal(data.horizontalSpeed,null);
});
test('state with firmware is supported',()=>{
  const value=parseMessage('thing/product/RC/state',
    Buffer.from('{"data":{"firmware_version":"1.0.0"}}'));
  assert.equal(value.telemetry,null);
  assert.equal(value.state.firmwareVersion,'1.0.0');
});
test('Pilot 2 topology allowlists domain and version, excluding secrets',()=>{
  const d=extractTopology({
    domain:'3',type:119,sub_type:0,thing_version:'1.1.2',device_secret:'TOPSECRET',nonce:'DANGER',
    sub_devices:[{sn:'AIR01',domain:'0',type:60,sub_type:0,index:'A',thing_version:'1.1.2',
      device_secret:'CHILDSECRET',nonce:'CHILDNONCE'}]
  });
  assert.equal(d.model.domain,'3');
  assert.equal(d.model.thingVersion,'1.1.2');
  assert.equal(d.children[0].index,'A');
  assert.equal(d.children[0].model.domain,'0');
  assert.doesNotMatch(JSON.stringify(d),/secret|nonce/i);
});
test('HMS produces a minimal safe alert summary',()=>{
  const m=parseMessage('thing/product/Dock/events',Buffer.from(JSON.stringify({
    method:'hms',data:{list:[{
      code:'0x16100083',level:2,module:3,device_type:'0-67-0',imminent:1,
      args:{private:'DANGER'}
    }]}
  })));
  assert.deepEqual(m.hms,[{code:'0x16100083',level:2,module:3,deviceType:'0-67-0',imminent:1}]);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('OSD freshness expires after 15 seconds',()=>{
  assert.equal(fresh(null,50000),false);
  assert.equal(fresh(35001,50000),true);
  assert.equal(fresh(35000,50000),false);
});
test('invalid and oversized MQTT envelopes are rejected',()=>{
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.from('{')),SyntaxError);
  assert.throws(()=>parseMessage('thing/product/RC/osd',Buffer.alloc(131073)),/length/);
});
