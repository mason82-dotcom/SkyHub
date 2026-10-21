'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {evaluateHardwareSession,formatReport}=require('../hardware-validation');

const now=1792609000000;
const rc={
  sn:'PRIVATE_RC_SERIAL',role:'gateway',model:{domain:'2',type:144,subType:0},
  modelName:'DJI RC Pro Enterprise',topologyOnline:true,
  children:['PRIVATE_AIR_SERIAL'],lastTelemetryAt:now-1500,
  fresh:true,telemetryTimeVerified:true,topologyTimeVerified:true,
  propertyProfile:{name:'rcPro',confidence:'official-device'},
  propertyObservedAt:{osd:now-1500,state:now-2500},
  propertyFieldObservedAt:{osd:{capacity_percent:now-1500},state:{firmware_version:now-2500}},
  deviceProperties:{osd:{capacity_percent:80},state:{firmware_version:'1.2.3'}},
  telemetry:{battery:80}
};
const air={
  sn:'PRIVATE_AIR_SERIAL',gatewaySn:'PRIVATE_RC_SERIAL',
  role:'subdevice',model:{domain:'0',type:77,subType:2},
  modelName:'Mavic 3M',topologyOnline:true,aircraftConnected:true,
  lastTelemetryAt:now-1200,fresh:true,positionFresh:true,
  propertyProfile:{name:'mavic3',confidence:'shared-family-unverified'},
  propertyObservedAt:{osd:now-1200,state:now-4200},
  propertyFieldObservedAt:{osd:{mode_code:now-1200,'battery.capacity_percent':now-1200},
    state:{firmware_version:now-4200}},
  deviceProperties:{osd:{mode_code:4,battery:{capacity_percent:53}},state:{firmware_version:'9.8.7'}},
  telemetry:{battery:53,latitude:49.123456,longitude:8.123456}
};
const health={
  mqtt:true,subscribed:true,topologyReplyEnabled:true,topologyReplySent:4,
  topologyReplyErrors:0,mqttObservedOsdPackets:80,mqttOsdMessages:70,
  mqttValidTelemetryUpdates:60,mqttObservedChannelCounts:{status:5,state:12}
};
const shapes=[
  {channel:'osd',dataKeys:['capacity_percent','mode_code','password',
    'PRIVATE_RC_SERIAL','latitude','longitude']},
  {channel:'state',dataKeys:['firmware_version','PRIVATE_AIR_SERIAL']}
];

test('healthy paired RC Pro Enterprise and Mavic 3M are linked and have current OSD',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  assert.equal(report.linked,true);
  assert.equal(report.controller.seen,true);
  assert.equal(report.aircraft.seen,true);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
  assert.equal(report.aircraft.aircraftConnected,true);
  assert.equal(report.controller.propertyFields.documented,48);
  assert.equal(report.aircraft.propertyFields.documented,144);
  assert.ok(report.aircraft.propertyFields.freshNames.includes('osd:mode_code'));
  const text=formatReport(report);
  assert.match(text,/RC Pro Enterprise \+ Mavic 3M/);
  assert.match(text,/BESTÄTIGT/);
  assert.doesNotMatch(text,/PRIVATE|49\.123456|8\.123456|9\.8\.7|1\.2\.3|password/);
});

test('missing aircraft, disconnected or stale telemetry are not mistakenly confirmed',()=>{
  const noAircraft=evaluateHardwareSession([rc],health,shapes,now);
  assert.equal(noAircraft.linked,false);
  assert.equal(noAircraft.aircraft.seen,false);
  assert.ok(noAircraft.stages.some(x=>x.status==='NICHT NACHGEWIESEN'));
  const stale=evaluateHardwareSession([rc,{...air,lastTelemetryAt:now-30000,
    fresh:false,aircraftConnected:false}],health,shapes,now);
  assert.equal(stale.linked,true);
  assert.equal(stale.aircraft.osdFresh,false);
  assert.equal(stale.aircraft.aircraftConnected,false);
  assert.ok(stale.stages.some(x=>x.step.includes('M3M verbunden')&&x.status==='NICHT AKTUELL'));
});

test('two unrelated devices never satisfy the paired topology test',()=>{
  const other={...air,gatewaySn:'OTHER_CONTROLLER_SERIAL'};
  const result=evaluateHardwareSession([rc,other],health,shapes,now);
  assert.equal(result.linked,false);
  assert.ok(result.stages.some(x=>x.step==='RC und M3M zugeordnet'&&x.status!=='BESTÄTIGT'));
  assert.doesNotMatch(formatReport(result),/OTHER_CONTROLLER_SERIAL/);
});

test('unrecognized status/OSD root keys are excluded from printed shape field names',()=>{
  const report=evaluateHardwareSession([rc,air],health,shapes,now);
  assert.ok(report.transport.osdShapeFields.includes('latitude'));
  assert.ok(report.transport.osdShapeFields.includes('mode_code'));
  assert.ok(!report.transport.osdShapeFields.includes('password'));
  assert.ok(!report.transport.stateShapeFields.includes('PRIVATE_AIR_SERIAL'));
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_RC_SERIAL|PRIVATE_AIR_SERIAL|49\.123456|9\.8\.7/);
});

test('Pi hardware-check help does not use Docker or require a connected drone',()=>{
  const file=path.resolve(__dirname,'../../scripts/pi-rc-pro-m3m-check.js');
  const out=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/RC Pro Enterprise \+ Mavic 3M/);
  assert.doesNotMatch(out.stdout,/PRIVATE|192\.168\./);
});

test('legacy backend without new DJI-property API remains transport-valid but field coverage is unknown',()=>{
  const legacyRC={...rc,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const legacyM3M={...air,propertyProfile:undefined,deviceProperties:undefined,
    propertyObservedAt:undefined,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([legacyRC,legacyM3M],health,shapes,now);
  assert.equal(report.linked,true);
  assert.equal(report.controller.osdFresh,true);
  assert.equal(report.aircraft.osdFresh,true);
  assert.equal(report.controller.propertyDiagnosticsAvailable,false);
  assert.equal(report.aircraft.propertyDiagnosticsAvailable,false);
  assert.equal(report.controller.propertyFields.documented,48);
  assert.equal(report.aircraft.propertyFields.documented,144);
  assert.equal(report.controller.propertyFields.observed,null);
  assert.equal(report.aircraft.propertyFields.missing,null);
  assert.ok(report.stages.filter(x=>x.step.includes('State-Feldbeobachtung'))
    .every(x=>x.status==='NICHT PRÜFBAR'));
  const printed=formatReport(report);
  assert.match(printed,/Feldparser: NICHT PRÜFBAR/);
  assert.match(printed,/beobachtete\/fehlende Pfade: nicht ermittelbar/);
  assert.doesNotMatch(printed,/beobachtet: 0 \| frisch: 0/);
  assert.doesNotMatch(printed,/PRIVATE|49\.123456|8\.123456/);
});

test('partial DJI property interface is not treated as a complete field audit',()=>{
  const incomplete={...air,propertyFieldObservedAt:undefined};
  const report=evaluateHardwareSession([rc,incomplete],health,shapes,now);
  assert.equal(report.aircraft.propertyDiagnosticsAvailable,false);
  assert.equal(report.aircraft.propertyFields.observed,null);
  assert.equal(report.controller.propertyDiagnosticsAvailable,true);
  assert.ok(report.stages.some(x=>x.step.includes('M3M State-')&&x.status==='NICHT PRÜFBAR'));
});
