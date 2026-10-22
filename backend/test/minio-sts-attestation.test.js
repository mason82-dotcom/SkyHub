'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {attestPutOnlySession,checkPrefix}=require('../minio-sts-attestation');
const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const PREFIX=WORKSPACE+'/media/'+'a'.repeat(32);
const nonce=()=>Buffer.alloc(16,1);

test('isolated STS probe accepts only own-prefix put and refuses all other actions',async()=>{
  const seen=[];
  const client={send:async cmd=>{
    const name=cmd.constructor.name;
    seen.push({name,...cmd.input});
    if(name==='PutObjectCommand'&&cmd.input.Key.startsWith(PREFIX+'/'))
      return {$metadata:{httpStatusCode:200}};
    throw Object.assign(new Error('forbidden'),{
      name:'AccessDenied',$metadata:{httpStatusCode:403}
    });
  }};
  const result=await attestPutOnlySession({s3:client,workspace:WORKSPACE,prefix:PREFIX,
    confirmIsolated:true,randomBytes:nonce});
  assert.equal(result.passed,true);
  assert.deepEqual(seen.map(x=>x.name),['PutObjectCommand','GetObjectCommand',
    'DeleteObjectCommand','ListObjectsV2Command','PutObjectCommand']);
  assert.ok(seen[0].Key.startsWith(PREFIX+'/'));
  assert.equal(seen[0].Bucket,'dji-cloud');
  assert.ok(!seen[4].Key.startsWith(WORKSPACE+'/'));
  assert.doesNotMatch(JSON.stringify(result),/Key|dji-cloud|e3dea0/);
});

test('over-permissioned temporary credentials never pass attestation',async()=>{
  const client={send:async()=>({$metadata:{httpStatusCode:200}})};
  await assert.rejects(()=>attestPutOnlySession({s3:client,workspace:WORKSPACE,prefix:PREFIX,
    confirmIsolated:true,randomBytes:nonce}),/over-granted: GetObject/);
});

test('network errors and 404s are inconclusive, not proof of denied authorization',async()=>{
  let count=0;
  const client={send:async()=>{
    count++;
    if(count===1)return {};
    throw Object.assign(new Error('NoSuchKey'),{
      name:'NoSuchKey',$metadata:{httpStatusCode:404}
    });
  }};
  await assert.rejects(()=>attestPutOnlySession({s3:client,workspace:WORKSPACE,prefix:PREFIX,
    confirmIsolated:true,randomBytes:nonce}),/inconclusive: GetObject/);
});

test('expired credentials reporting HTTP 403 are not mistaken for IAM denial',async()=>{
  let count=0;
  const client={send:async()=>{
    count++;
    if(count===1)return {};
    throw Object.assign(new Error('expired'),{
      name:'ExpiredToken',$metadata:{httpStatusCode:403}
    });
  }};
  await assert.rejects(()=>attestPutOnlySession({s3:client,workspace:WORKSPACE,
    prefix:PREFIX,confirmIsolated:true,randomBytes:nonce}),/inconclusive: GetObject/);
});

test('attestation cannot access any bucket unless explicitly disposable',async()=>{
  const client={send:async()=>{throw Error('must not contact storage');}};
  for(const cfg of [
    {confirmIsolated:false},
    {workspace:'other'},
    {prefix:'other/media/'+ 'a'.repeat(32)},
    {prefix:WORKSPACE+'/media/x'},
    {prefix:PREFIX+'/nested'},
    {randomBytes:()=>Buffer.alloc(8)}
  ]){
    await assert.rejects(()=>attestPutOnlySession({
      s3:client,workspace:WORKSPACE,prefix:PREFIX,randomBytes:nonce,
      confirmIsolated:true,...cfg
    }));
  }
  assert.equal(checkPrefix(WORKSPACE,PREFIX),true);
  assert.equal(checkPrefix(WORKSPACE,WORKSPACE+'/media/../../foo'),false);
});
