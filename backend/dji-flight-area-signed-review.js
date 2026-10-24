'use strict';

// Offline-only Ed25519 verification of an operator-reviewed artifact declaration.
// This is NOT DJI device attestation, file readback or permission to fly.
const crypto=require('node:crypto');
const {serial}=require('./dji');

const SCHEMA='skyhub-flight-area-signed-review-v1';
const DOMAIN='SkyHub-Next/offline-flight-area-review/v1';
const REVIEW_KIND='operator-offline-review';
const MAX_LIFETIME_MS=86400000;
const MAX_FUTURE_SKEW_MS=30000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/i;
const KEY_ID=/^[a-zA-Z0-9_.-]{1,64}$/;
const SIG=/^[a-zA-Z0-9_-]{86}$/;
const ENVELOPE_KEYS=['declaration','schema','signature','signerKeyId'];
const DECLARATION_KEYS=[
  'evidenceSha256','expiresAt','fileSha256','gatewaySn','issuedAt',
  'reviewId','reviewKind','revision','workspaceId'
];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const epoch=x=>Number.isSafeInteger(x)&&x>=1e12&&x<=1e15;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const reject=reason=>({accepted:false,reason});

function validDeclaration(d){
  return exact(d,DECLARATION_KEYS)&&d.reviewKind===REVIEW_KIND&&
    UUID.test(d.workspaceId)&&serial(d.gatewaySn)!==null&&
    positive(d.revision)&&typeof d.fileSha256==='string'&&
    HASH.test(d.fileSha256)&&typeof d.evidenceSha256==='string'&&
    HASH.test(d.evidenceSha256)&&UUID.test(d.reviewId)&&
    epoch(d.issuedAt)&&epoch(d.expiresAt)&&
    d.expiresAt>d.issuedAt&&
    d.expiresAt-d.issuedAt<=MAX_LIFETIME_MS;
}

// Public signing format for externally managed, reviewed test/signing workflows.
// A detached Ed25519 signature covers all fields INCLUDING signerKeyId,
// which prevents key-id substitution even if keys were accidentally reused.
function reviewSigningBytes(declaration,signerKeyId){
  if(!validDeclaration(declaration)||typeof signerKeyId!=='string'||
     !KEY_ID.test(signerKeyId))
    throw new TypeError('Invalid signed review declaration');
  const d=declaration;
  return Buffer.from(DOMAIN+'\n'+JSON.stringify([
    signerKeyId,d.reviewKind,d.workspaceId.toLowerCase(),d.gatewaySn,
    d.revision,d.fileSha256.toLowerCase(),d.evidenceSha256.toLowerCase(),
    d.reviewId.toLowerCase(),d.issuedAt,d.expiresAt
  ]),'utf8');
}

function inspectSignedFlightAreaReview({
  envelope,expectedWorkspaceId,expectedGatewaySn,expectedRevision,
  expectedFileSha256,approvedKeys,now=Date.now()
}={}){
  if(!UUID.test(expectedWorkspaceId)||!serial(expectedGatewaySn)||
     !positive(expectedRevision)||typeof expectedFileSha256!=='string'||
     !HASH.test(expectedFileSha256)||!(approvedKeys instanceof Map))
    return reject('untrusted_context');
  if(!epoch(now))return reject('invalid_clock');
  if(!exact(envelope,ENVELOPE_KEYS)||envelope.schema!==SCHEMA||
     (typeof envelope.signerKeyId!=='string'||!KEY_ID.test(envelope.signerKeyId))||
     (typeof envelope.signature!=='string'||!SIG.test(envelope.signature))||
     !validDeclaration(envelope.declaration))return reject('invalid_envelope');

  const d=envelope.declaration;
  if(d.workspaceId.toLowerCase()!==expectedWorkspaceId.toLowerCase()||
     d.gatewaySn!==expectedGatewaySn||d.revision!==expectedRevision||
     d.fileSha256.toLowerCase()!==expectedFileSha256.toLowerCase())
    return reject('target_mismatch');
  if(now<d.issuedAt-MAX_FUTURE_SKEW_MS)return reject('not_yet_valid');
  if(now>d.expiresAt)return reject('expired');

  // approvedKeys is trusted application configuration, never a JWK/public key
  // supplied inside the declaration or request payload.
  const key=approvedKeys.get(envelope.signerKeyId);
  if(!(key instanceof crypto.KeyObject)||key.type!=='public'||
     key.asymmetricKeyType!=='ed25519')return reject('unapproved_signer');
  const signature=Buffer.from(envelope.signature,'base64url');
  if(signature.length!==64||signature.toString('base64url')!==envelope.signature)
    return reject('invalid_signature');
  let verified=false;
  try{
    verified=crypto.verify(null,reviewSigningBytes(d,envelope.signerKeyId),
      key,signature);
  }catch(_err){return reject('invalid_signature');}
  if(!verified)return reject('invalid_signature');

  return {
    accepted:true,schema:SCHEMA,
    classification:'operator-signed-offline-review-only',
    operatorReviewSignatureVerified:true,
    targetMetadataBound:true,
    // SHA256 binds a referenced artifact to the reviewer declaration,
    // but the artifact was NOT fetched or authenticated by this module.
    evidenceArtifactInspected:false,
    independentDeviceReadbackVerified:false,
    revisionVerified:false,
    syncVerified:false,
    flightReady:false,
    hardwareVerified:false
  };
}

module.exports={
  inspectSignedFlightAreaReview,reviewSigningBytes,
  SCHEMA,REVIEW_KIND,MAX_LIFETIME_MS
};
