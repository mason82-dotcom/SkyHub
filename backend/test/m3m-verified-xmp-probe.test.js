'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createVerifiedM3mXmpProbe,createRangedGet,MAX_READ,MAX_ITEMS}=
  require('../m3m-verified-xmp-probe');
const {extractSafeDjiMetadata}=require('../m3m-xmp-safe-values');

const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const OTHER='203cc94c-aef1-4e0e-a520-05a24be33a31';
const PFX=WS+'/media/'+'a'.repeat(32);
const ID='33670000-0000-4000-8000-000000000001';
const CAP='3377fb05b357448fb877023daebbaed3';
const DATE=new Date('2026-10-22T15:00:00Z');
const NS='http://www.dji.com/drone-dji/1.0/';
const BANDS={G:'Green',R:'Red',RE:'RedEdge',NIR:'NIR'};
const bandNum=['G','R','RE','NIR'];

function xmp(band,{ambiguous=false}={}){
  const extra=ambiguous?' drone-dji:BandName="Red"':'';
  return Buffer.from('<x:xmpmeta><rdf:RDF xmlns:drone-dji="'+NS+'">'+
    '<rdf:Description drone-dji:ImageSource="MS_'+band+'_CAMERA" '+
    'drone-dji:BandName="'+BANDS[band]+'"'+extra+' '+
    'drone-dji:SensorIndex="'+(bandNum.indexOf(band)+1)+'" '+
    'drone-dji:SensorGain="1.125" drone-dji:SensorGainAdjustment="0.99" '+
    'drone-dji:BlackCurrent="3200" drone-dji:Irradiance="125.3" '+
    'drone-dji:IrradianceExposureTime="0.0003" '+
    'drone-dji:CentralWavelength="860" '+
    'drone-dji:GpsStatus="RTK" '+
    'drone-dji:CaptureUUID="'+CAP+'" '+
    'drone-dji:DroneSerialNumber="PRIVATE_DRONE_SERIAL_12345" '+
    'drone-dji:GpsLatitude="PRIVATE_GPS_49" '+
    'drone-dji:BlackLevelSecret="PRIVATE_BLACK_LEVEL" />'+
    '</rdf:RDF></x:xmpmeta>');
}
function tiff(packet){
  const offset=2048,bytes=Buffer.alloc(offset+packet.length+32);
  Buffer.from([73,73,42,0,8,0,0,0]).copy(bytes,0);
  const ifd=Buffer.alloc(2+12+4);
  ifd.writeUInt16LE(1,0);
  ifd.writeUInt16LE(700,2);
  ifd.writeUInt16LE(7,4);
  ifd.writeUInt32LE(packet.length,6);
  ifd.writeUInt32LE(offset,10);
  ifd.copy(bytes,8);
  packet.copy(bytes,offset);
  return bytes;
}
function record(band,number){
  const name='DJI_20261022150000_0001_MS_'+band+'.TIF';
  return {asset_id:number===undefined?ID:'33670000-0000-4000-8000-'+String(number).padStart(12,'0'),
    object_key:PFX+'/'+name,grant_prefix:PFX,file_name:name,
    size_bytes:0,etag:'"ETAG_TEST"',object_last_modified:DATE,
    file_group_id:'m3m-mission'};
}
function dataset(bands=['NIR']){
  const rows=bands.map((b,i)=>{
    const obj=tiff(xmp(b));
    return {row:{...record(b,i+1),size_bytes:obj.length},data:obj};
  });
  const seen=[];
  return {rows,seen,db:{async query(sql,args){
    seen.push({sql,args});
    if(sql.includes('asset_id=$2::uuid'))return {
      rows:rows.filter(x=>x.row.asset_id===args[1]&&args[0]===WS).map(x=>x.row)
    };
    if(sql.includes('file_group_id=$2'))return {
      rows:args[0]===WS?rows.filter(x=>x.row.file_group_id===args[1]).map(x=>x.row):[]
    };
    throw Error('Unexpected SQL');
  }}};
}
function transport(data,{status=206,rangeStatus=true,changedEtag=false,
  countOffset=0,incorrectTotal=false}={}){
  const calls=[];
  const client={async send(cmd){
    const {Bucket,Key,Range,IfMatch}=cmd.input;
    calls.push(cmd.input);
    assert.equal(Bucket,'dji-cloud');
    assert.match(Key,/^e3dea0f5-.+\/media\//);
    assert.equal(IfMatch,'"ETAG_TEST"');
    const image=data.find(x=>x.row.object_key===Key);
    assert.ok(image);
    const [,lo,hi]=/^bytes=(\d+)-(\d+)$/.exec(Range);
    const start=Number(lo),end=Number(hi),payload=image.data.subarray(start,end+1);
    return {$metadata:{httpStatusCode:status},ContentRange:rangeStatus?
      'bytes '+(start+countOffset)+'-'+end+'/'+
        (image.data.length+(incorrectTotal?1:0)):undefined,
      ContentLength:payload.length,ETag:changedEtag?'"REPLACED"':'"ETAG_TEST"',
      Body:Readable.from([payload])};
  }};
  return {client,calls};
}
function create(rows,transportOptions={},head=null){
  const {client,calls}=transport(rows,transportOptions);
  const db={async query(sql,args){
    if(sql.includes('asset_id=$2::uuid'))return {rows:args[0]===WS?
      rows.filter(x=>x.row.asset_id===args[1]).map(x=>x.row):[]};
    if(sql.includes('file_group_id=$2'))return {rows:args[0]===WS?
      rows.filter(x=>x.row.file_group_id===args[1]).map(x=>x.row):[]};
    throw Error('Unexpected SQL');
  }};
  const verify=head|| (async()=>({size:rows[0].data.length,etag:'"ETAG_TEST"',lastModified:DATE}));
  return {probe:createVerifiedM3mXmpProbe({db,s3:client,headObject:verify}),calls};
}

test('XMP numeric allowlist and RTK hint retain values but no private fields',()=>{
  const result=extractSafeDjiMetadata(xmp('NIR'));
  assert.equal(result.status,'ok');
  assert.equal(result.bandHint,'NIR');
  assert.equal(result.rtkHint,'RTK');
  assert.equal(result.rtkStatusSource,'unverified-dji-xmp');
  assert.equal(result.metrics.SensorGain,1.125);
  assert.equal(result.metrics.SensorGainAdjustment,0.99);
  assert.equal(result.metrics.BlackCurrent,3200);
  assert.equal(result.metrics.Irradiance,125.3);
  assert.equal(result.metrics.IrradianceExposureTime,0.0003);
  assert.equal(result.metrics.CentralWavelength,860);
  assert.equal(result.metrics.SensorIndex,4);
  assert.equal(result.captureUuidPresent,true);
  assert.equal(result.ndviReady,false);
  assert.equal(result.radiometricCalibrationVerified,false);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|3377fb05|GpsLatitude|DroneSerial|BlackLevelSecret/);
});

