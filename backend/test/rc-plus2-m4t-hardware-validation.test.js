'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {evaluateHardwareSession,formatReport}=
  require('../rc-plus2-m4t-hardware-validation');
const {fieldDefinitions}=require('../dji-properties');
const NOW=1792609000000;

const rc={
  sn:'PRIVATE_RC_PLUS_2',role:'gateway',
  model:{domain:'2',type:174,subType:0},
  modelName:'DJI RC Plus 2 Enterprise',
  children:['PRIVATE_M4T'],topologyOnline:true,
  fresh:true,lastTelemetryAt:NOW-1200,
  propertyProfile:{name:'rcPlus2',confidence:'official-device-web'},
  deviceProperties:{
    osd:{capacity_percent:80,latitude:49.123456,longitude:8.123456},
    state:{firmware_version:'2.0.0'}
  },
  propertyObservedAt:{osd:NOW-1200,state:NOW-4000},
  propertyFieldObservedAt:{
    osd:{capacity_percent:NOW-1200,latitude:NOW-1200,longitude:NOW-1200},
    state:{firmware_version:NOW-4000}
  }
};
const drone={
  sn:'PRIVATE_M4T',gatewaySn:'PRIVATE_RC_PLUS_2',
  role:'subdevice',deviceCategory:'aircraft',
  model:{domain:'0',type:99,subType:1},modelName:'Matrice 4T',
  topologyOnline:true,aircraftConnected:true,
  fresh:true,lastTelemetryAt:NOW-1100,
  propertyProfile:{
    name:'matrice4T',
    confidence:'shared-aircraft-with-web-extensions-unverified'
  },
  deviceProperties:{
    osd:{mode_code:0,latitude:49.123456,longitude:8.123456,
      payload_gimbals:[{payload_index:'89-0-0',gimbal_pitch:-5.5}]},
    state:{firmware_version:'3.0.0'}
  },
  propertyObservedAt:{osd:NOW-1100,state:NOW-8000},
  propertyFieldObservedAt:{
    osd:{mode_code:NOW-1100,latitude:NOW-1100,longitude:NOW-1100,
      'payload_gimbals.gimbal_pitch':NOW-1100},
    state:{firmware_version:NOW-8000}
  }
};
const health={
  mqtt:true,subscribed:true,topologyReplyEnabled:true,
  topologyReplySent:3,topologyReplyErrors:0,
  mqttObservedOsdPackets:200,mqttOsdMessages:190
};
const shapes=[
  {channel:'osd',dataKeys:['mode_code','capacity_percent','latitude',
    'PRIVATE_RC_PLUS_2','device_secret','malicious-token',
    'payload_gimbals']},
  {channel:'state',dataKeys:['firmware_version','PRIVATE_M4T']}
];

