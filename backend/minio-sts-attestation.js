'use strict';

// Explicit, disposable-bucket S3 permission probe for a MinIO STS session.
// NEVER invoked by server.js, and must not run against real mission media.
const crypto=require('node:crypto');
const {PutObjectCommand,GetObjectCommand,DeleteObjectCommand,
  ListObjectsV2Command}=require('@aws-sdk/client-s3');
const {workspaceId}=require('./media-upload-contract');

const BUCKET='dji-cloud';
const HEX=/^[0-9a-f]{32}$/;

function checkPrefix(workspace,prefix){
  return workspaceId(workspace)&&typeof prefix==='string'&&
    prefix.startsWith(workspace+'/media/')&&
    HEX.test(prefix.slice((workspace+'/media/').length));
}
async function requireDenied(s3,command,name){
  try{
    await s3.send(command);
  }catch(err){
    // A generic HTTP 403 (e.g. ExpiredToken or InvalidAccessKeyId) is
    // NOT evidence that the IAM session policy prevented the operation.
    if(err && (err.name==='AccessDenied'||err.name==='Forbidden') &&
      err.$metadata?.httpStatusCode===403)return true;
    throw new Error('STS permission probe inconclusive: '+name);
  }
  throw new Error('STS permission over-granted: '+name);
}
async function attestPutOnlySession({s3,workspace,prefix,
  confirmIsolated=false,randomBytes=crypto.randomBytes}={}){
  if(confirmIsolated!==true||!s3||typeof s3.send!=='function'||
     !checkPrefix(workspace,prefix)||typeof randomBytes!=='function')
    throw new TypeError('Disposable STS attestation configuration required');
  const suffix=randomBytes(16);
  if(!Buffer.isBuffer(suffix)||suffix.length!==16)
    throw new TypeError('Invalid STS attestation nonce');
  const nonce=suffix.toString('hex');
  const own=prefix+'/skyhub-sts-attestation-'+nonce+'.txt';
  const foreignWorkspace=workspace==='00000000-0000-4000-8000-000000000001'?
    '00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000001';
  const other=foreignWorkspace+'/media/'+nonce+'/skyhub-sts-attestation-'+nonce+'.txt';

  // Successful PutObject is necessary, but not sufficient, for authorization.
  await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:own,
    Body:Buffer.from('skyhub disposable sts policy attestation\n'),
    ContentType:'text/plain'}));
  await requireDenied(s3,new GetObjectCommand({Bucket:BUCKET,Key:own}),'GetObject');
  await requireDenied(s3,new DeleteObjectCommand({Bucket:BUCKET,Key:own}),'DeleteObject');
  await requireDenied(s3,new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix+'/' }),'ListBucket');
  await requireDenied(s3,new PutObjectCommand({Bucket:BUCKET,Key:other,
    Body:Buffer.from('deny cross-workspace upload\n')}),'ForeignWorkspacePut');
  return Object.freeze({scope:'session-put-only',passed:true,
    checked:['PutObject','GetObject:denied','DeleteObject:denied',
      'ListBucket:denied','ForeignWorkspacePut:denied']});
}
module.exports={attestPutOnlySession,checkPrefix};
