'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseMessage} = require('../dji');
const {createRegistry} = require('../registry');
const {deviceProfile,fieldDefinitions,sanitizeKnownProperties,
  sanitizeDeviceProperties,MAX_ARRAY_ITEMS} = require('../dji-properties');
const source = require('../data/dji-cloud-api-118-fields.json');

const models = [
  [{domain:'0',type:77,subType:0},'mavic3','official-family'],
  [{domain:'0',type:77,subType:1},'mavic3','official-family'],
  [{domain:'0',type:77,subType:2},'mavic3','shared-family-unverified'],
  [{domain:'0',type:99,subType:1},'matrice4T','shared-aircraft-with-web-extensions-unverified'],
  [{domain:'2',type:144,subType:0},'rcPro','official-device'],
  [{domain:'2',type:174,subType:0},'rcPlus2','official-device-web']
];
const receive = (topic,data,timestamp) => parseMessage(topic,Buffer.from(JSON.stringify({
  timestamp,data
})));
const topo = (time) => parseMessage('sys/product/RC/status',Buffer.from(JSON.stringify({
  method:'update_topo',timestamp:time,data:{
    domain:2,type:144,sub_type:0,
    sub_devices:[{sn:'AIR',domain:0,type:77,sub_type:0}]
  }
})));

test('pinned property tables enumerate all nested fields and preserve provenance',()=>{
  assert.equal(source.profiles.mavic3.fields.length,144);
  assert.equal(source.profiles.aircraftCommon.fields.length,162);
  assert.equal(source.profiles.matrice4T.fields.length,179);
  assert.equal(source.profiles.rcPro.fields.length,48);
  assert.equal(source.profiles.rcPlus2.fields.length,54);
  for (const profile of Object.values(source.profiles)) {
    if(profile!==source.profiles.rcPlus2) assert.match(profile.source,/dji-sdk\/Cloud-API-Doc\/blob\/4ec6b0c7/);
    else assert.match(profile.source,/developer.dji.com\/doc\/cloud-api-tutorial\/en\/api-reference\/pilot-to-cloud\/mqtt\/dji-rc-plus-2\/properties.html/);
    assert.ok(profile.fields.some(f=>f.path==='latitude' && f.push===0));
    assert.ok(profile.fields.some(f=>f.path==='firmware_version' && f.push===1));
    const seen=new Set(profile.fields.map(f=>f.path));
    assert.equal(seen.size,profile.fields.length);
  }
  assert.ok(source.profiles.mavic3.fields.some(f=>f.path==='battery.batteries.temperature'));
  assert.ok(source.profiles.aircraftCommon.fields.some(f=>f.path==='cameras.ir_zoom_factor'));
  assert.ok(source.profiles.rcPro.fields.some(f=>f.path==='wireless_link.sdr_quality'));
});
test('all six models have documented or explicitly provisional field profiles',()=>{
  for(const [model,name,confidence] of models) {
    assert.deepEqual(deviceProfile(model),{name,confidence});
    const defs=fieldDefinitions(model);
    assert.equal(defs.profile,name);
    assert.equal(defs.confidence,confidence);
    assert.ok(defs.fields.length>=48);
  }
  assert.equal(fieldDefinitions({domain:'0',type:999,subType:0}),null);
});
test('nested camera, GNSS, battery, RC link and stream fields survive read-only filter',()=>{
  const input={
    cameras:[{zoom_factor:3.5,ir_zoom_factor:2,recording_state:1,
      payload_index:'66-0-0',sn:'PRIVATE_CAMERA',url:'https://private.invalid'}],
    position_state:{gps_number:19,is_fixed:2,quality:3},
    battery:{capacity_percent:42,remain_flight_time:800,
      batteries:[{temperature:31.5,voltage:15430,sn:'PRIVATE_BATTERY'}]},
    country:'DE', control_source:'SECRET_OPERATOR',
    device_secret:'SECRET_DEVICE',nonce:'SECRET_NONCE'
  };
  const known=sanitizeKnownProperties(input,'osd');
  const m3=sanitizeDeviceProperties(known,'osd',models[0][0]);
  assert.equal(m3.cameras[0].zoom_factor,3.5);
  assert.equal(m3.cameras[0].payload_index,'66-0-0');
  assert.equal(m3.position_state.gps_number,19);
  assert.equal(m3.battery.batteries[0].temperature,31.5);
  assert.equal(m3.battery.batteries[0].voltage,15430);
  for (const raw of ['PRIVATE_CAMERA','PRIVATE_BATTERY','SECRET_OPERATOR','SECRET_DEVICE','SECRET_NONCE','private.invalid'])
    assert.doesNotMatch(JSON.stringify(known),new RegExp(raw));
  assert.equal(sanitizeDeviceProperties(known,'osd',models[4][0]).cameras,undefined);
});
test('state and OSD fields cannot be interchanged or promoted to live telemetry',()=>{
  const rc=models[4][0];
  const state={live_capacity:{
    available_video_number:2,device_list:[{sn:'PRIVATE_SERIAL',
      available_video_number:3,camera_list:[{camera_index:'66-0-0',available_video_number:1}]}]
  },firmware_version:'1.2.3',latitude:49.1,nonce:'SECRET'};
  const filtered=sanitizeDeviceProperties(sanitizeKnownProperties(state,'state'),'state',rc);
  assert.equal(filtered.live_capacity.available_video_number,2);
  assert.equal(filtered.firmware_version,'1.2.3');
  assert.equal(filtered.latitude,undefined);
  assert.doesNotMatch(JSON.stringify(filtered),/PRIVATE_SERIAL|SECRET/);
  assert.equal(sanitizeKnownProperties(state,'osd').firmware_version,undefined);
});
test('arrays, unrecognized fields, invalid numbers and arbitrary text are bounded',()=>{
  const items=Array.from({length:1000},(_,i)=>({
    remain_photo_num:i, payload_index:'bad-token',
    sn:'LEAK', firmware_version:'A'.repeat(400)
  }));
  const known=sanitizeKnownProperties({cameras:items,battery:{
    capacity_percent:Infinity},track_id:'TOPSECRET',
    dongle_infos:[{imei:'SENSITIVE',eid:'SENSITIVE'}]},'osd');
  const result=sanitizeDeviceProperties(known,'osd',models[0][0]);
  assert.equal(result.cameras.length,MAX_ARRAY_ITEMS);
  assert.equal(result.cameras[7].remain_photo_num,7);
  assert.equal(result.cameras[0].payload_index,undefined);
  assert.equal(result.battery,undefined);
  assert.doesNotMatch(JSON.stringify(known),/LEAK|TOPSECRET|SENSITIVE/);
});
test('topology drives model-specific extraction, separated channel timestamps and disconnected replay',()=>{
  const registry=createRegistry(),now=1792600000000;
  registry.ingest(topo(now-2000),now-2000);
  registry.ingest(receive('thing/product/AIR/osd',{
    mode_code:4,latitude:49.2,longitude:8.6,
    cameras:[{zoom_factor:6,recording_state:1}],
    battery:{capacity_percent:60,batteries:[{temperature:27.5,sn:'PRIVATE_BATTERY'}]},
    nonce:'PRIVATE_NONCE'
  },now-1000),now-1000);
  let device=registry.get('AIR',now);
  assert.equal(device.deviceProperties.osd.cameras[0].zoom_factor,6);
  assert.equal(device.deviceProperties.osd.battery.batteries[0].temperature,27.5);
  assert.equal(device.propertyObservedAt.osd,now-1000);
  assert.equal(device.propertyObservedAt.state,null);
  assert.equal(device.propertyProfile.name,'mavic3');
  assert.doesNotMatch(JSON.stringify(device),/PRIVATE_BATTERY|PRIVATE_NONCE/);

  registry.ingest(receive('thing/product/AIR/state',{
    firmware_version:'5.6.7',mode_code_reason:4
  },now-500),now-500);
  device=registry.get('AIR',now);
  assert.equal(device.deviceProperties.state.firmware_version,'5.6.7');
  assert.equal(device.propertyObservedAt.state,now-500);
  assert.equal(device.propertyObservedAt.osd,now-1000);

  registry.ingest(receive('thing/product/AIR/osd',{
    mode_code:14,cameras:[{zoom_factor:30}],battery:{capacity_percent:3}
  },now-200),now-200);
  device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,false);
  assert.equal(device.deviceProperties.osd.cameras[0].zoom_factor,6);
  assert.equal(device.propertyObservedAt.osd,now-1000);
  assert.equal(device.telemetry.battery,60);
});


