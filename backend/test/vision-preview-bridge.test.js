'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {Readable}=require('node:stream');
const {readPreview}=require('../../scripts/vision-preview-validate');

const SCRIPT=path.resolve(__dirname,'../../scripts/vision-preview-validate.js');
function report(){
  return {
    schema:'skyhub-vision-yolo11-preview-v1',status:'ok',
    source:'offline-explicit-local-rgb',image:{width:48,height:32},
    modelFormat:'onnx',
    detections:[{classId:0,className:'pv_crack',confidence:0.9,
      bboxXYXY:[1,2,20,22]}],detectionCount:1,
    defectVerified:false,geolocationVerified:false,
    multispectralReady:false,flightControlReady:false
  };
}
function run(input){
  const r=spawnSync(process.execPath,[SCRIPT],{
    input,encoding:'utf8',timeout:3000,maxBuffer:256*1024
  });
  assert.equal(r.signal,null);
  return {status:r.status,value:JSON.parse(r.stdout),stderr:r.stderr};
}
test('Python JSON preview traverses explicit offline gate without enrichment',()=>{
  const r=run(JSON.stringify(report()));
  assert.equal(r.status,0);
  assert.deepEqual(r.value,report());
  assert.equal(r.stderr,'');
});
test('reject secret injected into preview, unsafe readiness, malformed and huge input',()=>{
  for(const item of [
    {...report(),objectKey:'SECRET_WORKSPACE/PRIVATE.JPG'},
    {...report(),defectVerified:true},
    {...report(),image:{width:400000,height:32}},
    'PRIVATE_KEY_123',
    '',
    'a'.repeat(70000)
  ]){
    const input=typeof item==='string'?item:JSON.stringify(item);
    const r=run(input);
    assert.equal(r.status,2);
    assert.deepEqual(r.value,{schema:'skyhub-vision-yolo11-preview-v1',
      status:'unavailable'});
    assert.doesNotMatch(JSON.stringify(r),/SECRET_WORKSPACE|PRIVATE_KEY/);
  }
});
test('module entrypoint accepts stream but opens no sockets or S3 credentials',async()=>{
  const input=Readable.from([Buffer.from(JSON.stringify(report()))]);
  assert.deepEqual(await readPreview(input),report());
});
