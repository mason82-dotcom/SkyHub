'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMapElementGroups}=require('../map-element-contract');

const feature=(type,coordinates)=>({type:'Feature',properties:{color:'#0091FF',clampToGround:false},
  geometry:{type,coordinates}});
const item=(id,content,resourceType=0)=>({id,name:id,create_time:1637158501230,
  resource:{type:resourceType,content}});
const response=elements=>({code:0,message:'success',data:[{
  id:'app-shared',name:'Gemeinsame Elemente',type:2,is_lock:false,create_time:1637158501230,elements
}]});

test('DJI group response normalizes WGS84 point, line and unclosed polygon for read-only display',()=>{
  const point=[-112.49,48.18,40.2];
  const line=[[-112.49,48.18],[-104.47,46.60]];
  const ring=[[-112,48],[-104,46],[-109,42]];
  const input=response([item('pin',feature('Point',point)),
    item('line',feature('LineString',line)),item('area',feature('Polygon',[ring]))]);
  const result=parseMapElementGroups(input);
  assert.equal(result.rejectedElements,0);
  assert.equal(result.groups[0].type,2);
  assert.equal(result.groups[0].isLocked,false);
  assert.deepEqual(result.groups[0].elements.map(e=>e.kind),['Point','LineString','Polygon']);
  assert.deepEqual(result.groups[0].elements[0].geometry.coordinates,point);
  assert.deepEqual(result.groups[0].elements[2].geometry.coordinates[0].at(-1),ring[0]);
  assert.equal(result.groups[0].elements[1].resourceType,0);
  assert.equal(input.data[0].elements[2].resource.content.geometry.coordinates[0].length,3);
});

test('invalid elements are isolated without losing valid elements or exposing raw payloads',()=>{
  const input=response([item('valid',feature('Point',[8.4,49.1])),
    item('bad-latitude',feature('Point',[8.4,91])),
    item('bad-coordinate',feature('LineString',[[8.4,49.1],[Infinity,49.2]])),
    item('bad-geometry',feature('GeometryCollection',[])),
    item('valid',feature('Point',[9,50]))]);
  const result=parseMapElementGroups(input);
  assert.equal(result.rejectedElements,4);
  assert.deepEqual(result.groups[0].elements.map(e=>e.id),['valid']);
});

test('optional DJI metadata remains unknown rather than implying an unlocked group',()=>{
  const result=parseMapElementGroups({code:0,data:[{id:'group',elements:[{
    id:'point',resource:{content:{geometry:{type:'Point',coordinates:[8.4,49.1]}}}
  }]}]});
  assert.equal(result.groups[0].name,'group');
  assert.equal(result.groups[0].type,null);
  assert.equal(result.groups[0].isLocked,null);
  assert.equal(result.groups[0].elements[0].name,'point');
});

test('response and group boundaries fail closed',()=>{
  for(const input of [null,{code:1,data:[]},{code:0,data:{}},
    {code:0,data:[{id:'x',name:'x',type:2,is_lock:false,elements:null}]}]){
    assert.throws(()=>parseMapElementGroups(input),TypeError);
  }
  assert.throws(()=>parseMapElementGroups({code:0,data:Array(101).fill({})}),RangeError);
  assert.throws(()=>parseMapElementGroups(response(Array(5001).fill(item('x',feature('Point',[8,49]))))),RangeError);
});
