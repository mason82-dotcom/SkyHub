'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {
  verifySignedLabReview,SCHEMA,SIGNING_DOMAIN,MAX_MANIFEST_BYTES,
  MAX_VALIDITY_MS
}=require('../dji-flight-area-lab-review');

const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const trustedSpkiDer=publicKey.export({format:'der',type:'spki'});
const expectedKeySha256=crypto.createHash('sha256').update(trustedSpkiDer).digest('hex');
const observedAt=1792740000000;
const expected={
  workspaceId:'11111111-2222-4333-8444-555555555555',
  gatewaySn:'DOCK-TEST',
  revision:3,
  fileSha256:'a'.repeat(64),
  challengeNonce:'b'.repeat(32)
};
const manifest=()=>({
  schema:SCHEMA,
  source:'operator_reviewed_lab',
  workspaceId:expected.workspaceId,
  gatewaySn:expected.gatewaySn,
  revision:expected.revision,
  fileSha256:expected.fileSha256,
  challengeNonce:expected.challengeNonce,
  observedAt,expiresAt:observedAt+60000,
  claim:'file_present_in_lab_readback'
});
function signed(m=manifest(),key=privateKey){
  const manifestBytes=Buffer.from(JSON.stringify(m),'utf8');
  const signedBytes=Buffer.concat([Buffer.from(SIGNING_DOMAIN,'utf8'),manifestBytes]);
  return {manifestBytes,signatureBase64:crypto.sign(null,signedBytes,key).toString('base64')};
}
function verify(record=signed(),extra={}){
  return verifySignedLabReview({...record,trustedSpkiDer,expectedKeySha256,
    expected,now:observedAt+1000,...extra});
}
const reject=(result,reason)=>assert.deepEqual(result,{accepted:false,reason});

test('a pinned Ed25519 reviewer signature verifies a claim, not device state',()=>{
  const result=verify();
  assert.deepEqual(result,{
    accepted:true,schema:SCHEMA,kind:'signed_lab_review',
    reviewerSignatureValid:true,claimMatchesTarget:true,
    independentDeviceReadbackVerified:false,deviceInstallationVerified:false,
    revisionVerified:false,syncVerified:false,flightReady:false,
    hardwareVerified:false
  });
});

test('forged signature and tampered signed message are rejected',()=>{
  const record=signed();
  const manifestBytes=Buffer.from(record.manifestBytes);
  const index=manifestBytes.indexOf(Buffer.from('"revision":3'));
  assert.ok(index!==-1);
  manifestBytes[index+11]='4'.charCodeAt(0);
  reject(verify({...record,manifestBytes}),'target_mismatch');
  const {privateKey:forgedKey}=crypto.generateKeyPairSync('ed25519');
  reject(verify(signed(manifest(),forgedKey)),'invalid_signature');
  const bytes=Buffer.from(record.signatureBase64,'base64');
  bytes[6]^=1;
  reject(verify({...record,signatureBase64:bytes.toString('base64')}),'invalid_signature');
});

test('a different public key cannot be substituted without pinned fingerprint',()=>{
  const {publicKey:otherKey}=crypto.generateKeyPairSync('ed25519');
  const otherDer=otherKey.export({format:'der',type:'spki'});
  reject(verify(signed(),{trustedSpkiDer:otherDer}),'untrusted_key');
  reject(verify(signed(),{expectedKeySha256:'0'.repeat(64)}),'untrusted_key');
  reject(verify(signed(),{trustedSpkiDer:Buffer.alloc(0)}),'invalid_trust_anchor');
  reject(verify(signed(),{expectedKeySha256:null}),'invalid_trust_anchor');
});

test('all trusted target dimensions are bound to the signed bytes',()=>{
  const changes=[
    {workspaceId:'22222222-2222-4333-8444-555555555555'},
    {gatewaySn:'ANOTHER-DOCK'},
    {revision:4},
    {fileSha256:'c'.repeat(64)},
    {challengeNonce:'d'.repeat(32)}
  ];
  for(const changed of changes){
    const result=verify(signed({...manifest(),...changed}));
    reject(result,'target_mismatch');
  }
  for(const changed of changes){
    reject(verify(signed(),{expected:{...expected,...changed}}),'target_mismatch');
  }
});

