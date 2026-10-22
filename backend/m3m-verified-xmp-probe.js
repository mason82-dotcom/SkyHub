'use strict';

// Opt-in, read-only bounded XMP probe for PostgreSQL HEAD-verified M3M media.
// NO production route/worker, writes, object downloads, persistent UUID
// storage or opaque source metadata leaving the process.
const {GetObjectCommand}=require('@aws-sdk/client-s3');
const {workspaceId}=require('./media-upload-contract');
const {identify}=require('./m3m-media-inventory');
const {firstIfdOffset}=require('./m3m-tiff-ifd');
const {locateXmpFromIfd}=require('./m3m-xmp-markers');
const {captureUuidFromXmp,summarizeCaptureGroups}=require('./m3m-xmp-capture-groups');
const {extractSafeDjiMetadata}=require('./m3m-xmp-safe-values');
const {headEvidence}=require('./pilot-media-store');

const BUCKET='dji-cloud',MAX_READ=33808,MAX_ITEMS=12;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GROUP=/^[A-Za-z0-9_.:-]{1,128}$/;
const STATUS=new Set(['ok','xmpTagMissing','xmpTooLarge','invalidXmpPointer',
  'notClassicTiff','unavailable','rangeNotHonored','xmpNotRecognized']);
function stale(){return {status:'stale-object'};}
function invalid(){return {status:'unavailable'};}
function checkedRow(row,workspace){
  if(!row||typeof row!=='object'||!UUID.test(row.asset_id)||
    typeof row.object_key!=='string'||typeof row.grant_prefix!=='string'||
    !row.grant_prefix.startsWith(workspace+'/media/')||
    !row.object_key.startsWith(row.grant_prefix+'/')||
    row.object_key.length>1024||typeof row.file_name!=='string'||
    row.object_key.split('/').at(-1)!==row.file_name||
    !/\.tiff?$/i.test(row.file_name)||
    !Number.isSafeInteger(Number(row.size_bytes))||Number(row.size_bytes)<32||
    typeof row.etag!=='string'||row.etag.length<1||row.etag.length>256)
    return false;
  const hint=identify(row.file_name);
  return hint!==null&&hint.band!=='RGB';
}
function sameEvidence(row,value){
  const h=headEvidence(value);
  const originalDate=row.object_last_modified instanceof Date?
    row.object_last_modified.getTime():Date.parse(row.object_last_modified);
  return !!h&&h.size===Number(row.size_bytes)&&h.etag===row.etag&&
    Number.isFinite(originalDate)&&h.lastModified===originalDate;
}
class UnsafeRange extends Error{}
function createRangedGet(s3){
  if(!s3||typeof s3.send!=='function')throw new TypeError('Read-only S3 client required');
  return async function read({key,etag,size,start,length}){
    if(typeof key!=='string'||key.length>1024||
      typeof etag!=='string'||!etag||etag.length>256||
      !Number.isSafeInteger(size)||size<32||
      !Number.isSafeInteger(start)||start<0||
      !Number.isSafeInteger(length)||length<1||length>32768||
      start+length>size)throw new UnsafeRange();
    const end=start+length-1;
    let response;
    try{
      response=await s3.send(new GetObjectCommand({
        Bucket:BUCKET,Key:key,Range:'bytes='+start+'-'+end,IfMatch:etag
      }),{abortSignal:AbortSignal.timeout(9000)});
      const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response?.ContentRange??'');
      if(response?.$metadata?.httpStatusCode!==206||!match||
        Number(match[1])!==start||Number(match[2])!==end||
        Number(match[3])!==size||response.ETag!==etag||
        response.ContentLength!==length||
        !response.Body||typeof response.Body[Symbol.asyncIterator]!=='function')
        throw new UnsafeRange();
      const chunks=[];let count=0;
      for await (const chunk of response.Body){
        if(!Buffer.isBuffer(chunk))throw new UnsafeRange();
        count+=chunk.length;
        if(count>length)throw new UnsafeRange();
        chunks.push(chunk);
      }
      if(count!==length)throw new UnsafeRange();
      return Buffer.concat(chunks,length);
    }finally{response?.Body?.destroy?.();}
  };
}
function createVerifiedM3mXmpProbe({db,s3,headObject}={}){
  if(!db||typeof db.query!=='function'||typeof headObject!=='function')
    throw new TypeError('Verified media database and HEAD verifier required');
  const read=createRangedGet(s3);
  async function inspect(row,workspace){
    if(!checkedRow(row,workspace))return {status:'unsupported'};
    const key=row.object_key,etag=row.etag,size=Number(row.size_bytes);
    try{
      if(!sameEvidence(row,await headObject({bucket:BUCKET,key})))return stale();
      const header=await read({key,etag,size,start:0,length:16});
      const offset=firstIfdOffset(header);
      if(offset===null||offset>=size)return {status:'notClassicTiff'};
      const ifd=await read({key,etag,size,start:offset,
        length:Math.min(1024,size-offset)});
      const ref=locateXmpFromIfd(header,ifd,size);
      if(ref.status!=='ok')return {status:ref.status};
      const xml=await read({key,etag,size,start:ref.offset,length:ref.length});
      const result=extractSafeDjiMetadata(xml);
      const expected=identify(row.file_name).band;
      // Contradictory named and actual XMP band is not a valid M3M mapping.
      if(result.status==='ok' && result.bandHint!==expected)
        return {status:'band-inconsistent'};
      return {
        ...result,
        // PRIVATE: in-memory handoff only, never serialize with the returned
        // public projection. The outer methods explicitly pick safe fields.
        _captureUuid:result.status==='ok'?captureUuidFromXmp(xml):null
      };
    }catch(err){
      if(err instanceof UnsafeRange)return {status:'rangeNotHonored'};
      return invalid();
    }
  }
  function publicProjection(record){
    const {status}=record;
    if(status!=='ok'){
      return {
        status:STATUS.has(status)?status:status==='band-inconsistent'?'band-inconsistent':
          status==='stale-object'?'stale-object':'unsupported',
        reflectanceReady:false,ndviReady:false,ndreReady:false
      };
    }
    const out={status:'ok',source:record.source,bandHint:record.bandHint,
      rtkHint:record.rtkHint,rtkStatusSource:record.rtkStatusSource,
      metrics:record.metrics,captureUuidPresent:record.captureUuidPresent,
      radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
      reflectanceReady:false,ndviReady:false,ndreReady:false};
    return out;
  }
  async function single({workspace,id}={}){
    if(!workspaceId(workspace)||!UUID.test(id))
      throw new TypeError('Invalid verified M3M probe scope');
    const {rows}=await db.query(
      'SELECT asset_id,object_key,grant_prefix,file_name,size_bytes,etag,object_last_modified '+
      'FROM dji_pilot_media_verified WHERE workspace_id=$1 AND asset_id=$2::uuid LIMIT 1',
      [workspace,id]);
    if(rows.length===0)return {status:'not-found'};
    if(rows.length!==1)throw new Error('Inconsistent verified media');
    return publicProjection(await inspect(rows[0],workspace));
  }
  async function group({workspace,groupId}={}){
    if(!workspaceId(workspace)||typeof groupId!=='string'||!GROUP.test(groupId))
      throw new TypeError('Invalid M3M group scope');
    const {rows}=await db.query(
      'SELECT asset_id,object_key,grant_prefix,file_name,size_bytes,etag,object_last_modified '+
      'FROM dji_pilot_media_verified '+
      'WHERE workspace_id=$1 AND file_group_id=$2 ORDER BY asset_id LIMIT $3',
      [workspace,groupId,MAX_ITEMS+1]);
    if(rows.length===0)return {status:'not-found'};
    if(rows.length>MAX_ITEMS)return {status:'limit-exceeded'};
    const records=[];
    const counts={ok:0,unsupported:0,unavailable:0,stale:0,bandInconsistent:0};
    for(const row of rows){
      const record=await inspect(row,workspace);
      if(record.status==='ok'){
        counts.ok++;
        records.push({status:'ok',bandHint:record.bandHint,
          captureUuid:record._captureUuid});
      }else{
        const klass=record.status==='stale-object'?'stale':
          record.status==='band-inconsistent'?'bandInconsistent':
          record.status==='unsupported'?'unsupported':'unavailable';
        counts[klass]++;
        records.push({status:'unavailable',bandHint:'unknown',captureUuid:null});
      }
    }
    const report=summarizeCaptureGroups(records);
    // Only aggregate fixed counters; never copy capture UUIDs, names, or keys.
    return {status:'ok',report:{...report,
      schema:'skyhub-verified-m3m-xmp-capture-hints-v1',
      examined:rows.length,readStatus:counts,
      maxS3GetsPerObject:3,maxRequestedBytesPerObject:MAX_READ,
      m3mSourceVerified:false,imagePayloadVerified:false,
      radiometricCalibrationVerified:false,bandCoregistrationVerified:false,
      reflectanceReady:false,ndviReady:false,ndreReady:false}};
  }
  return Object.freeze({single,group});
}
module.exports={createVerifiedM3mXmpProbe,createRangedGet,MAX_READ,MAX_ITEMS};
