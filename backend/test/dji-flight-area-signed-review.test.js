'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {
  inspectSignedFlightAreaReview,reviewSigningBytes,SCHEMA,REVIEW_KIND,MAX_LIFETIME_MS
}=require('../dji-flight-area-signed-review');

const now=1792800000000;
const workspaceId='42897e93-d55e-41a4-b744-ec26cefa0bb8';
const gatewaySn='DOCK-TEST';
const reviewId='672fb402-6c5c-4181-8d71-7da8d03b55f9';
const fileSha256='a'.repeat(64);
const evidenceSha256='b'.repeat(64);
const keyId='offline-reviewer-01';
const keys=crypto.generateKeyPairSync('ed25519');
const otherKeys=crypto.generateKeyPairSync('ed25519');
const trusted=new Map([[keyId,keys.publicKey]]);
const declaration=()=>({
  reviewKind:REVIEW_KIND,workspaceId,gatewaySn,revision:3,fileSha256,
  evidenceSha256,reviewId,issuedAt:now-1000,expiresAt:now+60000
});
const signed=(d=declaration(),id=keyId,priv=keys.privateKey)=>({
  schema:SCHEMA,signerKeyId:id,declaration:d,
  signature:crypto.sign(null,reviewSigningBytes(d,id),priv).toString('base64url')
});
const context=(envelope=signed(),additional={})=>({
  envelope,expectedWorkspaceId:workspaceId,expectedGatewaySn:gatewaySn,
  expectedRevision:3,expectedFileSha256:fileSha256,approvedKeys:trusted,
  now,...additional
});
const inspect=(envelope=signed(),overrides={})=>
  inspectSignedFlightAreaReview(context(envelope,overrides));
const rejected=(actual,reason)=>assert.deepEqual(actual,{accepted:false,reason});

test('valid trusted Ed25519 signature only verifies reviewed metadata, never DJI sync',()=>{
  const result=inspect();
  assert.deepEqual(result,{
    accepted:true,schema:SCHEMA,classification:'operator-signed-offline-review-only',
    operatorReviewSignatureVerified:true,targetMetadataBound:true,
    evidenceArtifactInspected:false,independentDeviceReadbackVerified:false,
    revisionVerified:false,syncVerified:false,flightReady:false,
    hardwareVerified:false
  });
});

test('signature binds signer id, workspace, gateway, target revision and both SHA256 digests',()=>{
  const original=signed();
  for(const [name,value] of [
    ['gatewaySn','OTHER-DOCK'],['revision',4],
    ['fileSha256','c'.repeat(64)],['evidenceSha256','d'.repeat(64)],
    ['workspaceId','11111111-1111-4111-8111-111111111111'],
    ['reviewId','11111111-1111-4111-8111-111111111111']
  ]){
    const envelope={...original,declaration:{...original.declaration,[name]:value}};
    const expected=name==='gatewaySn'?{expectedGatewaySn:value}:
      name==='revision'?{expectedRevision:value}:
      name==='fileSha256'?{expectedFileSha256:value}:
      name==='workspaceId'?{expectedWorkspaceId:value}:{};
    rejected(inspect(envelope,expected),'invalid_signature');
  }
  const switched={...original,signerKeyId:'another-id'};
  rejected(inspect(switched,{approvedKeys:new Map([['another-id',keys.publicKey]])}),
    'invalid_signature');
});

test('cryptographically signed review cannot be reused for other target context',()=>{
  const item=signed();
  rejected(inspect(item,{expectedWorkspaceId:'12345678-1234-4234-8234-123456789abc'}),'target_mismatch');
  rejected(inspect(item,{expectedGatewaySn:'DOCK-OTHER'}),'target_mismatch');
  rejected(inspect(item,{expectedRevision:4}),'target_mismatch');
  rejected(inspect(item,{expectedFileSha256:'c'.repeat(64)}),'target_mismatch');
});

test('unapproved, revoked and wrong-key signers fail closed',()=>{
  const item=signed();
  rejected(inspect(item,{approvedKeys:new Map()}),'unapproved_signer');
  rejected(inspect(item,{approvedKeys:new Map([[keyId,otherKeys.publicKey]])}),
    'invalid_signature');
  rejected(inspect(item,{approvedKeys:new Map([[keyId,keys.privateKey]])}),
    'unapproved_signer');
  rejected(inspect(item,{approvedKeys:new Map([[keyId,'not-a-public-key']])}),
    'unapproved_signer');
  rejected(inspect(item,{approvedKeys:{[keyId]:keys.publicKey}}),'untrusted_context');
});

