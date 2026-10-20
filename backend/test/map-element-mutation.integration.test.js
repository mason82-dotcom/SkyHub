'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createMapMutationStore}=require('../map-element-mutation');

const URL=process.env.SKYHUB_TEST_DATABASE_URL;
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const actor={role:'operator',workspaceId:A,id:'operator-ci'};
const marker={id:'marker',name:'First marker',resource:{
  type:0,content:{type:'Feature',geometry:{type:'Point',coordinates:[8.4,49.1]}}
}};
const revised={...marker,name:'Updated marker'};

function safeTarget(url){
  const u=new URL(url);
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname));
  assert.equal(decodeURIComponent(u.pathname),'/skyhub_test');
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
}

test('isolated PostgreSQL CAS, group lock, workspace boundaries and atomic audit',
  {skip:!URL},async()=>{
  safeTarget(URL);
  const client=new Client({connectionString:URL,connectionTimeoutMillis:5000,query_timeout:10000});
  await client.connect();
  const schema='skyhub_mutation_ci_'+crypto.randomBytes(6).toString('hex');
  const qname='"'+schema+'"';
  let schemaCreated=false;
  try{
    const actual=await client.query('SELECT current_database() AS db');
    assert.equal(actual.rows[0].db,'skyhub_test');
    await client.query('CREATE SCHEMA '+qname);
    schemaCreated=true;
    await client.query('SET search_path TO '+qname+',public');
    await client.query(fs.readFileSync(path.resolve(__dirname,
      '../db/migrations/001_dji_map_elements.sql'),'utf8'));
    const migration=fs.readFileSync(path.resolve(__dirname,
      '../db/migrations/002_dji_map_mutation_contract.sql'),'utf8');
    await client.query(migration);
    await client.query(migration); // additive migration is idempotent
    await client.query(
      'INSERT INTO dji_map_element_groups (workspace_id,group_id,name,group_type,is_locked) '+
      "VALUES ($1,'shared','Shared',2,false),($1,'locked','Locked',2,true),"+
      "($2,'shared','Other Workspace',2,false)",[A,B]);
    // The test pool hands the isolated, search_path-bound Client to the service.
    const pool={connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
    const store=createMapMutationStore(pool,{clock:()=>1760000000000});
    const base={actor,workspaceId:A,groupId:'shared',elementId:'marker'};
    assert.deepEqual(await store.mutate({...base,action:'create',element:marker}),
      {status:'ok',revision:1});
    assert.deepEqual(await store.mutate({...base,action:'create',element:marker}),
      {status:'conflict'});
    assert.deepEqual(await store.mutate({...base,action:'update',
      element:revised,expectedRevision:1}),{status:'ok',revision:2});
    assert.deepEqual(await store.mutate({...base,action:'update',
      element:marker,expectedRevision:1}),{status:'conflict'});
    assert.deepEqual(await store.mutate({...base,groupId:'locked',action:'create',
      element:marker}),{status:'locked'});
    assert.deepEqual(await store.mutate({...base,action:'delete',expectedRevision:1}),
      {status:'conflict'});
    assert.deepEqual(await store.mutate({...base,action:'delete',expectedRevision:2}),
      {status:'ok',revision:null});
    assert.deepEqual(await store.mutate({...base,workspaceId:B,
      action:'create',element:marker}),{status:'denied'});

    const rows=await client.query(
      'SELECT action,old_revision,new_revision,actor_id FROM dji_map_element_audit '+
      'WHERE workspace_id=$1 AND group_id=$2 ORDER BY audit_id',[A,'shared']);
    assert.deepEqual(rows.rows.map(r=>r.action),['create','update','delete']);
    assert.deepEqual(rows.rows.map(r=>[r.old_revision,r.new_revision]),
      [[null,'1'],['1','2'],['2',null]]);
    assert.ok(rows.rows.every(r=>r.actor_id==='operator-ci'));
    const remaining=await client.query(
      'SELECT count(*)::integer AS n FROM dji_map_elements WHERE workspace_id=$1',[A]);
    assert.equal(remaining.rows[0].n,0);

    // Audit failure must abort element insert, not commit a partial write.
    await client.query(
      "CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS "+
      "$$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
    await client.query(
      'CREATE TRIGGER reject_audit BEFORE INSERT ON dji_map_element_audit '+
      'FOR EACH ROW EXECUTE FUNCTION reject_audit()');
    await assert.rejects(
      store.mutate({...base,action:'create',element:marker}),
      /Map mutation storage unavailable/);
    const noUnloggedInsert=await client.query(
      'SELECT count(*)::integer AS n FROM dji_map_elements WHERE workspace_id=$1',[A]);
    assert.equal(noUnloggedInsert.rows[0].n,0);
  }finally{
    try{await client.query('ROLLBACK');}catch(_err){}
    try{await client.query('SET search_path TO public');}catch(_err){}
    if(schemaCreated)await client.query('DROP SCHEMA '+qname+' CASCADE');
    await client.end();
  }
});
