'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const planner=require('../../frontend/public/wpml-editor-core');
const {inspectKmz,readKmz}=require('../wpml-kmz');
const {validateDocuments}=require('../wpml');

function plan(model='mavic3m'){
  return {name:'Prüfung & <DJI> "SkyHub"',model,speed:5,takeoffHeight:30,
    finishAction:'goHome',timestamp:1792573200000,
    waypoints:[
      {lat:49.124,lon:8.612,height:50,photo:true},
      {lat:49.125,lon:8.613,height:50,photo:false},
      {lat:49.1255,lon:8.614,height:50,photo:true}
    ]};
}
test('browser-core generates DJI-like matching template and waylines for all supported aircraft',()=>{
  for(const model of Object.keys(planner.MODELS)){
    const output=planner.build(plan(model));
    assert.equal(output.flightReady,false);
    assert.equal(output.validationScope,'offline-partial');
    assert.equal(output.summary.aircraft,planner.MODELS[model].name);
    assert.equal(output.summary.waypointCount,3);
    assert.equal(output.summary.photoCount,2);
    assert.equal(output.kmz[0],0x50);
    assert.equal(output.kmz[1],0x4b);
    const loaded=readKmz(Buffer.from(output.kmz));
    assert.equal(loaded.template,output.templateXml);
    assert.equal(loaded.waylines,output.waylinesXml);
    const result=validateDocuments(loaded.template,loaded.waylines);
    assert.equal(result.valid,true,model+': '+JSON.stringify(result.errors));
    assert.equal(result.aircraft.model,model==='mavic3m'?'Mavic 3M':result.aircraft.model);
    assert.equal(result.waylines[0].waypointCount,3);
    assert.equal(inspectKmz(Buffer.from(output.kmz)).flightReady,false);
  }
});
test('generated waypoint actions are correctly indexed, consistent and isolated',()=>{
  const output=planner.build(plan());
  const parsed=readKmz(Buffer.from(output.kmz));
  assert.equal((parsed.waylines.match(/<wpml:actionGroupId>/g)||[]).length,2);
  assert.match(parsed.waylines,/<wpml:actionGroupStartIndex>2<\/wpml:actionGroupStartIndex>/);
  assert.match(parsed.template,/<wpml:globalHeight>50<\/wpml:globalHeight>/);
  assert.match(parsed.waylines,/<wpml:executeHeightMode>relativeToStartPoint<\/wpml:executeHeightMode>/);
  assert.match(parsed.waylines,/<wpml:exitOnRCLost>executeLostAction<\/wpml:exitOnRCLost>/);
  assert.match(parsed.waylines,/<wpml:executeRCLostAction>goBack<\/wpml:executeRCLostAction>/);
  assert.match(parsed.template,/<wpml:author>SkyHub<\/wpml:author>/);
  assert.doesNotMatch(parsed.template,/<wpml:missionName>/);
});
test('user-generated names are XML-escaped and input data never become markup',()=>{
  const xml=planner.build(plan()).templateXml;
  assert.doesNotMatch(xml,/Prüfung & <DJI>/);
  assert.match(xml,/<name>Prüfung &amp; &lt;DJI&gt; &quot;SkyHub&quot;<\/name>/);
  const invalid=plan();
  invalid.name='a'.repeat(71);
  assert.throws(()=>planner.build(invalid),/mission name/);
});
test('planner fails closed on malformed position, waypoint limits and unknown aircraft',()=>{
  const wrong=plan();wrong.model='matrice400';
  assert.throws(()=>planner.build(wrong),/unsupported aircraft/);
  for(const [key,value] of [['lat',91],['lon',181],['lat',''],['height',1000],['photo','yes']]){
    const candidate=plan();candidate.waypoints[0][key]=value;
    assert.throws(()=>planner.build(candidate),/WPML plan invalid/);
  }
  const duplicate=plan();duplicate.waypoints[1].lat=duplicate.waypoints[0].lat;
  duplicate.waypoints[1].lon=duplicate.waypoints[0].lon;
  assert.throws(()=>planner.build(duplicate),/consecutive identical/);
  const tooShort=plan();tooShort.waypoints.pop();tooShort.waypoints.pop();
  assert.throws(()=>planner.build(tooShort),/2 to 500/);
  const tooLong=plan();tooLong.waypoints=Array.from({length:501},()=>tooLong.waypoints[0]);
  assert.throws(()=>planner.build(tooLong),/2 to 500/);
});
test('no false geoid conversion or varying per-waypoint altitude is generated',()=>{
  const mismatch=plan();mismatch.waypoints[2].height=60;
  assert.throws(()=>planner.build(mismatch),/uniform relative flight height/);
  const xml=planner.build(plan()).templateXml;
  assert.doesNotMatch(xml,/<wpml:ellipsoidHeight>/);
  assert.doesNotMatch(xml,/WGS84<\/wpml:heightMode>/);
});
test('flight controls disallow unsafe out-of-range numbers and unsupported enum strings',()=>{
  for(const [key,value] of [['speed',16],['speed',0],['takeoffHeight',0],['takeoffHeight',121],
    ['transitionSpeed',20],['finishAction','autoLand']]){
    const bad=plan();bad[key]=value;
    assert.throws(()=>planner.build(bad),/WPML plan invalid/);
  }
});
test('standalone editor is present and performs no DJI requests or server-side KMZ upload',()=>{
  const root=path.join(__dirname,'../../frontend/public');
  const html=readFileSync(path.join(root,'wpml-editor.html'),'utf8');
  const app=readFileSync(path.join(root,'wpml-editor.js'),'utf8');
  assert.match(html,/wpml-editor-core\.js/);
  assert.match(html,/wpml-editor\.js/);
  assert.match(html,/type="submit" id="export"/);
  assert.match(html,/type="number"/);
  assert.match(app,/core\.build\(plan\)/);
  assert.match(app,/createObjectURL/);
  assert.doesNotMatch(app,/\bfetch\s*\(|XMLHttpRequest|WebSocket|mqtt|\/api\/mission\/create/i);
  assert.doesNotMatch(html,/action="\/api\/mission\/create"/);
});

test('offline JSON CLI writes a valid KMZ without contacting any live service',()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const {spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-wpml-plan-'));
  try{
    const input=path.join(dir,'route.json'),output=path.join(dir,'route.kmz');
    fs.writeFileSync(input,JSON.stringify(plan()));
    const cmd=path.join(__dirname,'../../scripts/wpml-plan.js');
    const result=spawnSync(process.execPath,[cmd,input,output],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(inspectKmz(fs.readFileSync(output)).valid,true);
    assert.equal(inspectKmz(fs.readFileSync(output)).flightReady,false);
    const duplicate=spawnSync(process.execPath,[cmd,input,output],{encoding:'utf8',timeout:15000});
    assert.equal(duplicate.status,2);
    assert.match(duplicate.stderr,/generation rejected/);
    assert.doesNotMatch(duplicate.stderr,/49.124|8.612|route\.json/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
