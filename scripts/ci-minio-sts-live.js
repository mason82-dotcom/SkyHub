'use strict';

// Runs ONLY inside scripts/ci-minio-sts-live.sh against a disposable MinIO container.
const {S3Client}=require('../backend/node_modules/@aws-sdk/client-s3');
const {createMinioStsIssuer}=require('../backend/minio-sts-issuer');
const {attestPutOnlySession}=require('../backend/minio-sts-attestation');

(async()=>{
  if(process.env.SKYHUB_STS_CI_ISOLATED!=='true')
    throw new Error('Isolated MinIO STS test not authorized');
  const url='https://127.0.0.1:19010';
  const workspace='e3dea0f5-37f2-4d79-ae58-490af3228069';
  const issue=createMinioStsIssuer({
    endpoint:url,region:'us-east-1',
    accessKeyId:'skyhub_sts_ci_upload',
    secretAccessKey:process.env.SKYHUB_STS_CI_UPLOAD_SECRET
  });
  const grant=await issue({
    workspace,principal:{role:'pilot',workspaceId:workspace},maxSeconds:900
  });
  const client=new S3Client({
    region:'us-east-1',endpoint:url,forcePathStyle:true,
    maxAttempts:1,
    credentials:{
      accessKeyId:grant.credentials.accessKeyId,
      secretAccessKey:grant.credentials.accessKeySecret,
      sessionToken:grant.credentials.securityToken
    }
  });
  try{
    const report=await attestPutOnlySession({
      s3:client,workspace,prefix:grant.objectKeyPrefix,confirmIsolated:true
    });
    if(report.passed!==true||report.checked.length!==5)
      throw new Error('Session permission attestation incomplete');
    process.stdout.write('PASS isolated MinIO STS: signed AssumeRole, own PutObject, four denied operations\n');
  }finally{client.destroy();}
})().catch(_err=>{
  // Never print MinIO transport errors, STS body, token or secrets.
  process.stderr.write('FAIL isolated MinIO STS attestation (see redacted result only)\n');
  process.exitCode=1;
});