test('RC Plus 2 stream capabilities preserve safe lens enums, not identifiers',()=>{
  const payload={
    live_capacity:{available_video_number:1,device_list:[{
      sn:'SECRET_AIRCRAFT',camera_list:[{
        camera_index:'89-0-0',video_list:[{
          video_index:'0',
          video_type:'zoom',
          switchable_video_types:['wide','zoom','ir','SECRET_LINK','normal','infrared',
            'https://untrusted.example','visible','thermal','fpv']
        }]
      }]
    }]},
    live_status:[{video_id:'SECRET_AIRCRAFT/89-0-0/0',video_type:'wide',
      video_quality:2,status:1,error_status:0}]
  };
  const known=sanitizeKnownProperties(payload,'state');
  const rc=sanitizeDeviceProperties(known,'state',models[5][0]);
  const camera=rc.live_capacity.device_list[0].camera_list[0];
  assert.equal(camera.camera_index,'89-0-0');
  assert.equal(camera.video_list[0].video_index,'0');
  assert.equal(camera.video_list[0].video_type,'zoom');
  assert.deepEqual(camera.video_list[0].switchable_video_types,
    ['wide','zoom','ir','normal','infrared','visible']);
  assert.equal(rc.live_status[0].video_type,'wide');
  assert.equal(rc.live_status[0].status,1);
  const safe=JSON.stringify(rc);
  for(const forbidden of ['SECRET_AIRCRAFT','SECRET_LINK','untrusted.example'])
    assert.doesNotMatch(safe,new RegExp(forbidden));
  assert.equal(sanitizeKnownProperties(payload,'osd').live_capacity,undefined);
});
test('missing reconnect mode code does not revive disconnected aircraft or stale properties',()=>{
  const registry=createRegistry(),now=1792602000000;
  registry.ingest(topo(now-4000),now-4000);
  const send=(ms,data)=>registry.ingest(receive('thing/product/AIR/osd',data,ms),ms);
  send(now-3000,{mode_code:4,battery:{capacity_percent:78},
    cameras:[{remain_photo_num:12}],latitude:49.12,longitude:8.23});
  send(now-2000,{mode_code:14,battery:{capacity_percent:50},
    cameras:[{remain_photo_num:9}],latitude:49.13,longitude:8.24});
  const update=send(now-1000,{battery:{capacity_percent:20},
    cameras:[{remain_photo_num:4}],latitude:49.14,longitude:8.25});
  assert.equal(update.point,null);
  let device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,false);
  assert.equal(device.telemetry.battery,78);
  assert.equal(device.deviceProperties.osd.cameras[0].remain_photo_num,12);
  assert.equal(device.propertyObservedAt.osd,now-3000);
  send(now-100,{mode_code:4,battery:{capacity_percent:19},
    cameras:[{remain_photo_num:3}]});
  device=registry.get('AIR',now);
  assert.equal(device.aircraftConnected,true);
  assert.equal(device.telemetry.battery,19);
  assert.equal(device.deviceProperties.osd.cameras[0].remain_photo_num,3);
});
test('DJI null position and partial coordinate updates preserve prior accepted raw position',()=>{
  const registry=createRegistry(),now=1792604000000;
  registry.ingest(topo(now-5000),now-5000);
  const send=(ms,data)=>registry.ingest(receive('thing/product/AIR/osd',data,ms),ms);
  send(now-4000,{mode_code:4,latitude:49.1,longitude:8.2,wind_speed:2});
  send(now-3000,{mode_code:4,latitude:0,longitude:0,wind_speed:3});
  let d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,49.1);
  assert.equal(d.deviceProperties.osd.longitude,8.2);
  assert.equal(d.deviceProperties.osd.wind_speed,3);
  send(now-2000,{mode_code:4,latitude:50.3,wind_speed:4});
  d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,49.1);
  assert.equal(d.deviceProperties.osd.longitude,8.2);
  assert.equal(d.deviceProperties.osd.wind_speed,4);
  send(now-1000,{mode_code:4,latitude:50.3,longitude:9.4});
  d=registry.get('AIR',now);
  assert.equal(d.deviceProperties.osd.latitude,50.3);
  assert.equal(d.deviceProperties.osd.longitude,9.4);
});

