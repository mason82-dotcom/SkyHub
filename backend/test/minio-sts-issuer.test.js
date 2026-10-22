'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {BUCKET,TTL_SECONDS,IAM_ACTION,issuePolicy,signedRequest,
  parseCredentialsXml,createMinioStsIssuer}=require('../minio-sts-issuer');
const {createPilotMediaStsHandler}=require('../pilot-media-sts');

const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='123e4567-e89b-42d3-a456-426614174000';
const SESSION='a'.repeat(32);
const NOW=Date.parse('2026-10-22T12:00:00.000Z');
const ORIGIN='https://minio.example.test:9000';
const PRINCIPAL={role:'pilot',workspaceId:WORKSPACE};
const KEYS={accessKeyId:'MINIO_STS_ISSUER_TEST',secretAccessKey:'TEST_ONLY_KEY_NOT_REAL_12345'};
const TEMP={accessKeyId:'TEMPORARYKEY12345',accessKeySecret:'SYNTHETICSECRETKEY1234',
  securityToken:'SYNTHETIC_SESSION_TOKEN_FOR_TESTS_1234567890'};
function xml({expiresAt=NOW+900000,accessKeyId=TEMP.accessKeyId,
  secretAccessKey=TEMP.accessKeySecret,securityToken=TEMP.securityToken}={}){
  return '<?xml version="1.0" encoding="UTF-8"?>'+
    '<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">'+
    '<AssumeRoleResult><AssumedRoleUser><Arn/></AssumedRoleUser><Credentials>'+
    '<AccessKeyId>'+accessKeyId+'</AccessKeyId>'+
    '<SecretAccessKey>'+secretAccessKey+'</SecretAccessKey>'+
    '<SessionToken>'+securityToken+'</SessionToken>'+
    '<Expiration>'+new Date(expiresAt).toISOString()+'</Expiration>'+
    '</Credentials></AssumeRoleResult><ResponseMetadata/></AssumeRoleResponse>';
}
function issuer(options={}){
  return createMinioStsIssuer({
    endpoint:ORIGIN,...KEYS,clock:()=>NOW,sessionId:()=>SESSION,
    transport:async()=>({status:200,body:xml()}),...options
  });
}
const args={workspace:WORKSPACE,principal:PRINCIPAL,maxSeconds:900};

test('session policy has exactly one PutObject action and exact workspace/session resource',()=>{
  const {prefix,policy}=issuePolicy(WORKSPACE,SESSION);
  assert.equal(prefix,WORKSPACE+'/media/'+SESSION);
  const p=JSON.parse(policy);
  assert.deepEqual(p,{Version:'2012-10-17',Statement:[{
    Effect:'Allow',Action:['s3:PutObject'],Resource:[
      'arn:aws:s3:::dji-cloud/'+WORKSPACE+'/media/'+SESSION+'/*'
    ]
  }]});
  assert.equal(IAM_ACTION,'s3:PutObject');
  assert.equal(BUCKET,'dji-cloud');
  assert.equal(TTL_SECONDS,900);
  assert.doesNotMatch(policy,/ListBucket|GetObject|DeleteObject|s3:\*|AbortMultipartUpload|arn:aws:s3:::\*/);
  assert.ok(Buffer.byteLength(policy)<2048);
});

test('scope validation refuses foreign workspace, traversal and fake session names',()=>{
  for(const workspace of ['',OTHER+'/../'+WORKSPACE,'../'+WORKSPACE,'bad',null]){
    assert.throws(()=>issuePolicy(workspace,SESSION));
  }
  for(const session of ['anything','a'.repeat(31),'b'.repeat(33),'../other',SESSION+'/foo',null]){
    assert.throws(()=>issuePolicy(WORKSPACE,session));
  }
});

test('signed STS request contains only AssumeRole and the restrictive inline policy',()=>{
  const policy=issuePolicy(WORKSPACE,SESSION).policy;
  const req=signedRequest({url:ORIGIN,...KEYS,region:'us-east-1',policy,at:NOW});
  assert.equal(req.url,ORIGIN);
  assert.equal(req.method,'POST');
  assert.equal(req.headers['x-amz-date'],'20261022T120000Z');
  assert.equal(req.headers['x-amz-content-sha256'],
    crypto.createHash('sha256').update(req.body).digest('hex'));
  assert.equal(Number(req.headers['content-length']),Buffer.byteLength(req.body));
  const fields=Object.fromEntries(new URLSearchParams(req.body));
  assert.deepEqual(Object.keys(fields),['Action','DurationSeconds','Policy','Version']);
  assert.equal(fields.Action,'AssumeRole');
  assert.equal(fields.DurationSeconds,'900');
  assert.equal(fields.Version,'2011-06-15');
  assert.equal(fields.Policy,policy);
  assert.match(req.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=MINIO_STS_ISSUER_TEST\/20261022\/us-east-1\/sts\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(req),/TEST_ONLY_KEY_NOT_REAL_12345/);
  const tampered=signedRequest({url:ORIGIN,...KEYS,region:'us-east-1',
    policy:policy.replace('PutObject','GetObject'),at:NOW});
  assert.notEqual(tampered.headers.authorization,req.headers.authorization);
});

