'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMapMutationStore,authorizedActor}=require('../map-element-mutation');

const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const operator={role:'operator',workspaceId:A,id:'operator-test'};
const admin={role:'admin',workspaceId:A,id:'admin-test'};
const element={
  id:'point',name:'Inspection Point',
  resource:{type:0,content:{type:'Feature',
    geometry:{type:'Point',coordinates:[8.4,49.1]},
    properties:{color:'#33AA44',clampToGround:true,is3d:false}}}
};

function fakeDb({isLocked=false,conflict=false,auditError=false}={}){
  const calls=[];
  let connects=0,released=0;
  const client={
    async query(sql,args){
      calls.push({sql,args});
      if(sql.startsWith('SELECT is_locked'))return {rows:[{is_locked:isLocked}]};
      if(sql.startsWith('INSERT INTO dji_map_elements'))return {rows:conflict?[]:[{revision:'1'}]};
      if(sql.startsWith('UPDATE dji_map_elements'))return {rows:conflict?[]:[{revision:'2'}]};
      if(sql.startsWith('DELETE FROM dji_map_elements'))return {rows:conflict?[]:[{revision:'1'}]};
      if(sql.startsWith('INSERT INTO dji_map_element_audit')){
        if(auditError)throw Error('SQL PRIVATE database password');
        return {rows:[]};
      }
      return {rows:[]};
    },
    release(){released++;}
  };
  const pool={async connect(){connects++;return client;}};
  return {pool,calls,stats:()=>({connects,released})};
}

test('authorization rejects Pilot/viewer, forged scope, invalid actor ID',()=>{
  assert.equal(authorizedActor(operator,A),true);
  assert.equal(authorizedActor(admin,A),true);
  assert.equal(authorizedActor({...operator,workspaceId:B},A),false);
  assert.equal(authorizedActor({...operator,role:'pilot'},A),false);
  assert.equal(authorizedActor({...operator,role:'viewer'},A),false);
  assert.equal(authorizedActor({...admin,id:'secret\nline'},A),false);
  assert.equal(authorizedActor(true,A),false);
});

test('invalid identity, geometry, revision and actions fail before DB connection',async()=>{
  const db=fakeDb(),service=createMapMutationStore(db.pool);
  const base={actor:operator,workspaceId:A,groupId:'shared',elementId:'point'};
  const cases=[
    {...base,actor:{role:'pilot',workspaceId:A,id:'pilot-test'},action:'create',element},
    {...base,actor:{...operator,workspaceId:B},action:'create',element},
    {...base,action:'update',expectedRevision:0,element},
    {...base,action:'delete',expectedRevision:'1'},
    {...base,action:'create',element:{...element,id:'wrong'}},
    {...base,action:'create',element:{...element,resource:{type:0,content:{
      type:'Feature',geometry:{type:'Point',coordinates:[8.4,999]}}}}},
    {...base,action:'unlock',element},
    {...base,action:'create',groupId:'',element}
  ];
  for(const p of cases){
    const result=await service.mutate(p);
    assert.ok(['denied','invalid'].includes(result.status));
  }
  assert.equal(db.stats().connects,0);
});

test('create stores normalized geometry and audit atomically, without client-controlled SQL',async()=>{
  const db=fakeDb();
  const service=createMapMutationStore(db.pool,{clock:()=>1760000000000});
  const result=await service.mutate({actor:operator,workspaceId:A,groupId:'shared',
    elementId:'point',action:'create',element});
  assert.deepEqual(result,{status:'ok',revision:1});
  assert.equal(db.stats().connects,1);
  assert.equal(db.stats().released,1);
  assert.deepEqual(db.calls.map(c=>c.sql==='BEGIN'?'BEGIN':c.sql==='COMMIT'?'COMMIT':
    c.sql.startsWith('SELECT')?'lock':c.sql.startsWith('INSERT INTO dji_map_elements')?
      'insert':'audit'),['BEGIN','lock','insert','audit','COMMIT']);
  const data=db.calls[2].args;
  assert.equal(data[0],A);
  assert.equal(data[1],'shared');
  assert.equal(data[3],'Inspection Point');
  assert.equal(JSON.parse(data[5]).coordinates[0],8.4);
  assert.deepEqual(db.calls[3].args,[A,'shared','point','operator-test','create',null,1]);
});

test('group locks deny even an admin; null is locked by default',async()=>{
  for(const lock of [true,null]){
    const db=fakeDb({isLocked:lock}),service=createMapMutationStore(db.pool);
    const result=await service.mutate({actor:admin,workspaceId:A,groupId:'shared',
      elementId:'point',action:'delete',expectedRevision:1});
    assert.deepEqual(result,{status:'locked'});
    assert.equal(db.calls.at(-1).sql,'ROLLBACK');
    assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM')),false);
    assert.equal(db.stats().released,1);
  }
});

test('optimistic update rejects stale revision without an audit event',async()=>{
  const db=fakeDb({conflict:true}),service=createMapMutationStore(db.pool);
  const result=await service.mutate({actor:operator,workspaceId:A,groupId:'shared',
    elementId:'point',action:'update',expectedRevision:1,element});
  assert.deepEqual(result,{status:'conflict'});
  assert.equal(db.calls.at(-1).sql,'ROLLBACK');
  assert.equal(db.calls.some(c=>c.sql.includes('INTO dji_map_element_audit')),false);
});

test('delete records a tombstone audit revision and cannot bypass compare-and-swap',async()=>{
  const db=fakeDb(),service=createMapMutationStore(db.pool);
  const result=await service.mutate({actor:operator,workspaceId:A,groupId:'shared',
    elementId:'point',action:'delete',expectedRevision:1});
  assert.deepEqual(result,{status:'ok',revision:null});
  assert.deepEqual(db.calls.find(c=>c.sql.startsWith('INSERT INTO dji_map_element_audit')).args,
    [A,'shared','point','operator-test','delete',1,null]);
});

test('audit failure rolls back data mutation and redacts SQL errors',async()=>{
  const db=fakeDb({auditError:true}),service=createMapMutationStore(db.pool);
  await assert.rejects(service.mutate({actor:operator,workspaceId:A,
    groupId:'shared',elementId:'point',action:'create',element}),
  err=>err.message==='Map mutation storage unavailable'&&!err.message.includes('PRIVATE'));
  assert.equal(db.calls.at(-1).sql,'ROLLBACK');
  assert.equal(db.calls.some(c=>c.sql==='COMMIT'),false);
  assert.equal(db.stats().released,1);
});
