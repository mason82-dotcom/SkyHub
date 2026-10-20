'use strict';

// Opt-in PostgreSQL/PostGIS integration. Never point this at a live SkyHub DB.
// All test data and schema changes run inside a single rolled-back transaction.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const {createMapElementStore}=require('../map-element-store');
const {createTrackStore}=require('../track-store');

const url=process.env.SKYHUB_TEST_DATABASE_URL;
const WORKSPACE_A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const WORKSPACE_B='203cc94c-aef1-4e0e-a520-05a24be33a31';

function assertIsolatedTarget(connectionString){
  const target=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname),
    'Integration tests require a loopback database, not a production Pi service');
  assert.equal(decodeURIComponent(target.pathname),'/skyhub_test',
    'An explicitly dedicated skyhub_test database is mandatory');
  assert.ok(['postgres:','postgresql:'].includes(target.protocol),'Postgres URL required');
}

test('isolated PostGIS migrations, workspace isolation, track queries and recovery',
  {skip:!url},async()=>{
    assertIsolatedTarget(url); // Fail before connecting to an unexpected database.
    const client=new Client({connectionString:url,connectionTimeoutMillis:5000,
      query_timeout:12000,application_name:'skyhub_isolated_postgis_test'});
    await client.connect();
    let transactionOpen=false;
    try{
      const db=await client.query('SELECT current_database() AS name');
      assert.equal(db.rows[0].name,'skyhub_test');
      const ext=await client.query("SELECT extname FROM pg_extension WHERE extname='postgis'");
      assert.equal(ext.rows.length,1,'Dedicated database must contain PostGIS');
      await client.query('BEGIN');
      transactionOpen=true;
      const schema='skyhub_it_'+crypto.randomBytes(8).toString('hex');
      await client.query('CREATE SCHEMA "'+schema+'"');
      await client.query('SET LOCAL search_path TO "'+schema+'", public');

      const schemaSql=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
      const mapSql=fs.readFileSync(path.join(__dirname,'../db/migrations/001_dji_map_elements.sql'),'utf8');
      await client.query(schemaSql);
      const tracks=createTrackStore(client);
      await tracks.migrate();
      await tracks.migrate(); // Additive migration must be safe to retry.

      // A savepoint simulates recovery from a map-schema migration in the test database.
      await client.query('SAVEPOINT before_map_migration');
      await client.query(mapSql);
      const present=await client.query("SELECT to_regclass('dji_map_element_groups') AS name");
      assert.ok(present.rows[0].name);
      await client.query('ROLLBACK TO SAVEPOINT before_map_migration');
      const reverted=await client.query("SELECT to_regclass('dji_map_element_groups') AS name");
      assert.equal(reverted.rows[0].name,null,'Trial map tables must disappear on rollback');
      await client.query(mapSql);
      await client.query(mapSql); // Migration must be idempotent.

      await client.query(
        "INSERT INTO dji_map_element_groups "+
        "(workspace_id,group_id,name,group_type,is_locked,is_distributed) VALUES "+
        "($1,'shared','Workspace A Shared',2,false,true),"+
        "($1,'empty','Empty Shared',2,false,true),"+
        "($1,'private','Private A',1,true,false),"+
        "($2,'shared','Workspace B Secret',2,false,true)",
        [WORKSPACE_A,WORKSPACE_B]
      );
      await client.query(
        "INSERT INTO dji_map_elements "+
        "(workspace_id,group_id,element_id,name,resource_type,geometry,color,clamp_to_ground,is_3d) VALUES "+
        "($1,'shared','point','A point',0,$3::jsonb,'#0091FF',true,false),"+
        "($2,'shared','point','B secret point',0,$4::jsonb,NULL,NULL,NULL),"+
        "($1,'shared','invalid','Invalid coordinate',0,$5::jsonb,NULL,NULL,NULL)",
        [WORKSPACE_A,WORKSPACE_B,
          JSON.stringify({type:'Point',coordinates:[8.4,49.1]}),
          JSON.stringify({type:'Point',coordinates:[9.0,50.0]}),
          JSON.stringify({type:'Point',coordinates:[8.4,95]})]
      );
      const maps=createMapElementStore(client);
      const a=await maps.readResponse(WORKSPACE_A);
      assert.deepEqual(a.data.map(g=>g.id),['empty','shared']);
      assert.equal(a.data[0].elements.length,0,'Empty App Shared groups must be retained');
      assert.deepEqual(a.data[1].elements.map(e=>e.id),['point'],
        'Invalid persisted geometries must not appear in DJI responses');
      assert.equal(a.data[1].elements[0].resource.content.geometry.coordinates[1],49.1);
      assert.doesNotMatch(JSON.stringify(a),/B secret|Workspace B Secret/);
      const b=await maps.readResponse(WORKSPACE_B);
      assert.equal(b.data.length,1);
      assert.equal(b.data[0].name,'Workspace B Secret');
      const privateA=await maps.readResponse(WORKSPACE_A,{isDistributed:false});
      assert.deepEqual(privateA.data.map(g=>g.id),['private']);
      const filtered=await maps.readResponse(WORKSPACE_A,{groupId:'shared',isDistributed:true});
      assert.deepEqual(filtered.data.map(g=>g.id),['shared']);

      // The composite foreign key must prevent mixing group and element workspaces.
      await client.query('SAVEPOINT before_fk_check');
      await assert.rejects(client.query(
        "INSERT INTO dji_map_elements "+
        "(workspace_id,group_id,element_id,name,geometry) "+
        "VALUES ($1,'private','forged','Forbidden',$2::jsonb)",
        [WORKSPACE_B,JSON.stringify({type:'Point',coordinates:[8.4,49.1]})]
      ),{code:'23503'});
      await client.query('ROLLBACK TO SAVEPOINT before_fk_check');

      const now=Date.now();
      const base={gatewaySn:'RC_TEST',deviceSn:'AIR_TEST',latitude:49.1,longitude:8.4,
        altitude:10,battery:73,sourceTs:now,timeVerified:true,heightEllipsoid:117,
        gpsSatellites:15,rtkSatellites:20,rtkFixState:50,positionQuality:4};
      await tracks.insert(base);
      await tracks.insert({...base,latitude:0,longitude:0});
      let points=await tracks.track('AIR_TEST',60);
      assert.equal(points.length,1,'History must suppress historical 0/0 positions');
      assert.equal(points[0].timeVerified,true);
      assert.equal(points[0].latitude,49.1);
      assert.ok(Math.abs(points[0].t-now)<1000,'Sample timestamp must survive storage');

      await tracks.insert({...base,deviceSn:'OLD_TEST'});
      await client.query("UPDATE drone_telemetry SET created_at=now()-interval '31 days' WHERE device_sn=$1",
        ['OLD_TEST']);
      assert.equal(await tracks.prune(30),1,'Retention removes only expired trial rows');
      points=await tracks.track('AIR_TEST',60);
      assert.equal(points.length,1,'Retention must preserve recent history');
    }finally{
      if(transactionOpen)await client.query('ROLLBACK');
      await client.end();
    }
  });