test('credentials parse from documented MinIO namespace shape with strict limits',()=>{
  const creds=parseCredentialsXml(xml());
  assert.deepEqual(creds,{...TEMP,expiresAt:NOW+900000});
  assert.throws(()=>parseCredentialsXml('<Error>private secret</Error>'));
  assert.throws(()=>parseCredentialsXml(xml().replace('<AssumeRoleResult>',
    '<!DOCTYPE foo [<!ENTITY secret SYSTEM "file:///etc/passwd">]><AssumeRoleResult>')));
  assert.throws(()=>parseCredentialsXml(xml().replace('</Credentials>',
    '<AccessKeyId>SECOND</AccessKeyId></Credentials>')));
  assert.throws(()=>parseCredentialsXml(xml().replace(TEMP.securityToken,'BAD&ENTITY;')));
  assert.throws(()=>parseCredentialsXml('x'.repeat(32769)));
});

test('successful synthetic MinIO STS exchange returns only a 900-second scoped temporary grant',async()=>{
  let sent,requests=0;
  const issue=issuer({transport:async request=>{
    requests++;sent=request;return {status:200,body:xml()};
  }});
  const g=await issue(args);
  assert.equal(requests,1);
  assert.equal(g.provider,'minio');
  assert.equal(g.bucket,'dji-cloud');
  assert.equal(g.endpoint,ORIGIN);
  assert.equal(g.region,'us-east-1');
  assert.equal(g.objectKeyPrefix,WORKSPACE+'/media/'+SESSION);
  assert.deepEqual(g.credentials,{...TEMP,expire:900});
  assert.doesNotMatch(JSON.stringify(sent),/TEST_ONLY_KEY_NOT_REAL_12345/);
});

test('request is denied before transport for mismatching principal, duration and workspace',async()=>{
  let sent=0;
  const issue=issuer({transport:async()=>{sent++;return {status:200,body:xml()};}});
  const invalid=[
    {...args,principal:{role:'pilot',workspaceId:OTHER}},
    {...args,principal:{role:'operator',workspaceId:WORKSPACE}},
    {...args,maxSeconds:1800},
    {...args,maxSeconds:899},
    {...args,workspace:OTHER},
    {...args,principal:true},
    {...args,principal:null}
  ];
  for(const value of invalid)await assert.rejects(()=>issue(value));
  assert.equal(sent,0);
});

test('issuer denies non-TLS, credentials in URL, missing signer configuration or malformed session',async()=>{
  for(const endpoint of ['http://minio.example.test:9000',
    'https://user:secret@minio.example.test:9000',
    'https://minio.example.test:9000/path',
    'https://minio.example.test:9000/?x=1','not-an-origin']){
    assert.throws(()=>createMinioStsIssuer({endpoint,...KEYS}));
  }
  assert.throws(()=>createMinioStsIssuer({endpoint:ORIGIN,accessKeyId:'x'}));
  await assert.rejects(()=>issuer({sessionId:()=>WORKSPACE})(args));
  await assert.rejects(()=>issuer({sessionId:()=>SESSION+'/other'})(args));
});

test('STS transport failures and excessive lifetime are rejected without publishing tokens',async()=>{
  for(const response of [
    {status:401,body:xml()},
    {status:302,body:xml()},
    {status:200,body:'<Error>AccessDenied</Error>'},
    {status:200,body:xml({expiresAt:NOW+901000})},
    {status:200,body:xml({expiresAt:NOW+59000})},
    {status:200,body:'x'.repeat(32769)},
    null
  ]){
    await assert.rejects(()=>issuer({transport:async()=>response})(args));
  }
  await assert.rejects(()=>issuer({transport:async()=>{throw Error('PRIVATE_STS_ERROR');}})(args));
});

test('issuer does not claim full TTL after network delay',async()=>{
  let current=NOW;
  const issue=issuer({clock:()=>current,transport:async()=>{
    current=NOW+3500;
    return {status:200,body:xml()};
  }});
  const out=await issue(args);
  assert.equal(out.credentials.expire,896);
});

test('integrates with isolated Pilot 2 HTTPS boundary without server routes or persistence',async()=>{
  const h=createPilotMediaStsHandler({
    workspace:WORKSPACE,authorize:async token=>token==='DEVICE_TOKEN'?PRINCIPAL:null,
    allowIssuance:async()=>true,
    issueGrant:issuer(),
    storage:{bucket:'dji-cloud',endpoint:ORIGIN,region:'us-east-1'}
  });
  const req={secure:true,headers:{'x-auth-token':'DEVICE_TOKEN'},
    params:{workspaceId:WORKSPACE},body:{},query:{}};
  const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this;},
    set(key,value){this.headers[key.toLowerCase()]=value;return this;},
    json(body){this.body=body;return body;}};
  await h(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.data.provider,'minio');
  assert.equal(res.body.data.credentials.expire,900);
  assert.equal(res.headers['cache-control'],'no-store');
  assert.equal(res.body.data.object_key_prefix,WORKSPACE+'/media/'+SESSION);
  const denied={...res,statusCode:200,headers:{},status:res.status,set:res.set,json:res.json};
  await h({...req,params:{workspaceId:OTHER}},denied);
  assert.equal(denied.statusCode,404);
  assert.deepEqual(denied.body.data,{});
});

test('new issuer never bootstraps itself into production or reads environment secrets',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../minio-sts-issuer.js'),'utf8');
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/minio-sts-issuer|pilot-media-sts/);
  assert.doesNotMatch(source,/process\.env|console\.(log|error)|NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.doesNotMatch(source,/http\.request|rejectUnauthorized:\s*false|@aws-sdk/);
});
