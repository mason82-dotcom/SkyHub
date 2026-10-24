'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dual=require('../../frontend/public/wpml-m3m-dual-optics-core');
const survey=require('../../frontend/public/wpml-survey-preview-core');

// Synthetic mm values used to exercise math. NOT verified M3M calibration.
const rgb=Object.freeze({
  sensorWidthMm:13.2,sensorHeightMm:8.8,focalLengthMm:8.8,
  imageWidthPx:5280,imageHeightPx:3956,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:5
});
const ms=Object.freeze({
  sensorWidthMm:6,sensorHeightMm:4.5,focalLengthMm:5,
  imageWidthPx:2592,imageHeightPx:1944,heightAGLM:60,
  sideOverlapPercent:70,frontOverlapPercent:80,speedMps:5
});
const input=()=>({rgb:{...rgb},multispectral:{...ms}});
const area=[{lat:48,lon:8},{lat:48,lon:8.001},
  {lat:48.001,lon:8.001},{lat:48.001,lon:8}];

test('compares two independent optical footprints, never deriving RGB from MS optics',()=>{
  const r=dual.compare(input());
  assert.equal(r.rgb.imageWidthPx,5280);
  assert.equal(r.multispectral.imageWidthPx,2592);
  assert.ok(Math.abs(r.rgb.groundWidthM-90)<1e-9);
  assert.ok(Math.abs(r.multispectral.groundWidthM-72)<1e-9);
  assert.ok(Math.abs(r.nominalStripSpacingM-21.6)<1e-8);
  assert.ok(Math.abs(r.nominalPhotoSpacingM-10.8)<1e-8);
  assert.ok(Math.abs(r.nominalIntervalSeconds-2.16)<1e-8);
  assert.ok(Math.abs(r.maxTheoreticalSpeedMps-5.4)<1e-8);
  assert.equal(r.effectiveMinIntervalSeconds,2);
  assert.equal(r.meetsNumericalCadence,true);
  assert.equal(r.coRegistrationVerified,false);
  assert.equal(r.relativeBoresightVerified,false);
  assert.equal(r.cameraHardwareVerified,false);
  assert.equal(r.pilot2HardwareVerified,false);
  assert.equal(r.opticalCalibrationVerified,false);
  assert.equal(r.terrainVerified,false);
  assert.equal(r.geofenceVerified,false);
  assert.equal(r.actualCaptureSupported,null);
  assert.equal(r.flightReady,false);
  assert.equal(r.exportableAsWaylines,false);
  assert.equal(r.dispatchAllowed,false);
  assert.ok(Object.isFrozen(r));
});
test('fast cruise speed and stricter user camera interval fail cadence without flight approval',()=>{
  const fast=input();
  fast.rgb.speedMps=8;fast.multispectral.speedMps=8;
  const a=dual.compare(fast);
  assert.equal(a.meetsNumericalCadence,false);
  assert.equal(a.flightReady,false);
  const slow=input();
  slow.multispectral.cameraMinIntervalSeconds=3;
  const b=dual.compare(slow);
  assert.equal(b.effectiveMinIntervalSeconds,3);
  assert.equal(b.meetsNumericalCadence,false);
  assert.equal(b.flightReady,false);
  const stricter=input();
  stricter.rgb.cameraMinIntervalSeconds=4;
  const c=dual.compare(stricter);
  assert.equal(c.effectiveMinIntervalSeconds,4);
});
test('refuses camera confusion, cadence understatement, missing optical details and mismatched flight assumptions',()=>{
  assert.throws(()=>dual.compare({}),/manually supplied optics required/);
  const missing=input();delete missing.rgb.focalLengthMm;
  assert.throws(()=>dual.compare(missing),/Camera reference invalid/);
  const badPixels=input();badPixels.rgb.imageWidthPx=2592;
  assert.throws(()=>dual.compare(badPixels),/image dimensions differ/);
  const badCadence=input();badCadence.rgb.cameraMinIntervalSeconds=0.7;
  assert.throws(()=>dual.compare(badCadence),/below mixed RGB\/MS reference/);
  const mismatchAGL=input();mismatchAGL.rgb.heightAGLM=61;
  assert.throws(()=>dual.compare(mismatchAGL),/AGL differ/);
  const mismatchSpeed=input();mismatchSpeed.multispectral.speedMps=6;
  assert.throws(()=>dual.compare(mismatchSpeed),/airspeeds differ/);
});
test('count estimate uses only bounded coverage segments with five theoretical files per event',()=>{
  const r=dual.compare(input());
  const geo=survey.preview(area,{heading:0,spacing:r.nominalStripSpacingM});
  const count=dual.estimate(input(),geo);
  assert.ok(count.nominalCaptureEvents>0);
  assert.equal(count.nominalRGBJpegFiles,count.nominalCaptureEvents);
  assert.equal(count.nominalMultispectralTiffFiles,count.nominalCaptureEvents*4);
  assert.equal(count.nominalTotalFiles,count.nominalCaptureEvents*5);
  assert.equal(count.transitionCoverageIncluded,false);
  assert.equal(count.photoActionsGenerated,false);
  assert.equal(count.coRegistrationVerified,false);
  assert.equal(count.flightReady,false);
  assert.equal(count.dispatchAllowed,false);
});
test('rejects geometry spoofing and any mismatched strip spacing',()=>{
  const r=dual.compare(input());
  const geo=survey.preview(area,{heading:0,spacing:r.nominalStripSpacingM});
  assert.throws(()=>dual.estimate(input(),{...geo,flightReady:true}),
    /matching offline bounded survey geometry/);
  assert.throws(()=>dual.estimate(input(),{...geo,exportableAsWaylines:true}),
    /matching offline bounded survey geometry/);
  assert.throws(()=>dual.estimate(input(),{...geo,lineSpacingMeters:40}),
    /matching offline bounded survey geometry/);
  const invalid={...geo,segments:[{...geo.segments[0],kind:'transit'}]};
  assert.throws(()=>dual.estimate(input(),invalid),/non-coverage segment/);
});
test('the dual comparison has no transport, camera actions, DJI dispatch or KMZ generation',()=>{
  const code=fs.readFileSync(path.join(__dirname,
    '../../frontend/public/wpml-m3m-dual-optics-core.js'),'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.connect|\/api\/mission\/create/);
  assert.doesNotMatch(code,/\bcreateKmz\s*\(|\bpackageKmz\s*\(|waylines\.wpml/);
});