test('WGS84 Southern and Western coordinates are kept despite DJI float-table typo',()=>{
  for(const model of [models[0][0],models[3][0],models[4][0]]) {
    const filtered=sanitizeDeviceProperties(sanitizeKnownProperties({
      latitude:-33.8568,longitude:-151.2153
    },'osd'),'osd',model);
    assert.equal(filtered.latitude,-33.8568);
    assert.equal(filtered.longitude,-151.2153);
    const bad=sanitizeDeviceProperties(sanitizeKnownProperties({
      latitude:91,longitude:-181
    },'osd'),'osd',model);
    assert.equal(bad.latitude,undefined);
    assert.equal(bad.longitude,undefined);
  }
});

test('official RC Plus 2 web schema has seven documented additions to legacy RC Pro',()=>{
  const profile=source.profiles.rcPlus2;
  const properties=profile.fields.map(item=>item.path);
  assert.equal(profile.sourceEdition,'2025-09-03');
  for(const name of [
    'wireless_link.4g_link_state','wireless_link.4g_quality',
    'wireless_link.4g_uav_quality','wireless_link.4g_gnd_quality',
    'wireless_link.4g_freq_band','cloud_control_auth','drc_state'
  ])assert.ok(properties.includes(name));
  assert.ok(!properties.includes('country'));
  assert.equal(profile.fields.find(f=>f.path==='cloud_control_auth').privacy,'redacted');
});
test('RC Plus 2 genuine 4G link and DRC state are decoded on their documented channel',()=>{
  const model=models[5][0];
  const input={
    wireless_link:{'4g_link_state':1,'4g_quality':4,
      '4g_uav_quality':3,'4g_gnd_quality':2,'4g_freq_band':1800,
      'private_imei':'SENSITIVE'},
    drc_state:2,cloud_control_auth:['flight','SENSITIVE_SECRET'],
    capacity_percent:75
  };
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties(input,'osd'),'osd',model);
  assert.equal(osd.wireless_link['4g_link_state'],1);
  assert.equal(osd.wireless_link['4g_quality'],4);
  assert.equal(osd.wireless_link['4g_uav_quality'],3);
  assert.equal(osd.wireless_link['4g_gnd_quality'],2);
  assert.equal(osd.wireless_link['4g_freq_band'],1800);
  assert.equal(osd.drc_state,2);
  assert.equal(osd.capacity_percent,75);
  assert.equal(osd.cloud_control_auth,undefined);
  assert.doesNotMatch(JSON.stringify(osd),/SENSITIVE/);
  const state=sanitizeDeviceProperties(sanitizeKnownProperties(input,'state'),'state',model);
  assert.equal(state.drc_state,undefined);
  assert.equal(state.cloud_control_auth,undefined);
});

