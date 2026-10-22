'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {captureUuidFromXmp,summarizeCaptureGroups,validateCaptureAggregate}
  =require('../m3m-xmp-capture-groups');
const idA='3377fb05b357448fb877023daebbaed3';
const idB='3377fb05b357448fb877023daebbaed4';
const idC='3377fb05b357448fb877023daebbaed5';
const wrap=x=>Buffer.from('<x:xmpmeta><rdf:RDF '+
  'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">'+
  '<rdf:Description '+x+' /></rdf:RDF></x:xmpmeta>');
const row=(captureUuid,bandHint,status='ok')=>({captureUuid,bandHint,status});

test('DJI v4 Capture UUID is extracted only once from proper namespace',()=>{
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUUID="'+idA+'"')),idA);
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUuid="'+idA+'"')),idA);
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUUID="'+idA.toUpperCase()+'"')),idA);
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUUID="'+idA+'" '+
    'drone-dji:CaptureUuid="'+idA+'"')),null);
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUUID="SERIAL-PRIVATE"')),null);
  assert.equal(captureUuidFromXmp(wrap('drone-dji:CaptureUUID="00000000000000000000000000000000"')),null);
  assert.equal(captureUuidFromXmp(Buffer.from('CaptureUUID="'+idA+'"')),null);
  assert.equal(captureUuidFromXmp(Buffer.alloc(32769,88)),null);
});

test('UUID grouping counts possible R+NIR candidates separately from full four-band groups',()=>{
  const rows=[
    row(idA,'R'),row(idA,'NIR'), // one possible R/NIR pair
    row(idB,'R'),row(idB,'R'),row(idB,'NIR'), // duplicated R => no candidate
    row(idC,'G'),row(idC,'R'),row(idC,'RE'),row(idC,'NIR'),
    row(null,'NIR'),row(null,'unknown')
  ];
  const r=summarizeCaptureGroups(rows);
  assert.equal(r.examined,11);
  assert.equal(r.withCaptureUuid,9);
  assert.equal(r.withoutCaptureUuid,2);
  assert.equal(r.uniqueCaptureUuidGroups,3);
  assert.equal(r.redNirCandidateGroups,2);
  assert.equal(r.fullFourBandHintGroups,1);
  assert.equal(r.groupsWithDuplicateBands,1);
  assert.equal(r.incompleteBandHintGroups,2);
  assert.equal(r.bandHints.R,4);
  assert.equal(r.bandHints.NIR,4);
  for(const key of ['m3mSourceVerified','bandCoregistrationVerified',
    'radiometricCalibrationVerified','reflectanceReady','ndviReady','ndreReady'])
    assert.equal(r[key],false);
  assert.deepEqual(validateCaptureAggregate(r,rows.length),r);
  assert.doesNotMatch(JSON.stringify(r),
    /3377fb05|PRIVATE|SERIAL|GPS|CaptureUUID|captureUuid/);
});

test('ambiguous and missing band labels prevent capture candidate pairing',()=>{
  const r=summarizeCaptureGroups([
    row(idA,'R'),row(idA,'NIR'),row(idA,'unknown'),
    row(idB,'R'),row(null,'NIR')
  ]);
  assert.equal(r.redNirCandidateGroups,0);
  assert.equal(r.groupsWithUnresolvedBands,1);
  assert.equal(r.uniqueCaptureUuidGroups,2);
  assert.equal(r.withoutCaptureUuid,1);
});

test('capture aggregate receiver refuses identifiers, extra fields, impossible or unsafe counts',()=>{
  const r=summarizeCaptureGroups([row(idA,'R'),row(idA,'NIR')]);
  const bad=[
    {...r,captureUuid:idA},
    {...r,redNirCandidateGroups:2},
    {...r,fullFourBandHintGroups:1},
    {...r,uniqueCaptureUuidGroups:3},
    {...r,withoutCaptureUuid:2},
    {...r,bandHints:{...r.bandHints,G:1}},
    {...r,status:{...r.status,ok:3}},
    {...r,imagePayloadVerified:true},
    {...r,caveat:'PRIVATE_OBJECT_KEY'},
    {...r,status:{...r.status,SERIAL:1}}
  ];
  for(const value of bad)
    assert.throws(()=>validateCaptureAggregate(value,2),RangeError);
  assert.throws(()=>summarizeCaptureGroups(Array(13).fill(row(idA,'R'))),RangeError);
  assert.throws(()=>summarizeCaptureGroups([row('SECRET_FILE_ID','R')]),RangeError);
});
