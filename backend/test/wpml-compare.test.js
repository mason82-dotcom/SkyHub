'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const planner=require('../../frontend/public/wpml-editor-core');
const {compareKmz}=require('../wpml-compare');

function plan(){
  return {
    name:'Private Pilot 2 & <Test> Mission',
    model:'mavic3m',speed:5,transitionSpeed:5,takeoffHeight:30,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[
      {lat:49.12345,lon:8.56789,height:50,photo:false},
      {lat:49.12445,lon:8.56889,height:50,photo:false},
      {lat:49.12545,lon:8.56989,height:50,photo:false}
    ]
  };
}
const kmz=p=>Buffer.from(planner.build(p).kmz);

test('two identical DJI WPML KMZs are structurally equal without flight authorization',()=>{
  const a=kmz(plan()),report=compareKmz(a,a);
  assert.equal(report.summary.structuralDifferences,0);
  assert.equal(report.summary.structurallyEqualExcludingVolatileMetadata,true);
  assert.equal(report.summary.bothOfflineValid,true);
  assert.equal(report.summary.flightReady,false);
  assert.equal(report.summary.pilot2HardwareVerified,false);
  assert.equal(report.documents.length,2);
  assert.ok(report.documents.every(x=>x.equal));
  assert.equal(report.left.aircraftModel,'Mavic 3M');
  assert.deepEqual(report.left.waypointCounts,[3]);
});
test('timestamps and author/editor descriptions are ignored, but route speed is reported',()=>{
  const a=plan(),b=plan();
  b.timestamp+=10000;
  b.name='Another confidential author/location';
  assert.equal(compareKmz(kmz(a),kmz(b)).summary.structuralDifferences,0);
  b.speed=7;
  b.transitionSpeed=7;
  const diff=compareKmz(kmz(a),kmz(b));
  assert.ok(diff.summary.structuralDifferences>0);
  assert.ok(diff.documents.some(x=>x.changes.some(y=>y.path.endsWith('/wpml:autoFlightSpeed/#present')===false&&
    y.path.includes('autoFlightSpeed'))));
  assert.equal(diff.summary.bothOfflineValid,true);
  const serialized=JSON.stringify(diff);
  assert.doesNotMatch(serialized,/49\.12345|8\.56789|confidential author|Private Pilot/);
});
test('geographical waypoint changes show path, never raw coordinates',()=>{
  const a=plan(),b=plan();
  b.waypoints[1].lat=49.77777;
  b.waypoints[1].lon=8.33333;
  const diff=compareKmz(kmz(a),kmz(b));
  assert.ok(diff.documents.some(x=>x.changes.some(d=>d.category==='geometry')));
  const json=JSON.stringify(diff);
  assert.doesNotMatch(json,/49\.77777|8\.33333|49\.12445|8\.56889/);
  assert.match(json,/coordinates/);
  assert.match(json,/valuesRedacted/);
});
test('periodic DJI action group differences are detected and reported as actions',()=>{
  const a=plan(),b=plan();
  b.intervalPhotos={type:'multipleDistance',interval:12};
  const report=compareKmz(kmz(a),kmz(b));
  assert.ok(report.summary.structuralDifferences>0);
  assert.ok(report.documents[1].changedByCategory.actions>0);
  assert.equal(report.summary.flightReady,false);
  assert.equal(report.right.valid,true);
});
test('malformed and oversized KMZ input is rejected without content disclosure',()=>{
  const a=kmz(plan());
  assert.throws(()=>compareKmz(a,Buffer.from('private location')),/comparison rejected/);
  assert.throws(()=>compareKmz(Buffer.alloc(12*1024*1024+1),a),/comparison rejected/);
});
test('offline compare CLI has deterministic exit codes and omits raw location data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-wpml-compat-'));
  try{
    const left=path.join(dir,'original.kmz'),right=path.join(dir,'candidate.kmz');
    const script=path.join(__dirname,'../../scripts/wpml-compare.js');
    const a=plan(),b=plan();
    fs.writeFileSync(left,kmz(a));
    fs.writeFileSync(right,kmz(b));
    const run=(x,y)=>spawnSync(process.execPath,[script,x,y],{encoding:'utf8',timeout:15000});
    let proc=run(left,right);
    assert.equal(proc.status,0,proc.stderr);
    assert.equal(JSON.parse(proc.stdout).summary.structuralDifferences,0);
    b.waypoints[0].lat=49.22222;
    fs.writeFileSync(right,kmz(b));
    proc=run(left,right);
    assert.equal(proc.status,1,proc.stderr);
    assert.ok(JSON.parse(proc.stdout).summary.structuralDifferences>0);
    assert.doesNotMatch(proc.stdout,/49\.22222|49\.12345|Private Pilot/);
    fs.writeFileSync(right,Buffer.from('not a ZIP'));
    proc=run(left,right);
    assert.equal(proc.status,2);
    assert.doesNotMatch(proc.stderr,/49\.12345|Private Pilot|original\.kmz/);
    assert.equal(proc.stdout,'');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('offline comparator neither network-connects nor initiates DJI flight/mission APIs',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../wpml-compare.js'),'utf8');
  const cli=fs.readFileSync(path.join(__dirname,'../../scripts/wpml-compare.js'),'utf8');
  assert.doesNotMatch(code+cli,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt\.publish|\/api\/mission\/create/);
});