test('ambiguous, duplicated or malformed numeric values do not become calibration fields',()=>{
  const dup=xmp('NIR').toString('utf8').replace('drone-dji:SensorGain="1.125"',
    'drone-dji:SensorGain="1.125" drone-dji:SensorGain="2.125"');
  const malformed=xmp('NIR').toString('utf8').replace('drone-dji:Irradiance="125.3"',
    'drone-dji:Irradiance="1e999"');
  assert.equal(extractSafeDjiMetadata(Buffer.from(dup)).metrics.SensorGain,undefined);
  assert.equal(extractSafeDjiMetadata(Buffer.from(malformed)).metrics.Irradiance,undefined);
  assert.equal(extractSafeDjiMetadata(xmp('R',{ambiguous:true})).bandHint,'unknown');
  assert.equal(extractSafeDjiMetadata(Buffer.from('SECRET')).status,'unavailable');
});

test('verified single asset requests exactly 3 conditional bounded byte ranges',async()=>{
  const d=dataset(),{probe,calls}=create(d.rows);
  const got=await probe.single({workspace:WS,id:d.rows[0].row.asset_id});
  assert.equal(got.status,'ok');
  assert.equal(got.bandHint,'NIR');
  assert.equal(got.metrics.SensorGain,1.125);
  assert.equal(got.rtkHint,'RTK');
  assert.equal(got.source,'bounded-tiff-xmp-metadata');
  assert.equal(got.ndviReady,false);
  assert.equal(calls.length,3);
  assert.equal(calls[0].Range,'bytes=0-15');
  assert.equal(calls[1].Range,'bytes=8-1031');
  assert.equal(calls[2].Range,'bytes=2048-'+(2048+xmp('NIR').length-1));
  assert.ok(calls.every(x=>x.IfMatch==='"ETAG_TEST"'));
  assert.ok(calls.reduce((sum,x)=>{
    const m=/^bytes=(\d+)-(\d+)$/.exec(x.Range);
    return sum+Number(m[2])-Number(m[1])+1;
  },0)<=MAX_READ);
  assert.doesNotMatch(JSON.stringify(got),/PRIVATE|3377fb05|\/media\/|DJI_/);
});