test('model keys and documented Cloud API 1.18 profiles remain distinct',()=>{
  const rcFields=fieldDefinitions(rc.model);
  const airFields=fieldDefinitions(drone.model);
  assert.equal(rcFields.profile,'rcPlus2');
  assert.equal(rcFields.fields.length,54);
  assert.equal(rcFields.confidence,'official-device-web');
  assert.equal(airFields.profile,'matrice4T');
  assert.equal(airFields.fields.length,199);
  assert.match(airFields.confidence,/unverified/);
  assert.equal(airFields.dynamicPayload.fields.length,9);
});
test('genuine linked RC Plus 2 and Matrice 4T pass transport smoke test',()=>{
  const report=evaluateHardwareSession([rc,drone],health,shapes,NOW);
  assert.equal(report.passed,true);
  assert.equal(report.candidateCount.linkedPairs,1);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
  assert.equal(report.controller.fields.documented,54);
  assert.equal(report.aircraft.fields.documented,199);
  assert.equal(report.aircraft.dynamicFields.documented,9);
  assert.ok(report.controller.fields.freshNames.includes('osd:capacity_percent'));
  assert.ok(report.aircraft.dynamicFields.observedNames.includes('gimbal_pitch'));
  assert.ok(report.stages.every(x=>x.status==='BESTÄTIGT'));
});
test('read-only report never exposes device IDs, GPS values or firmware versions',()=>{
  const report=evaluateHardwareSession([rc,drone],health,shapes,NOW);
  const print=formatReport(report);
  assert.match(print,/Smoketest: BESTANDEN/);
  for(const secret of ['PRIVATE_RC_PLUS_2','PRIVATE_M4T','49.123456',
    '8.123456','2.0.0','3.0.0','-5.5','device_secret',
    'malicious-token']){
    assert.ok(!print.includes(secret),secret+' leaked to report');
    assert.ok(!JSON.stringify(report).includes(secret),secret+' leaked to data');
  }
  assert.ok(!report.transport.osdShapeFields.includes('device_secret'));
  assert.ok(!report.transport.stateShapeFields.includes('PRIVATE_M4T'));
});
test('legacy RC Pro and Mavic 3M can coexist but never satisfy the target test',()=>{
  const oldRc={sn:'OLD_RC',role:'gateway',
    model:{domain:'2',type:144,subType:0},children:['OLD_M3M'],
    topologyOnline:true};
  const oldAir={sn:'OLD_M3M',gatewaySn:'OLD_RC',role:'subdevice',
    model:{domain:'0',type:77,subType:2},topologyOnline:true};
  const report=evaluateHardwareSession([oldRc,oldAir],health,shapes,NOW);
  assert.equal(report.passed,false);
  assert.equal(report.controller.seen,false);
  assert.equal(report.aircraft.seen,false);
});
test('cross-paired or unlinked aircraft fail even if OSD appears fresh',()=>{
  const report=evaluateHardwareSession([rc,{...drone,gatewaySn:'OLD_RC'}],
    health,shapes,NOW);
  assert.equal(report.passed,false);
  assert.equal(report.candidateCount.linkedPairs,0);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
});
test('two target pairs are ambiguous and fail closed',()=>{
  const secondRc={...rc,sn:'RC2',children:['M4T2']};
  const secondAir={...drone,sn:'M4T2',gatewaySn:'RC2'};
  const report=evaluateHardwareSession([rc,drone,secondRc,secondAir],
    health,shapes,NOW);
  assert.equal(report.passed,false);
  assert.equal(report.candidateCount.linkedPairs,2);
  assert.ok(report.stages.some(x=>x.status==='MEHRDEUTIG'));
  assert.ok(!formatReport(report).includes('RC2'));
});
test('stale OSD and disconnected aircraft never satisfy the test',()=>{
  const stale=evaluateHardwareSession([rc,{
    ...drone,lastTelemetryAt:NOW-30000,fresh:false
  }],health,shapes,NOW);
  assert.equal(stale.passed,false);
  assert.equal(stale.aircraft.osdFresh,false);
  const disconnected=evaluateHardwareSession([rc,{
    ...drone,aircraftConnected:false
  }],health,shapes,NOW);
  assert.equal(disconnected.passed,false);
});
test('missing runtime field interface means unknown coverage, not zero DJI fields',()=>{
  const old={...drone,deviceProperties:undefined,propertyProfile:undefined,
    propertyFieldObservedAt:undefined,propertyObservedAt:undefined};
  const report=evaluateHardwareSession([rc,old],health,shapes,NOW);
  assert.equal(report.passed,false);
  assert.equal(report.aircraft.fieldInterface,false);
  assert.equal(report.aircraft.fields,null);
  assert.match(formatReport(report),/keine Feldfehlanzahl ableitbar/);
});
test('unrelated profiles cannot fake RC Plus 2 and M4T field acceptance',()=>{
  const wrong={...drone,propertyProfile:{name:'mavic3'}};
  const report=evaluateHardwareSession([rc,wrong],health,shapes,NOW);
  assert.equal(report.passed,false);
  assert.equal(report.aircraft.fieldInterface,false);
});
test('topology acknowledgement remains a mandatory explicit gate',()=>{
  const report=evaluateHardwareSession([rc,drone],{
    ...health,topologyReplyEnabled:false
  },shapes,NOW);
  assert.equal(report.passed,false);
});
test('Pi CLI --help requires neither hardware nor Docker',()=>{
  const filename=path.resolve(__dirname,'../../scripts/pi-rc-plus2-m4t-check.js');
  const exec=spawnSync(process.execPath,[filename,'--help'],
    {encoding:'utf8',timeout:5000});
  assert.equal(exec.status,0,exec.stderr);
  assert.match(exec.stdout,/Cloud API 1.18/);
  assert.match(exec.stdout,/Nur Modell/);
});
