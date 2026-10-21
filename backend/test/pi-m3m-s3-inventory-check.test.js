'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {createApiStorage}=require('../../scripts/pi-m3m-s3-inventory-check');
const {inventoryM3MFromS3}=require('../m3m-s3-inventory');

const PREFIX='missions/SECRET_CAPTURE_ID/';
const CAPTURE='DJI_20261021190530_0001';
const NAMES=[CAPTURE+'_D.JPG',...['G','R','RE','NIR'].map(b=>CAPTURE+'_MS_'+b+'.TIF')];

test('Pi S3 probe help runs without Docker, MinIO or credentials',()=>{
  const file=path.resolve(__dirname,'../../scripts/pi-m3m-s3-inventory-check.js');
  const res=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(res.status,0,res.stderr);
  assert.match(res.stdout,/--prefix/);
  assert.doesNotMatch(res.stdout,/SECRET|accessKey|s3_url/);
});

test('Pi S3 probe adapter paginates only dji-cloud and returns aggregate inventory',async()=>{
  let calls=0;
  const storage=createApiStorage(async request=>{
    assert.equal(request.bucket,'dji-cloud');
    assert.equal(request.prefix,PREFIX);
    assert.equal(request.limit,200);
    calls++;
    if(calls===1){
      assert.equal(request.cursor,undefined);
      return {objects:NAMES.slice(0,2).map(n=>({key:PREFIX+n})),
        truncated:true,nextCursor:'next'};
    }
    assert.equal(request.cursor,'next');
    return {objects:NAMES.slice(2).map(n=>({key:PREFIX+n})),
      truncated:false,nextCursor:null};
  });
  const report=await inventoryM3MFromS3(storage,PREFIX);
  assert.equal(calls,2);
  assert.equal(report.totalEntries,5);
  assert.equal(report.fiveChannelSets,1);
  assert.equal(report.ndviReady,false);
  assert.doesNotMatch(JSON.stringify(report),/SECRET|20261021|missions|NIR\.TIF/);
});

test('Pi S3 probe adapter never supports bucket writes or arbitrary buckets',async()=>{
  const storage=createApiStorage(async()=>{throw new Error('Must not call');});
  await assert.rejects(storage.objects('private',{prefix:PREFIX,limit:200}));
  await assert.rejects(storage.objects('dji-cloud',null));
  assert.equal(typeof storage.putObject,'undefined');
  assert.equal(typeof storage.deleteObject,'undefined');
});

test('Pi S3 probe refuses incomplete remote responses without sharing backend values',async()=>{
  const storage=createApiStorage(async()=>({secret:'API_KEY_1234'}));
  await assert.rejects(inventoryM3MFromS3(storage,PREFIX),
    /Invalid media API response/);
});