test('stale HEAD and cross-workspace requests never read raw XMP from storage',async()=>{
  const d=dataset(),stale=create(d.rows,{},async()=>({
    size:d.rows[0].data.length,etag:'"DIFFERENT"',lastModified:DATE
  }));
  assert.deepEqual(await stale.probe.single({workspace:WS,id:d.rows[0].row.asset_id}),
    {status:'stale-object',reflectanceReady:false,ndviReady:false,ndreReady:false});
  assert.equal(stale.calls.length,0);
  const normal=create(d.rows);
  assert.deepEqual(await normal.probe.single({workspace:OTHER,id:d.rows[0].row.asset_id}),
    {status:'not-found'});
  assert.equal(normal.calls.length,0);
});

test('ignored Range, changed ETag, bad ContentRange and 200 full response fail closed',async()=>{
  const d=dataset();
  for(const option of [{status:200},{rangeStatus:false},{changedEtag:true},
    {countOffset:1},{incorrectTotal:true}]){
    const {probe,calls}=create(d.rows,option);
    const reply=await probe.single({workspace:WS,id:d.rows[0].row.asset_id});
    assert.equal(reply.status,'rangeNotHonored');
    assert.equal(calls.length,1);
    assert.equal(reply.ndviReady,false);
  }
});

test('four-band UUID equality is summarized without exposing CaptureUUIDs or key paths',async()=>{
  const d=dataset(['G','R','RE','NIR']);
  const {probe,calls}=create(d.rows,{},async({key})=>{
    const item=d.rows.find(x=>x.row.object_key===key);
    return {size:item.data.length,etag:item.row.etag,lastModified:DATE};
  });
  const output=await probe.group({workspace:WS,groupId:'m3m-mission'});
  assert.equal(output.status,'ok');
  assert.equal(output.report.examined,4);
  assert.equal(output.report.withCaptureUuid,4);
  assert.equal(output.report.uniqueCaptureUuidGroups,1);
  assert.equal(output.report.fullFourBandHintGroups,1);
  assert.equal(output.report.redNirCandidateGroups,1);
  assert.equal(output.report.reflectanceReady,false);
  assert.equal(calls.length,12);
  assert.doesNotMatch(JSON.stringify(output),/3377fb05|PRIVATE|DJI_|\/media\//);
});

test('all group reads bounded, cross workspace unavailable and more than 12 denied',async()=>{
  const d=dataset(['R','NIR']);
  const {probe,calls}=create(d.rows);
  assert.deepEqual(await probe.group({workspace:OTHER,groupId:'m3m-mission'}),
    {status:'not-found'});
  assert.equal(calls.length,0);
  await assert.rejects(()=>probe.group({workspace:WS,groupId:'../../other'}));
  const extra=Array(MAX_ITEMS+1).fill(d.rows[0]);
  const {probe:oversize,calls:overcalls}=create(extra);
  assert.deepEqual(await oversize.group({workspace:WS,groupId:'m3m-mission'}),
    {status:'limit-exceeded'});
  assert.equal(overcalls.length,0);
});

test('no S3 full GET or access credentials, no mutation and no private fields in source',()=>{
  const content=require('node:fs').readFileSync(
    require('node:path').resolve(__dirname,'../m3m-verified-xmp-probe.js'),'utf8');
  assert.match(content,/GetObjectCommand/);
  assert.match(content,/IfMatch:etag/);
  assert.match(content,/ContentRange/);
  assert.doesNotMatch(content,/PutObjectCommand|DeleteObjectCommand|ListObjectsV2Command/);
  assert.doesNotMatch(content,/process\.env|console\.(log|error)|CaptureUUID=\+|secretAccessKey/);
});