test('metadata added to signed envelope or declaration is forbidden',()=>{
  const item=signed();
  rejected(inspect({...item,publicKey:keys.publicKey}),'invalid_envelope');
  rejected(inspect({...item,declaration:{...item.declaration,
    url:'https://example.invalid/token=SECRET'}}),'invalid_envelope');
  rejected(inspect({...item,declaration:{...item.declaration,
    deviceAttested:true}}),'invalid_envelope');
});

test('kind cannot be elevated to device attestation or flight authorization',()=>{
  const item=signed();
  const mutated={...item,declaration:{...item.declaration,
    reviewKind:'DJI-device-attestation'}};
  rejected(inspect(mutated),'invalid_envelope');
  const mutation={...item,declaration:{...item.declaration,
    reviewKind:'ready-to-fly'}};
  rejected(inspect(mutation),'invalid_envelope');
});

test('declared TTL maximum, not-yet-valid and expiration all fail closed',()=>{
  const item=signed();
  rejected(inspect(item,{now:item.declaration.issuedAt-30001}),'not_yet_valid');
  assert.equal(inspect(item,{now:item.declaration.issuedAt-30000}).accepted,true);
  rejected(inspect(item,{now:item.declaration.expiresAt+1}),'expired');
  const maxTTL=declaration();
  maxTTL.expiresAt=maxTTL.issuedAt+MAX_LIFETIME_MS;
  assert.equal(inspect(signed(maxTTL),{now:maxTTL.issuedAt+1}).accepted,true);
  const excess=declaration();excess.expiresAt=excess.issuedAt+MAX_LIFETIME_MS+1;
  rejected(inspect({...item,declaration:excess}),'invalid_envelope');
  const backwards=declaration();backwards.expiresAt=backwards.issuedAt;
  rejected(inspect({...item,declaration:backwards}),'invalid_envelope');
});

test('invalid clock, untrusted context and malformed signatures fail closed',()=>{
  const item=signed();
  rejected(inspect(item,{now:NaN}),'invalid_clock');
  rejected(inspect(item,{expectedGatewaySn:undefined}),'untrusted_context');
  rejected(inspect(item,{expectedWorkspaceId:'bad'}),'untrusted_context');
  rejected(inspect(item,{expectedRevision:0}),'untrusted_context');
  rejected(inspect(item,{expectedFileSha256:'bad'}),'untrusted_context');
  rejected(inspect({...item,signature:'invalid'}),'invalid_envelope');
  rejected(inspect({...item,signature:item.signature.slice(1)}),'invalid_envelope');
  rejected(inspect({...item,signerKeyId:17}),'invalid_envelope');
  rejected(inspect({schema:SCHEMA,declaration:item.declaration}),'invalid_envelope');
});

test('field-order independence with strong field canonicalization',()=>{
  const d=declaration();
  const shuffled={
    expiresAt:d.expiresAt,reviewId:d.reviewId,evidenceSha256:d.evidenceSha256,
    fileSha256:d.fileSha256,revision:d.revision,workspaceId:d.workspaceId,
    gatewaySn:d.gatewaySn,issuedAt:d.issuedAt,reviewKind:d.reviewKind
  };
  const a=reviewSigningBytes(d,keyId);
  const b=reviewSigningBytes(shuffled,keyId);
  assert.deepEqual(a,b);
  assert.equal(inspect({...signed(),declaration:shuffled}).accepted,true);
});

test('unknown signers and noncanonical or tampered signatures never validate',()=>{
  const item=signed();
  rejected(inspect({...item,signerKeyId:'missing'}),'unapproved_signer');
  const forged=signed(declaration(),keyId,otherKeys.privateKey);
  rejected(inspect(forged),'invalid_signature');
  const signature=Buffer.alloc(64).toString('base64url');
  rejected(inspect({...item,signature}),'invalid_signature');
  const tampered=item.signature.slice(0,12)+(item.signature[12]==='A'?'B':'A')+
    item.signature.slice(13);
  rejected(inspect({...item,signature:tampered}),'invalid_signature');
});

test('the verifier never emits identifiers, digests, signatures or source URLs',()=>{
  const item=signed();
  const result=JSON.stringify(inspect(item));
  for(const forbidden of [
    workspaceId,gatewaySn,reviewId,fileSha256,evidenceSha256,
    item.signature,keyId
  ])assert.ok(!result.includes(forbidden));
});

test('no filesystem, external verification, MQTT, DB, timer or network side effects',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../dji-flight-area-signed-review.js'),'utf8');
  for(const pattern of [
    /require\(['"]fs['"]\)/,/require\(['"]mqtt['"]\)/,
    /require\(['"]pg['"]\)/, /\.publish\s*\(/,
    /\.subscribe\s*\(/,/fetch\s*\(/,/setInterval\s*\(/
  ])assert.doesNotMatch(source,pattern);
});
