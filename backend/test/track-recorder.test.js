'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTrackPolicy}=require('../track-policy');
const {createTrackRecorder}=require('../track-recorder');

const point={deviceSn:'AIR01',gatewaySn:'RC01',latitude:49.1,longitude:8.4,altitude:10};

test('track metrics count confirmed writes and retry a failed stationary sample',async()=>{
  let attempts=0,now=1000;
  const store={
    migrate:async()=>{},prune:async()=>0,
    insert:async()=>{attempts++;if(attempts===1)throw Error('database unavailable');}
  };
  const errors=[];
  const recorder=createTrackRecorder({store,policy:createTrackPolicy(),enabled:true,
    clock:()=>now++,onWriteError:error=>errors.push(error.message)});
  assert.equal(await recorder.record(point,100,{}),false);
  assert.equal(recorder.snapshot().trackPointsUnavailable,1);
  assert.equal(await recorder.migrate(),true);
  assert.equal(await recorder.record(point,101,{}),false);
  assert.equal(recorder.snapshot().trackPointsStored,0);
  assert.equal(recorder.snapshot().trackWriteErrors,1);
  assert.deepEqual(errors,['database unavailable']);
  assert.equal(await recorder.record(point,102,{}),true);
  assert.equal(attempts,2);
  assert.equal(recorder.snapshot().trackPointsStored,1);
  assert.equal(recorder.snapshot().trackWritesPending,0);
  assert.equal(await recorder.record(point,103,{}),false);
  assert.equal(recorder.snapshot().trackPointsSkipped,1);
});

test('migration failure keeps storage unavailable until a later retry succeeds',async()=>{
  let migrations=0;
  const recorder=createTrackRecorder({
    store:{
      migrate:async()=>{if(++migrations===1)throw Error('database starting');},
      insert:async()=>{},prune:async()=>3
    },policy:createTrackPolicy(),enabled:true
  });
  await assert.rejects(recorder.migrate(),/database starting/);
  assert.equal(recorder.snapshot().postgresMigrationReady,false);
  assert.equal(await recorder.prune(30),0);
  assert.equal(await recorder.migrate(),true);
  assert.equal(await recorder.prune(30),3);
});

test('disabled recording prevents GPS inserts and preserves existing history',async()=>{
  let inserts=0,prunes=0,migrations=0;
  const store={
    migrate:async()=>{migrations++;},
    insert:async()=>{inserts++;},
    prune:async()=>{prunes++;return 3;}
  };
  const recorder=createTrackRecorder({store,policy:createTrackPolicy(),
    enabled:true,recordingEnabled:false});
  assert.equal(await recorder.migrate(),true);
  assert.equal(await recorder.record(point,100,{}),false);
  assert.equal(await recorder.record({...point,latitude:49.2},200,{}),false);
  assert.equal(await recorder.prune(30),0);
  assert.equal(migrations,1);
  assert.equal(inserts,0);
  assert.equal(prunes,0);
  assert.equal(recorder.snapshot().postgresConfigured,true);
  assert.equal(recorder.snapshot().postgresMigrationReady,true);
  assert.equal(recorder.snapshot().trackRecordingEnabled,false);
  assert.equal(recorder.snapshot().trackPointsStored,0);
  assert.equal(recorder.snapshot().trackPointsSkipped,0);
});

test('explicit opt-in enables GPS inserts',async()=>{
  let inserts=0;
  const recorder=createTrackRecorder({
    store:{migrate:async()=>{},insert:async()=>{inserts++;},prune:async()=>0},
    policy:createTrackPolicy(),enabled:true,recordingEnabled:true
  });
  await recorder.migrate();
  assert.equal(await recorder.record(point,100,{}),true);
  assert.equal(inserts,1);
  assert.equal(recorder.snapshot().trackRecordingEnabled,true);
});

test('a database-free test instance reports its capability honestly',async()=>{
  const recorder=createTrackRecorder({store:{},policy:createTrackPolicy()});
  assert.equal(await recorder.migrate(),false);
  assert.equal(recorder.snapshot().postgresConfigured,false);
  assert.equal(recorder.snapshot().postgresMigrationReady,false);
  assert.equal(recorder.snapshot().trackRecordingEnabled,false);
});
