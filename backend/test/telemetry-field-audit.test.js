'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {summarizeTelemetryFields,GATEWAY_FIELDS,AIRCRAFT_FIELDS}=require('../telemetry-field-profile');
test('RC five-field inventory does not mislabel aircraft-only fields as missing',()=>{
  const [rc]=summarizeTelemetryFields([{role:'gateway',modelName:'DJI RC Pro Enterprise',
    fresh:true,positionFresh:true,telemetry:{
      latitude:49.1,longitude:8.4,heightEllipsoid:120,battery:80,linkQuality:4
    }}]);
  assert.deepEqual(rc.observed,GATEWAY_FIELDS);
  assert.deepEqual(rc.notObserved,[]);
  assert.equal(rc.typicalTotal,5);
  assert.ok(rc.notApplicable.includes('horizontalSpeed'));
  assert.ok(!JSON.stringify(rc).includes('49.1'));
});
test('Mavic snapshot reports two missing GNSS coordinates, not RC SDR quality',()=>{
  const [air]=summarizeTelemetryFields([{role:'subdevice',deviceCategory:'aircraft',
    modelName:'Mavic 3M',fresh:true,positionFresh:false,positionUnavailable:true,
    telemetry:{altitude:0,heightEllipsoid:5,battery:50,heading:90,
      horizontalSpeed:0,verticalSpeed:0,attitudePitch:0,attitudeRoll:0,
      homeDistance:0,remainingFlightTime:400,gpsSatellites:12,
      rtkSatellites:0,rtkFixState:0,positionQuality:3
    }}]);
  assert.equal(air.typicalTotal,16);
  assert.equal(air.observed.length,14);
  assert.deepEqual(air.notObserved,['latitude','longitude']);
  assert.ok(air.notApplicable.includes('linkQuality'));
  assert.equal(air.positionUnavailable,true);
  assert.ok(AIRCRAFT_FIELDS.includes('rtkFixState'));
});
test('optional DJI values are distinguished from typical and not applicable',()=>{
  const report=summarizeTelemetryFields([
    {role:'gateway',telemetry:{sdrLinkState:0,fourGLinkState:1,fourGLinkQuality:3}},
    {deviceCategory:'aircraft',telemetry:{windSpeed:0,windDirectionCode:8}}
  ]);
  assert.deepEqual(report[0].extraObserved,['sdrLinkState','fourGLinkState','fourGLinkQuality']);
  assert.deepEqual(report[1].extraObserved,['windSpeed','windDirectionCode']);
  assert.ok(report[0].notApplicable.includes('windSpeed'));
  assert.ok(report[1].notApplicable.includes('sdrLinkState'));
});
test('inventory exposes no raw values or device serials',()=>{
  const report=summarizeTelemetryFields([{sn:'SENSITIVE_SERIAL',
    gatewaySn:'RC_SECRET',modelName:'SENSITIVE_MODEL',role:'gateway',
    telemetry:{latitude:49.998899,longitude:8.123456,battery:60}}]);
  assert.doesNotMatch(JSON.stringify(report),/SENSITIVE_SERIAL|RC_SECRET|SENSITIVE_MODEL|49.998899|8.123456/);
});
test('privacy-safe telemetry audit help does not contact Docker',()=>{
  const cli=path.resolve(__dirname,'../../scripts/pi-telemetry-fields-check.js');
  const out=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/Nur empfangene Feldnamen/);
  assert.doesNotMatch(out.stdout,/latitude.*[0-9]/);
});
