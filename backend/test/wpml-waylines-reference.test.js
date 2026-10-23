'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {convert} = require('../../frontend/public/wpml-waylines-reference');
const planner = require('../../frontend/public/wpml-editor-core');
const {readKmz} = require('../wpml-kmz');
const {validateDocuments} = require('../wpml');

function source(drone_model=77, payload_model=66) {
  return {name:'Referenz',drone_model,payload_model,template_type:'waypoint',
    global_height:50,global_speed:5,height_type:'relativeToStartPoint',safe_height:30,
    waypoints:[{latitude:49.1,longitude:8.6,height:50,
      actions:[{type:'takePhoto',params:{payload_position_index:0}}]},
      {latitude:49.2,longitude:8.7,height:50}]};
}
test('numeric Go Waylines subset imports into offline-valid but never flight-ready KMZ',()=>{
  for (const [drone,payload,model] of [[77,66,'mavic3e'],[77,67,'mavic3t'],
    [99,88,'matrice4e'],[99,89,'matrice4t']]) {
    const result=convert(source(drone,payload));
    assert.equal(result.plan.model,model);
    assert.equal(result.plan.waypoints[0].photo,true);
    assert.equal(result.plan.waypoints[1].photo,false);
    assert.equal(result.flightReady,false);
    assert.equal(result.hardwareVerified,false);
    assert.equal(result.plan.takeoffHeight,30);
    assert.equal(result.plan.transitionSpeed,5);
    const kmz=planner.build(result.plan);
    const docs=readKmz(Buffer.from(kmz.kmz));
    const report=validateDocuments(docs.template,docs.waylines);
    assert.equal(report.valid,true,JSON.stringify(report.errors));
    assert.equal(kmz.flightReady,false);
  }
});
test('README string examples and unverified M3M/other combinations are rejected',()=>{
  for(const [drone,payload] of [['M3TD','M3TD'],[77,68],[99,66],[103,83]]) {
    assert.throws(()=>convert(source(drone,payload)),/abgelehnt/);
  }
});
test('unknown fields reject silent loss of mission semantics',()=>{
  for(const field of ['global_rth_height','photo_settings','global_transitional_speed',
    'description','global_waypoint_turn_mode','take_off_ref_point_latitude']) {
    const s=source();s[field]=field==='description'?'hello':42;
    assert.throws(()=>convert(s),/nicht unterstütztes Feld/);
  }
});
test('one reachPoint photo on payload zero is supported; other actions are not',()=>{
  const s=source();s.waypoints[0].actions=[{type:'takePhoto',action:{payload_position_index:0}}];
  assert.equal(convert(s).plan.waypoints[0].photo,true);
  s.waypoints[0].actions=[{type:'takePhoto',params:{payloadPositionIndex:0}}];
  assert.equal(convert(s).plan.waypoints[0].photo,true);
  const rejected=[
    [{type:'gimbalRotate',params:{}}],
    [{type:'takePhoto',params:{payload_position_index:1}}],
    [{type:'takePhoto',params:{payload_position_index:0,file_suffix:'x'}}],
    [{type:'takePhoto'},{type:'takePhoto'}],
    [{type:'takePhoto',params:{payloadPositionIndex:0,payload_position_index:0}}],
    [{type:'takePhoto',action:{},params:{}}],
    [{type:'takePhoto',params:{use_global_payload_lens_index:true}}]
  ];
  for(const actions of rejected){s.waypoints[0].actions=actions;
    assert.throws(()=>convert(s),/abgelehnt/);
  }
});
test('height ambiguity, speeds, triggering and duplicate positions fail closed',()=>{
  const changes=[
    s=>{s.waypoints[1].height=51},
    s=>{s.global_height=52},
    s=>{s.waypoints[1].speed=4},
    s=>{s.waypoints[1].trigger_type='multipleDistance'},
    s=>{s.waypoints[1].longitude=s.waypoints[0].longitude;s.waypoints[1].latitude=s.waypoints[0].latitude},
    s=>{s.height_type='EGM96'},s=>{s.finish_action='autoLand'},
    s=>{s.waypoints[0].latitude=NaN},s=>{s.waypoints[0].height='50'},
    s=>{s.waypoints[1].turn_damping_dist=3}
  ];
  for(const change of changes){const s=source();change(s);
    assert.throws(()=>convert(s),/abgelehnt/);
  }
});
test('malformed JSON values, unknown keys, excessive and out-of-scope payload reject',()=>{
  for(const doc of [null,[],Object.assign(Object.create(null),source()),
    {...source(),waypoints:[]},{...source(),payload_position_index:7}]) {
    assert.throws(()=>convert(doc),/abgelehnt/);
  }
  assert.throws(()=>convert(JSON.parse('{"name":"A","__proto__":"x"}')),/abgelehnt/);
});
test('SDK safe-height default 20 is explicit, not a claim of hardware readiness',()=>{
  const s=source();delete s.safe_height;
  assert.equal(convert(s).plan.takeoffHeight,20);
  assert.equal(convert(s).flightReady,false);
});
test('editor connects local JSON file import without server or flight-command paths',()=>{
  const root=path.resolve(__dirname,'../../frontend/public');
  const html=fs.readFileSync(path.join(root,'wpml-editor.html'),'utf8');
  const editor=fs.readFileSync(path.join(root,'wpml-editor.js'),'utf8');
  assert.match(html,/wpml-waylines-reference\.js/);
  assert.match(html,/id="waylines-reference-file"/);
  assert.match(editor,/reference\.convert\(payload\)/);
  assert.match(editor,/core\.normalize\(mapped\.plan\)/);
  assert.doesNotMatch(editor,/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|mqtt\.connect|\/api\/mission\/create/i);
});
