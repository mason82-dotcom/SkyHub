'use strict';

const {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command
}=require('@aws-sdk/client-s3');

const BUCKETS=Object.freeze([
  'basemaps',
  'dji-cloud',
  'farming',
  'mapping-results',
  'pv-inspections'
]);

function createS3Storage(env=process.env,client){
  const endpoint=env.SKYHUB_S3_ENDPOINT;
  const accessKeyId=env.SKYHUB_S3_ACCESS_KEY;
  const secretAccessKey=env.SKYHUB_S3_SECRET_KEY;

  if(!client && (!endpoint || !accessKeyId || !secretAccessKey)){
    throw new Error('S3 configuration incomplete');
  }

  const s3=client || new S3Client({
    endpoint,
    region:'us-east-1',
    forcePathStyle:true,
    credentials:{accessKeyId,secretAccessKey},
    maxAttempts:2
  });

  async function buckets(){
    const available=[];
    for(const name of BUCKETS){
      try{
        await s3.send(new HeadBucketCommand({Bucket:name}));
        available.push(name);
      }catch(err){
        if(err.$metadata?.httpStatusCode===404 ||
           err.name==='NotFound' ||
           err.name==='NoSuchBucket'){
          continue;
        }
        throw err;
      }
    }
    return available;
  }

  async function objects(bucket,{prefix='',limit=100,cursor}={}){
    if(!BUCKETS.includes(bucket)){
      const err=new Error('Invalid bucket');
      err.status=400;
      throw err;
    }
    if(typeof prefix!=='string' || prefix.length>512 ||
       !Number.isInteger(limit) || limit<1 || limit>200 ||
       (cursor!==undefined &&
        (typeof cursor!=='string' || cursor.length>4096))){
      const err=new Error('Invalid query');
      err.status=400;
      throw err;
    }

    const result=await s3.send(new ListObjectsV2Command({
      Bucket:bucket,
      Prefix:prefix,
      MaxKeys:limit,
      ...(cursor?{ContinuationToken:cursor}:{})
    }));

    return {
      bucket,
      prefix,
      objects:(result.Contents||[]).map(item=>({
        key:item.Key,
        size:item.Size,
        lastModified:item.LastModified?.toISOString?.()||null,
        etag:item.ETag||null
      })),
      truncated:Boolean(result.IsTruncated),
      nextCursor:result.NextContinuationToken||null
    };
  }

  return {buckets,objects};
}

module.exports={createS3Storage,BUCKETS};