test('Matrice 4T provisional aircraft schema exposes six sourced read-only candidates',()=>{
  const profile=source.profiles.matrice4T;
  assert.match(profile.extensionSource,/pilot-to-cloud\/mqtt\/aircraft\/properties\.html/);
  assert.equal(profile.extensionSourceEdition,'2024-06-28');
  const paths=profile.fields.map(item=>item.path);
  for(const path of ['distance_limit_status','distance_limit_status.state',
    'distance_limit_status.distance_limit','distance_limit_status.is_near_distance_limit',
    'rth_altitude','rc_lost_action']) assert.ok(paths.includes(path),path);
  const model=models[3][0];
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties({
    distance_limit_status:{state:1,distance_limit:8000,is_near_distance_limit:0},
    rth_altitude:120,rc_lost_action:2,device_secret:'PRIVATE'
  },'osd'),'osd',model);
  assert.equal(osd.distance_limit_status.distance_limit,8000);
  assert.equal(osd.rth_altitude,120);
  assert.equal(osd.rc_lost_action,2);
  assert.doesNotMatch(JSON.stringify(osd),/PRIVATE/);
  const invalid=sanitizeDeviceProperties(sanitizeKnownProperties({
    distance_limit_status:{state:1,distance_limit:9000},
    rth_altitude:501,rc_lost_action:65535
  },'osd'),'osd',model);
  assert.equal(invalid.distance_limit_status.distance_limit,undefined);
  assert.equal(invalid.rth_altitude,undefined);
  // Unknown enum codes and DJI 65535 sentinels are rejected, not treated
  // as valid RC-loss actions.
  assert.equal(invalid.rc_lost_action,undefined);
});

