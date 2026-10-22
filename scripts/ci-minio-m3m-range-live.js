'use strict';
// Only invoked against the disposable TLS SILO/MinIO CI server.
// Source TIFF is synthetic. There is no production data or storage endpoint.
const {S3Client,PutObjectCommand,HeadObjectCommand}=require('../backend/node_modules/@aws-sdk/client-s3');
const {createVerifiedM3mXmpProbe}=require('../backend/m3m-verified-xmp-probe');
const {createPilotMediaHead}=require('../backend/pilot-media-head');
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const ID='33670000-0000-4000-8000-000000000001';
const PFX=WS+'/media/'+'a'.repeat(32);
const NAME='DJI_20261022150000_0001_MS_NIR.TIF';
const KEY=PFX+'/'+NAME;
const ENDPOINT='https://127.0.0.1:19010';
function syntheticTiff(){
  const xml=Buffer.from('<x:xmpmeta><rdf:RDF '+
    'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">'+
    '<rdf:Description drone-dji:BandName="NIR" '+
    'drone-dji:ImageSource="MS_NIR_CAMERA" '+
    'drone-dji:SensorGain="1.5" drone-dji:BlackCurrent="3200" '+
    'drone-dji:Irradiance="23.5" drone-dji:GpsStatus="RTK" '+
    'drone-dji:CaptureUUID="3377fb05b357448fb877023daebbaed3" '+
    'drone-dji:DroneSerialNumber="CI_PRIVATE_SERIAL_SENTINEL" />'+
    '</rdf:RDF></x:xmpmeta>');
  const start=2048,all=Buffer.alloc(start+xml.length+16);
  Buffer.from([73,73,42,0,8,0,0,0]).copy(all);
  const ifd=Buffer.alloc(18);
  ifd.writeUInt16LE(1,0);ifd.writeUInt16LE(700,2);
  ifd.writeUInt16LE(7,4);ifd.writeUInt32LE(xml.length,6);
  ifd.writeUInt32LE(start,10);ifd.copy(all,8);
  xml.copy(all,start);return all;
}
function client(user,password){
  return new S3Client({endpoint:ENDPOINT,region:'us-east-1',
    forcePathStyle:true,maxAttempts:1,
    credentials:{accessKeyId:user,secretAccessKey:password}});
}
(async()=>{
  if(process.env.CI!=='true'||process.env.SKYHUB_STS_CI_ISOLATED!=='true')
    throw Error('Isolated CI guard missing');
  const root=client('ci_sts_root','ci_sts_root_only_not_production_2026');
  const reader=client('skyhub_m3m_ci_reader',
    process.env.SKYHUB_M3M_CI_READ_SECRET);
  try{
    const data=syntheticTiff();
    await root.send(new PutObjectCommand({Bucket:'dji-cloud',Key:KEY,Body:data,
      ContentType:'image/tiff'}));
    const evidence=await reader.send(new HeadObjectCommand({Bucket:'dji-cloud',Key:KEY}));
    if(!evidence.ETag||!(evidence.LastModified instanceof Date)||
      evidence.ContentLength!==data.length)throw Error('Invalid isolated HEAD');
    const record={asset_id:ID,file_name:NAME,object_key:KEY,
      grant_prefix:PFX,size_bytes:data.length,
      etag:evidence.ETag,object_last_modified:evidence.LastModified};
    const db={async query(_sql,params){
      if(params[0]!==WS||params[1]!==ID)return {rows:[]};
      return {rows:[record]};
    }};
    const probe=createVerifiedM3mXmpProbe({
      db,s3:reader,headObject:createPilotMediaHead(reader)
    });
    const inspected=await probe.single({workspace:WS,id:ID});
    if(inspected.status!=='ok'||inspected.bandHint!=='NIR'||
      inspected.metrics.SensorGain!==1.5||inspected.metrics.BlackCurrent!==3200||
      inspected.metrics.Irradiance!==23.5||
      inspected.rtkHint!=='RTK'||inspected.ndviReady!==false||
      JSON.stringify(inspected).includes('CI_PRIVATE_SERIAL_SENTINEL'))
      throw Error('Live bounded XMP attestation failed');
    let denied=false;
    try{
      await reader.send(new PutObjectCommand({Bucket:'dji-cloud',
        Key:PFX+'/must-not-create.txt',Body:Buffer.from('deny')}));
    }catch(error){
      denied=error?.name==='AccessDenied'&&error?.$metadata?.httpStatusCode===403;
    }
    if(!denied)throw Error('Read identity unexpectedly permitted S3 writes');
    const changed=await probe.single({workspace:WS,id:ID});
    if(changed.status!=='ok')throw Error('Second S3 HEAD failed');
    process.stdout.write('PASS isolated M3M: real TLS S3 HEAD, 3 conditional Range GETs, safe XMP values and write denial\n');
  }finally{root.destroy();reader.destroy();}
})().catch(()=>{
  process.stderr.write('FAIL isolated M3M S3 range attestation (redacted)\n');
  process.exitCode=1;
});
