'use strict';

// Offline signature verifier for operator-reviewed laboratory evidence.
// A valid signature authenticates the reviewer's claim, NEVER DJI device state.
// No MQTT, device control, network, persistence, secrets or runtime integration.
const crypto=require('node:crypto');
const {serial}=require('./dji');

const SCHEMA='skyhub-flight-area-lab-review-v1';
const SIGNING_DOMAIN='SkyHub-Next/flight-area/lab-review/v1\0';
const MAX_MANIFEST_BYTES=2048;
const MAX_VALIDITY_MS=300000;
const MAX_CLOCK_SKEW_MS=30000;
const SHA256=/^[a-f0-9]{64}$/i;
const NONCE=/^[a-f0-9]{32}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS=['schema','source','workspaceId','gatewaySn','revision',
  'fileSha256','challengeNonce','observedAt','expiresAt','claim'];
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isTime=v=>Number.isSafeInteger(v)&&v>=1e12&&v<=1e15;
const denied=reason=>({accepted:false,reason});
const sameHex=(a,b)=>crypto.timingSafeEqual(Buffer.from(a.toLowerCase(),'hex'),
  Buffer.from(b.toLowerCase(),'hex'));

function verifySignedLabReview({
  manifestBytes,signatureBase64,trustedSpkiDer,expectedKeySha256,
  expected,now
}={}){
  // All trust anchors and expected target values MUST come from authenticated
  // server configuration, never from the review manifest or request body.
  if(!isObject(expected)||!UUID.test(expected.workspaceId||'')||
     !serial(expected.gatewaySn)||
     !Number.isSafeInteger(expected.revision)||expected.revision<=0||
     typeof expected.fileSha256!=='string'||!SHA256.test(expected.fileSha256)||
     typeof expected.challengeNonce!=='string'||!NONCE.test(expected.challengeNonce)||
     !isTime(now))return denied('invalid_trust_context');
  if(!Buffer.isBuffer(trustedSpkiDer)||trustedSpkiDer.length!==44||
     typeof expectedKeySha256!=='string'||!SHA256.test(expectedKeySha256))
    return denied('invalid_trust_anchor');
  if(!sameHex(crypto.createHash('sha256').update(trustedSpkiDer).digest('hex'),
    expectedKeySha256))return denied('untrusted_key');
  if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length===0||
     manifestBytes.length>MAX_MANIFEST_BYTES)return denied('invalid_manifest_size');
  if(typeof signatureBase64!=='string'||!/^[A-Za-z0-9+/]{86}==?$/.test(signatureBase64)||
     signatureBase64.length!==88)return denied('invalid_signature_encoding');
  const signature=Buffer.from(signatureBase64,'base64');
  if(signature.length!==64||signature.toString('base64')!==signatureBase64)
    return denied('invalid_signature_encoding');

  let manifest;
  try{manifest=JSON.parse(manifestBytes.toString('utf8'));}
  catch(_err){return denied('invalid_manifest');}
  if(!isObject(manifest)||Object.keys(manifest).length!==KEYS.length||
     !KEYS.every((key,i)=>Object.keys(manifest)[i]===key)||
     Buffer.from(JSON.stringify(manifest),'utf8').compare(manifestBytes)!==0)
    return denied('noncanonical_manifest');
  if(manifest.schema!==SCHEMA||
     manifest.source!=='operator_reviewed_lab'||
     manifest.claim!=='file_present_in_lab_readback'||
     !UUID.test(manifest.workspaceId||'')||
     !serial(manifest.gatewaySn)||
     !Number.isSafeInteger(manifest.revision)||manifest.revision<=0||
     typeof manifest.fileSha256!=='string'||!SHA256.test(manifest.fileSha256)||
     typeof manifest.challengeNonce!=='string'||!NONCE.test(manifest.challengeNonce)||
     !isTime(manifest.observedAt)||!isTime(manifest.expiresAt)||
     manifest.expiresAt<=manifest.observedAt||
     manifest.expiresAt-manifest.observedAt>MAX_VALIDITY_MS)
    return denied('invalid_manifest');
  if(manifest.workspaceId!==expected.workspaceId||
     manifest.gatewaySn!==expected.gatewaySn||
     manifest.revision!==expected.revision||
     !sameHex(manifest.fileSha256,expected.fileSha256)||
     !sameHex(manifest.challengeNonce,expected.challengeNonce))
    return denied('target_mismatch');
  if(now<manifest.observedAt-MAX_CLOCK_SKEW_MS)return denied('future');
  if(now>manifest.expiresAt)return denied('expired');

  let key;
  try{
    key=crypto.createPublicKey({key:trustedSpkiDer,format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ed25519')return denied('invalid_trust_anchor');
  }catch(_err){return denied('invalid_trust_anchor');}
  const signedBytes=Buffer.concat([Buffer.from(SIGNING_DOMAIN,'utf8'),manifestBytes]);
  if(!crypto.verify(null,signedBytes,key,signature))return denied('invalid_signature');
  // This is cryptographically authenticated CLAIM EVIDENCE only.
  // A reviewer signing a manifest does not constitute device attestation.
  return {
    accepted:true,schema:SCHEMA,kind:'signed_lab_review',
    reviewerSignatureValid:true,claimMatchesTarget:true,
    independentDeviceReadbackVerified:false,
    deviceInstallationVerified:false,revisionVerified:false,
    syncVerified:false,flightReady:false,hardwareVerified:false
  };
}

module.exports={
  verifySignedLabReview,SCHEMA,SIGNING_DOMAIN,MAX_MANIFEST_BYTES,
  MAX_VALIDITY_MS,MAX_CLOCK_SKEW_MS
};