test('reused signed evidence cannot match a new challenge nonce or revision',()=>{
  const old=signed();
  assert.equal(verify(old).accepted,true);
  reject(verify(old,{expected:{...expected,challengeNonce:'f'.repeat(32)}}),'target_mismatch');
  reject(verify(old,{expected:{...expected,revision:5}}),'target_mismatch');
});

test('missing, untrusted and malformed expected context is refused',()=>{
  for(const change of [
    {workspaceId:'not-uuid'},
    {gatewaySn:'bad/device'},
    {fileSha256:'abc'},
    {challengeNonce:'x'},
    {revision:0}
  ])reject(verify(signed(),{expected:{...expected,...change}}),'invalid_trust_context');
  reject(verify(signed(),{expected:undefined}),'invalid_trust_context');
  reject(verify(signed(),{now:0}),'invalid_trust_context');
});

test('expiry is inclusive, future skew bounded, maximum validity enforced',()=>{
  const record=signed();
  assert.equal(verify(record,{now:observedAt+60000}).accepted,true);
  reject(verify(record,{now:observedAt+60001}),'expired');
  reject(verify(record,{now:observedAt-30001}),'future');
  assert.equal(verify(record,{now:observedAt-30000}).accepted,true);
  const long=signed({...manifest(),expiresAt:observedAt+MAX_VALIDITY_MS+1});
  reject(verify(long),'invalid_manifest');
  const backwards=signed({...manifest(),expiresAt:observedAt});
  reject(verify(backwards),'invalid_manifest');
});

test('unknown fields, reordered keys, noncanonical JSON and duplicate JSON keys fail closed',()=>{
  const base=manifest();
  reject(verify(signed({...base,accessToken:'secret'})),'noncanonical_manifest');
  const reordered={claim:base.claim};
  for(const [k,v] of Object.entries(base))if(k!=='claim')reordered[k]=v;
  reject(verify(signed(reordered)),'noncanonical_manifest');
  const raw=signed();
  const text=raw.manifestBytes.toString('utf8');
  const spaced=Buffer.from(text.replace('"source":','"source": '));
  reject(verify({...raw,manifestBytes:spaced}),'noncanonical_manifest');
  const duplicate=Buffer.from(text.replace('"revision":3','"revision":3,"revision":3'));
  reject(verify({...raw,manifestBytes:duplicate}),'noncanonical_manifest');
});

test('schema/source/claim cannot be upgraded into alleged hardware attestation',()=>{
  for(const field of [
    {schema:'skyhub-dji-verified-device-v1'},
    {source:'trusted_dji_hardware'},
    {claim:'device_installation_verified'}
  ])reject(verify(signed({...manifest(),...field})),'invalid_manifest');
});

test('invalid base64 encodings, size and JSON types are rejected',()=>{
  const a=signed();
  for(const signatureBase64 of [null,'not-a-base64','=',a.signatureBase64.slice(1),
    a.signatureBase64.replace(/=$/,'A')]){
    reject(verify({...a,signatureBase64}),'invalid_signature_encoding');
  }
  for(const manifestBytes of [
    Buffer.alloc(0),Buffer.alloc(MAX_MANIFEST_BYTES+1),Buffer.from('[]'),
    Buffer.from('null')
  ]){
    reject(verify({...a,manifestBytes}),manifestBytes.length===0 ||
      manifestBytes.length>MAX_MANIFEST_BYTES?'invalid_manifest_size':'noncanonical_manifest');
  }
  reject(verify({...a,manifestBytes:Buffer.from('{invalid')}),'invalid_manifest');
  reject(verify({...a,manifestBytes:'not-buffer'}),'invalid_manifest_size');
});

test('reviewer manifest reports no private identifiers, keys, hashes or signed payloads',()=>{
  const result=JSON.stringify(verify());
  for(const value of [expected.workspaceId,expected.gatewaySn,expected.fileSha256,
    expected.challengeNonce,expectedKeySha256,'PRIVATE','BEGIN PUBLIC KEY'])
    assert.ok(!result.includes(value));
});

test('review verifier is local and never opens a device or a network connection',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../dji-flight-area-lab-review.js'),'utf8');
  for(const pattern of [/require\(['"]mqtt['"]\)/,/\.publish\s*\(/,
    /\.subscribe\s*\(/,/require\(['"]fs['"]\)/, /require\(['"]pg['"]\)/,
    /setInterval\s*\(/, /fetch\s*\(/, /\.emit\s*\(/]){
    assert.doesNotMatch(source,pattern);
  }
});
