'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseVisionPreviewReport,InvalidVisionReport,MAX_DETECTIONS}=
  require('../vision-preview-contract');

function report(){
  return {
    schema:'skyhub-vision-yolo11-preview-v1',
    status:'ok',
    source:'offline-explicit-local-rgb',
    image:{width:1920,height:1080},
    modelFormat:'onnx',
    detections:[{classId:0,className:'pv_crack',confidence:0.9,
      bboxXYXY:[10,15,800,900]}],
    detectionCount:1,
    defectVerified:false,
    geolocationVerified:false,
    multispectralReady:false,
    flightControlReady:false
  };
}
function rejects(r){
  assert.throws(()=>parseVisionPreviewReport(r),InvalidVisionReport);
}

test('validated YOLO11 preview has immutable safe structure, never implied readiness',()=>{
  const input=report();
  const got=parseVisionPreviewReport(input);
  assert.deepEqual(got,input);
  assert.equal(Object.isFrozen(got),true);
  assert.equal(Object.isFrozen(got.detections[0].bboxXYXY),true);
  assert.equal(got.defectVerified,false);
  assert.equal(got.flightControlReady,false);
  assert.equal(got.multispectralReady,false);
});
test('fail closed on fabricated verification or status, sensitive strings and unknown keys',()=>{
  const invalid=[
    {defectVerified:true},
    {flightControlReady:true},
    {geolocationVerified:true},
    {multispectralReady:true},
    {schema:'skyhub-vision-yolo12-preview-v1'},
    {source:'dji-live-inference'},
    {status:'unavailable'},
    {path:'PRIVATE_MEDIA_OBJECT'},
    {GPS:'49.11'},
    {modelFormat:'unknown'},
    {detectionCount:8}
  ];
  for(const overrides of invalid)rejects({...report(),...overrides});
  rejects({...report(),image:{width:1920,height:1080,latitude:49.11}});
});
test('reject malformed detection labels, scores, coords, class IDs and extras',()=>{
  const bad=[
    {classId:0.1},
    {classId:-1},
    {className:'gps=49.11 PRIVATE'},
    {className:'a'.repeat(65)},
    {confidence:Infinity},
    {confidence:-1},
    {confidence:NaN},
    {bboxXYXY:[0,0,2000,40]},
    {bboxXYXY:[10,10,10,100]},
    {bboxXYXY:[10,30,30,20]},
    {bboxXYXY:[1,2,3,4,5]},
    {bboxXYXY:[0,0,'2',3]},
    {privatePath:'/mnt/data/band.tif'}
  ];
  for(const delta of bad){
    const r=report();
    r.detections[0]={...r.detections[0],...delta};
    rejects(r);
  }
  const over=report();
  over.detections=Array.from({length:MAX_DETECTIONS+1},()=>report().detections[0]);
  over.detectionCount=over.detections.length;
  rejects(over);
});
test('reject oversized images, messages and forged object prototypes',()=>{
  rejects({...report(),image:{width:6000,height:6000}});
  rejects({...report(),image:{width:0,height:12}});
  const r=report();
  r.detections[0].className='a'.repeat(70000);
  rejects(r);
  rejects(Object.assign(Object.create(null),report()));
  assert.throws(()=>parseVisionPreviewReport(null),InvalidVisionReport);
});
test('vision contract deliberately has no HTTP, S3, MQTT or write operations',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../vision-preview-contract.js'),'utf8');
  assert.doesNotMatch(src,/require\(['"](?:express|mqtt|ioredis|pg|@aws-sdk)/);
  assert.doesNotMatch(src,/\b(PutObjectCommand|DeleteObjectCommand|publish|listen)\s*\(/);
  assert.doesNotMatch(src,/process\.env|console\.log|JSON\.parse/);
});
