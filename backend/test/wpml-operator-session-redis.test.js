'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createWpmlRedisSessionCheck,SESSION_SCHEMA}=
  require('../wpml-operator-session-redis');
const {createWpmlOperatorVerifier,AUDIENCE}=
  require('../wpml-operator-verifier');
const {createWpmlRouteService}=require('../wpml-central-routes');
const ISSUER='https://auth.example.test/operator';
const A='e3dea0f5-37f2-4d79-ae58-490af3228069';
const B='203cc94c-aef1-4e0e-a520-05a24be33a31';
const USER='69ecb38c-04f2-44d0-adc6-3441cb4f9449';
const SESSION='4d8779ac-4573-444d-ab9c-23ac0814f8b1';
const NOW=1800000000;
const PEPPER='dedicated-ci-only-wpml-operator-session-hmac-pepper';
const claim=()=>({issuer:ISSUER,subject:USER,workspaceId:A,role:'operator',
  sessionId:SESSION,expiresAt:NOW+300,keyId:'kidA'});
const record=()=>({schema:SESSION_SCHEMA,issuer:ISSUER,subject:USER,
  workspaceId:A,role:'operator',sessionId:SESSION,expiresAt:NOW+600,
  status:'active'});
const redisKey=()=> 'skyhub:wpml:operator-session:v1:'+
  crypto.createHmac('sha256',PEPPER).update(SESSION).digest('hex');
function registry(initial=JSON.stringify(record())){
  let data=initial;const keys=[];
  return {keys,get:async key=>{keys.push(key);return data;},
    update:v=>{data=v;}};
}
function session(redis){return createWpmlRedisSessionCheck({
  redis,keySecret:PEPPER,clock:()=>NOW*1000});}
