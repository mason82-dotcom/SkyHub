'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mapPrincipal,mapAccess}=require('../map-element-permissions');

const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';

test('map principals reject invalid roles and workspace identifiers',()=>{
  assert.equal(mapPrincipal('administrator',A),null);
  assert.equal(mapPrincipal('pilot','../../secrets'),null);
  assert.equal(mapPrincipal('pilot',undefined),null);
  assert.deepEqual(mapPrincipal('pilot',A),{role:'pilot',workspaceId:A});
  assert.ok(Object.isFrozen(mapPrincipal('pilot',A)));
});

test('DJI map roles are bound to exactly one workspace',()=>{
  for(const role of ['viewer','pilot','operator','admin']){
    const principal=mapPrincipal(role,A);
    assert.equal(mapAccess(principal,{workspaceId:B,isDistributed:true}),false);
    assert.equal(mapAccess(principal,{workspaceId:A,isDistributed:true}),
      role!=='viewer');
  }
  assert.equal(mapAccess({role:'admin',workspaceId:undefined},{workspaceId:A}),false);
  assert.equal(mapAccess({role:'admin',workspaceId:'bad'},{workspaceId:A}),false);
  assert.equal(mapAccess(true,{workspaceId:A}),false);
  assert.equal(mapAccess({role:'administrator',workspaceId:A},{workspaceId:A}),false);
});

test('Pilot is only permitted published map groups; viewer cannot use DJI API',()=>{
  assert.equal(mapAccess(mapPrincipal('pilot',A),{workspaceId:A,isDistributed:true}),true);
  assert.equal(mapAccess(mapPrincipal('pilot',A),{workspaceId:A,isDistributed:false}),false);
  assert.equal(mapAccess(mapPrincipal('viewer',A),{workspaceId:A,isDistributed:true}),false);
  assert.equal(mapAccess(mapPrincipal('operator',A),{workspaceId:A,isDistributed:false}),true);
  assert.equal(mapAccess(mapPrincipal('admin',A),{workspaceId:A,isDistributed:false}),true);
});

test('writes are denied unconditionally for every role, workspace and action',()=>{
  for(const role of ['viewer','pilot','operator','admin']){
    for(const action of ['create','update','delete']){
      for(const distribution of [true,false]){
        assert.equal(mapAccess(mapPrincipal(role,A),{
          workspaceId:A,action,isDistributed:distribution
        }),false);
      }
    }
  }
  assert.equal(mapAccess(mapPrincipal('admin',A),{
    workspaceId:A,action:'unlock',isDistributed:true
  }),false);
  assert.equal(mapAccess(mapPrincipal('admin',A),{
    workspaceId:A,action:'read',isDistributed:'false'
  }),false);
});