test('M4T generic aircraft 2024 reference preserves bounded RID and commander states',()=>{
  const model=models[3][0];
  const osd=sanitizeDeviceProperties(sanitizeKnownProperties({
    rid_state:true, latitude:-33.1,longitude:-150.2,
    device_secret:'HIDDEN'
  },'osd'),'osd',model);
  assert.equal(osd.rid_state,true);
  assert.equal(osd.latitude,-33.1);
  assert.equal(osd.longitude,-150.2);
  const state=sanitizeDeviceProperties(sanitizeKnownProperties({
    payloads:[{payload_index:'89-0-0',firmware_version:'03.01.200',
      sn:'PAYLOAD_SERIAL',control_source:'SECRET_OPERATOR'}],
    wpmz_version:'1.0.2', current_rth_mode:1,
    commander_mode_lost_action:0,current_commander_flight_mode:1,
    commander_flight_height:25.5,home_latitude:-33.2,home_longitude:-150.1,
    device_secret:'HIDDEN'
  },'state'),'state',model);
  assert.equal(state.payloads[0].payload_index,'89-0-0');
  assert.equal(state.payloads[0].firmware_version,'03.01.200');
  assert.equal(state.payloads[0].sn,undefined);
  assert.equal(state.payloads[0].control_source,undefined);
  assert.equal(state.wpmz_version,'1.0.2');
  assert.equal(state.current_rth_mode,1);
  assert.equal(state.commander_flight_height,25.5);
  assert.equal(state.home_latitude,-33.2);
  assert.equal(state.home_longitude,-150.1);
  assert.doesNotMatch(JSON.stringify(state),/PAYLOAD_SERIAL|SECRET_OPERATOR|HIDDEN/);
  assert.equal(sanitizeDeviceProperties(sanitizeKnownProperties({
    rid_state:3, current_rth_mode:99,commander_flight_height:5000
  },'osd'),'osd',model).rid_state,undefined);
});
test('dynamic keyed DJI gimbal OSD accepts validated numerical values only for provisional M4T',()=>{
  const values={
    '89-0-0':{gimbal_pitch:-28.4,gimbal_yaw:17.8,gimbal_roll:2.2,
      measure_target_longitude:-150.12,measure_target_latitude:-34.12,
      measure_target_altitude:165.2,measure_target_distance:88.9,
      measure_target_error_state:0, zoom_factor:9.2,
      sn:'VERY_SECRET_SN',unrecognized:'TOP_SECRET'},
    'malicious_key':{gimbal_pitch:77},'1-2-3':{password:'TOP_SECRET'},
    '9999-1-2':{gimbal_pitch:3}
  };
  const known=sanitizeKnownProperties(values,'osd');
  const t=sanitizeDeviceProperties(known,'osd',models[3][0]);
  assert.equal(t.payload_gimbals.length,1);
  const g=t.payload_gimbals[0];
  assert.equal(g.payload_index,'89-0-0');
  assert.equal(g.gimbal_pitch,-28.4);
  assert.equal(g.measure_target_latitude,-34.12);
  assert.equal(g.measure_target_longitude,-150.12);
  assert.equal(g.measure_target_error_state,0);
  assert.doesNotMatch(JSON.stringify(known),/VERY_SECRET_SN|TOP_SECRET|malicious_key/);
  for(const other of [models[0][0],models[2][0],models[4][0],models[5][0]]){
    assert.equal(sanitizeDeviceProperties(known,'osd',other).payload_gimbals,undefined);
  }
});
test('dynamic gimbal rejects sentinels, incomplete target coordinates and unsafe caller-provided objects',()=>{
  const model=models[3][0];
  const clean=sanitizeDeviceProperties(sanitizeKnownProperties({
    '89-0-0':{gimbal_pitch:65535,measure_target_latitude:-35,measure_target_error_state:99,
      zoom_factor:7.0}
  },'osd'),'osd',model).payload_gimbals[0];
  assert.equal(clean.gimbal_pitch,undefined);
  assert.equal(clean.measure_target_latitude,undefined);
  assert.equal(clean.measure_target_error_state,undefined);
  assert.equal(clean.zoom_factor,7);
  const forged=sanitizeDeviceProperties({
    payload_gimbals:[{payload_index:'89-0-0',gimbal_pitch:2,sn:'SECRET',token:'HIDDEN'}]
  },'osd',model).payload_gimbals;
  assert.equal(forged[0].gimbal_pitch,2);
  assert.doesNotMatch(JSON.stringify(forged),/SECRET|HIDDEN/);
  const invalid=sanitizeDeviceProperties({payload_gimbals:[{payload_index:'__proto__',password:'HIDDEN'}]},'osd',model);
  assert.equal(invalid.payload_gimbals,undefined);
});
