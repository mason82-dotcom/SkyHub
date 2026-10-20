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
    battery:76,heading:null,horizontalSpeed:6.5,verticalSpeed:-1.2,
    attitudePitch:null,attitudeRoll:null,homeDistance:null,remainingFlightTime:null,
    gpsSatellites:null,rtkSatellites:null,rtkFixState:null,positionQuality:null,
    linkQuality:null
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
  assert.deepEqual(m.hms,[{code:'0x16100083',level:2,module:3,deviceType:'0-67-0',imminent:1,
    componentIndex:null,sensorIndex:null}]);
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
test('aircraft OSD GNSS/RTK, attitude, home distance and remaining flight time',()=>{
  const data=extractTelemetry({
    attitude_pitch:-3.5,attitude_roll:1.2,home_distance:142.7,
    battery:{capacity_percent:64,remain_flight_time:1180},
    position_state:{gps_number:21,rtk_number:34,is_fixed:2,quality:10}
  });
  assert.equal(data.attitudePitch,-3.5);
  assert.equal(data.attitudeRoll,1.2);
  assert.equal(data.homeDistance,142.7);
  assert.equal(data.remainingFlightTime,1180);
  assert.equal(data.gpsSatellites,21);
  assert.equal(data.rtkSatellites,34);
  assert.equal(data.rtkFixState,2);
  assert.equal(data.positionQuality,10);
  assert.equal(data.battery,64);
});
test('RC OSD link quality and battery; implausible quality values stay unknown',()=>{
  const rc=extractTelemetry({capacity_percent:88,wireless_link:{sdr_quality:4,dongle_number:0}});
  assert.equal(rc.battery,88);
  assert.equal(rc.linkQuality,4);
  const bad=extractTelemetry({wireless_link:{sdr_quality:9},
    position_state:{gps_number:-1,is_fixed:7,quality:1.5},battery:{remain_flight_time:-5}});
  assert.equal(bad.linkQuality,null);
  assert.equal(bad.gpsSatellites,null);
  assert.equal(bad.rtkFixState,null);
  assert.equal(bad.positionQuality,null);
  assert.equal(bad.remainingFlightTime,null);
});
test('data key shape exposes field names only, never values',()=>{
  const m=parseMessage('thing/product/RC/state',Buffer.from(JSON.stringify({
    need_reply:1,data:{live_capacity:{x:'SECRETVALUE'},'bad key':1,firmware_version:'1.0'}
  })));
  assert.deepEqual(m.dataKeys,['firmware_version','live_capacity']);
  assert.equal(m.needReply,true);
  assert.doesNotMatch(JSON.stringify(m.dataKeys),/SECRETVALUE/);
  assert.deepEqual(parseMessage('thing/product/RC/osd',Buffer.from('{"data":[1]}')).dataKeys,[]);
});
test('Pilot 2 HMS (event/method inside data, decimal id) as observed on a Mavic 3M',()=>{
  const m=parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
    timestamp:1792528000000,
    data:{event:'hms',method:'hms',output:{codes:[
      {id:370147430,level:2,component_index:0,sensor_index:0},
      {id:440536001,level:1,component_index:1,sensor_index:2,secret:'DANGER'},
      {id:-5,level:2},{id:'0x1',level:2},null
    ]}}
  })));
  assert.equal(m.method,'hms');
  assert.deepEqual(m.hms,[
    {code:'0x16100066',level:2,module:null,deviceType:null,imminent:null,componentIndex:0,sensorIndex:0},
    {code:'0x1A420BC1',level:1,module:null,deviceType:null,imminent:null,componentIndex:1,sensorIndex:2}
  ]);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('dock HMS keeps only component/sensor index from args and normalises the code',()=>{
  const m=parseMessage('thing/product/Dock/events',Buffer.from(JSON.stringify({
    method:'hms',data:{list:[{code:'0x1610abc',level:0,args:{component_index:1,sensor_index:0,x:'DANGER'}}]}
  })));
  assert.equal(m.hms[0].code,'0x01610ABC');
  assert.equal(m.hms[0].componentIndex,1);
  assert.doesNotMatch(JSON.stringify(m),/DANGER/);
});
test('events without HMS are not misread as HMS',()=>{
  const m=parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
    data:{event:'other',method:'hms',output:{codes:[{id:1,level:2}]}}})));
  assert.equal(m.method,null);
  assert.equal(m.hms,null);
});