test('requires dedicated key material and independent read-only lookup',()=>{
  assert.throws(()=>createWpmlRedisSessionCheck(),/read-only Redis/);
  assert.throws(()=>createWpmlRedisSessionCheck({redis:{get:async()=>null},
    keySecret:'short'}),/Dedicated 32/);
  assert.throws(()=>createWpmlRedisSessionCheck({redis:{get:async()=>null},
    keySecret:PEPPER,clock:25}),/Clock/);
});
test('read-only GET uses HMAC-scoped key and never leaks raw session UUID or token',async()=>{
  const r=registry();
  assert.equal(await session(r)(claim()),true);
  assert.deepEqual(r.keys,[redisKey()]);
  assert.doesNotMatch(r.keys[0],new RegExp(SESSION+'|'+USER+'|'+A));
  assert.equal(r.keys[0].length,'skyhub:wpml:operator-session:v1:'.length+64);
});
test('rejected, altered or revoked session records fail closed without retries or writes',async()=>{
  const wrong=[
    null,'','{}','not-json',
    JSON.stringify({...record(),status:'revoked'}),
    JSON.stringify({...record(),status:'pending'}),
    JSON.stringify({...record(),workspaceId:B}),
    JSON.stringify({...record(),subject:B}),
    JSON.stringify({...record(),role:'admin'}),
    JSON.stringify({...record(),issuer:'https://unknown'}),
    JSON.stringify({...record(),sessionId:B}),
    JSON.stringify({...record(),expiresAt:NOW+299}),
    JSON.stringify({...record(),expiresAt:NOW-1}),
    JSON.stringify({...record(),schema:'old-format'}),
    JSON.stringify({...record(),extraGrant:true}),
    JSON.stringify({...record(),status:true}),
    JSON.stringify(record()).replace('"status":"active"',
      '"status":"active","status":"active"'),
    'x'.repeat(2049)
  ];
  for(const data of wrong){
    const r=registry(data);assert.equal(await session(r)(claim()),false,
      String(data).slice(0,32));
    assert.equal(r.keys.length,1);
  }
  const unavailable={get:async()=>{throw Error('sensitive redis failure');}};
  assert.equal(await session(unavailable)(claim()),false);
  assert.equal(await session({get:async()=>({active:true})})(claim()),false);
});
test('stalled or extremely slow Redis lookup rejects by a bounded deadline',async()=>{
  const hanging={get:()=>new Promise(()=>{})};
  const start=Date.now();
  const check=createWpmlRedisSessionCheck({
    redis:hanging,keySecret:PEPPER,clock:()=>NOW*1000,lookupTimeoutMs:25});
  assert.equal(await check(claim()),false);
  assert.ok(Date.now()-start<1000,'stalled lookup must not block the session gate');
  assert.throws(()=>createWpmlRedisSessionCheck({
    redis:hanging,keySecret:PEPPER,lookupTimeoutMs:0}),/Bounded Redis/);
  assert.throws(()=>createWpmlRedisSessionCheck({
    redis:hanging,keySecret:PEPPER,lookupTimeoutMs:60000}),/Bounded Redis/);
  let release;
  const late={get:()=>new Promise(resolve=>{release=resolve;})};
  const delayed=createWpmlRedisSessionCheck({
    redis:late,keySecret:PEPPER,clock:()=>NOW*1000,lookupTimeoutMs:25});
  assert.equal(await delayed(claim()),false);
  release(JSON.stringify(record())); // must never authorize after timeout
});
test('multibyte session response exceeding the byte budget is rejected',async()=>{
  const r=registry(JSON.stringify(record())+'🛰️'.repeat(700));
  assert.equal(await session(r)(claim()),false);
});
test('revocation, expiry and actor tampering prevent access',async()=>{
  const r=registry(),check=session(r);
  assert.equal(await check(claim()),true);
  r.update(JSON.stringify({...record(),status:'revoked'}));
  assert.equal(await check(claim()),false);
  r.update(JSON.stringify(record()));
  assert.equal(await check({...claim(),workspaceId:B}),false);
  assert.equal(await check({...claim(),role:'admin'}),false);
  assert.equal(await check({...claim(),expiresAt:NOW+1000}),false);
  assert.equal(await check({...claim(),expiresAt:NOW}),false);
  assert.equal(await check({...claim(),sessionId:'not uuid'}),false);
  assert.equal(await check({...claim(),subject:'not uuid'}),false);
});
test('signed operator claim + server-side Redis session allows only matching workspace',async()=>{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const now=()=>NOW*1000;
  const r=registry();
  const verify=createWpmlOperatorVerifier({
    issuer:ISSUER,publicKeys:{kidA:publicKey},
    isActiveSession:session(r),clock:now
  });
  const payload={iss:ISSUER,aud:AUDIENCE,sub:USER,workspaceId:A,
    role:'operator',kind:'human',iat:NOW-60,nbf:NOW-60,
    exp:NOW+300,jti:SESSION};
  function sign(claims=payload){
    const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT',kid:'kidA'}))
      .toString('base64url');
    const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
    const head=header+'.'+body;
    return head+'.'+crypto.sign(null,Buffer.from(head,'ascii'),privateKey)
      .toString('base64url');
  }
  const db={calls:[],connect:async()=>({
    query:async(sql,params=[])=>{
      db.calls.push({sql,params});
      if(sql.includes('SELECT route_id,route_name'))
        return {rowCount:0,rows:[]};
      return {rowCount:0,rows:[]};
    },release(){}
  })};
  const svc=createWpmlRouteService({pool:db,authorize:verify});
  assert.deepEqual(await svc.listRoutes({credential:sign(),workspaceId:A}),[]);
  assert.equal(db.calls.some(q=>q.sql.includes('SELECT route_id,route_name')),true);
  const previous=db.calls.length;
  await assert.rejects(svc.listRoutes({credential:sign(),workspaceId:B}),
    {code:'unauthorized'});
  assert.equal(db.calls.length,previous);
  r.update(JSON.stringify({...record(),status:'revoked'}));
  await assert.rejects(svc.listRoutes({credential:sign(),workspaceId:A}),
    {code:'unauthorized'});
  assert.equal(db.calls.length,previous);
  r.update(JSON.stringify(record()));
  await assert.rejects(svc.listRoutes({credential:sign({...payload,role:'admin'}),
    workspaceId:A}),{code:'unauthorized'});
  assert.equal(db.calls.length,previous);
});
test('session reader is not loaded by live server and never writes Redis or uses network',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,
    '../wpml-operator-session-redis.js'),'utf8');
  const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.doesNotMatch(server,/wpml-operator-session-redis|wpml-operator-verifier/);
  assert.doesNotMatch(source,/redis\.set\(|redis\.del\(|redis\.eval\(|fetch\s*\(/);
  assert.match(source,/redis\.get\(/);
});
