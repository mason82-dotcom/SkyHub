'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../../frontend/public/next/verified-media-model.js');
const ROOT=path.resolve(__dirname,'../../frontend/public/next');
const read=x=>fs.readFileSync(path.join(ROOT,x),'utf8');
const WS='e3dea0f5-37f2-4d79-ae58-490af3228069';
const ID='33670000-0000-4000-8000-000000000001';
const copy=x=>JSON.parse(JSON.stringify(x));
function item(evidence='head-at-ingestion'){
  return {id:ID,fileName:'DJI_20261022150000_0001_MS_R.TIF',fileSizeBytes:3072,
    fileGroupId:'mission-1',mediaHint:'m3m-multispectral-filename',
    bandHint:'R',hintSource:'filename-only-unverified',
    verifiedAt:'2026-10-22T15:00:00.000Z',
    objectEvidence:{status:evidence,sizeBytes:3072,etag:'"not-visible"',
      lastModified:'2026-10-22T14:59:59.000Z'},
    pilotMetadata:{source:'pilot-upload-callback',fields:{
      shoot_position:{lat:49.12,lng:8.12},absolute_altitude:123}},
    storage:{bucket:'dji-cloud',objectKey:'PRIVATE_WORKSPACE/media/SECRET_NAME'},
    imageInspection:{exif:'not-extracted',xmp:'not-extracted',rtk:'not-extracted',
      captureUuidConfirmed:false,m3mSourceVerified:false,
      bandCoregistrationVerified:false,radiometricCalibrationVerified:false,
      reflectanceReady:false,ndviReady:false,ndreReady:false}
  };
}
const wrap=d=>({code:0,message:'success',data:d});
function list(values=[item()],cursor=null){
  return wrap({schema:'skyhub-pilot-media-library-v1',
    verification:'s3-head-at-ingestion-not-rechecked',
    items:values,nextCursor:cursor});
}
const group=()=>wrap({schema:'skyhub-m3m-library-hints-v1',classification:'filename-hints-only',
  examined:4,sessionPartitions:1,classified:4,unrecognized:0,invalid:0,
  captureGroups:1,spectralSets:1,fiveChannelSets:0,partialSets:0,duplicateSets:0,
  bandCounts:{RGB:0,G:1,R:1,RE:1,NIR:1},captureUuidVerified:false,
  exifVerified:false,xmpVerified:false,bandCoregistrationVerified:false,
  radiometricCalibrationVerified:false,reflectanceReady:false,
  ndviReady:false,ndreReady:false});
test('only registered library fields survive list normalization (never key, location, upload metadata)',()=>{
  const result=M.libraryList(list(),20);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].name,item().fileName);
  assert.equal(result.items[0].evidence,'head-at-ingestion');
  assert.equal(result.items[0].hintSource,'filename-only-unverified');
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/PRIVATE_WORKSPACE|SECRET_NAME|shoot_position|absolute_altitude|etag|latitude/);
});
test('details require a current HEAD and the same asset identifier',()=>{
  const good=M.detail(wrap({item:item('head-rechecked')}),ID);
  assert.equal(good.evidence,'head-rechecked');
  assert.throws(()=>M.detail(wrap({item:item('head-at-ingestion')}),ID));
  assert.throws(()=>M.detail(wrap({item:item('head-rechecked')}),'33670000-0000-4000-8000-000000000002'));
});
test('unknown readiness claims or sensor provenance fail closed',()=>{
  for(const [field,value] of [
    ['ndviReady',true],['ndreReady',true],['radiometricCalibrationVerified',true],
    ['m3mSourceVerified',true],['bandCoregistrationVerified',true],
    ['reflectanceReady',true],['captureUuidConfirmed',true]
  ]){
    const bad=item();bad.imageInspection[field]=value;
    assert.throws(()=>M.libraryList(list([bad])),field);
  }
  const bad=item();bad.objectEvidence.sizeBytes=1;
  assert.throws(()=>M.libraryList(list([bad])));
  const wrong=item();wrong.hintSource='verified-sensor';
  assert.throws(()=>M.libraryList(list([wrong])));
});
test('forged, malformed and oversized list responses are rejected',()=>{
  const cursor='a'.repeat(30)+'.'+'b'.repeat(43);
  assert.equal(M.libraryList(list(Array.from({length:20},(_,i)=>{
    const a=item();a.id='33670000-0000-4000-8000-'+String(i+1).padStart(12,'0');return a;
  }),cursor),20).nextCursor,cursor);
  assert.throws(()=>M.libraryList(list(),0));
  assert.throws(()=>M.libraryList(list([item(),item()]),20));
  assert.throws(()=>M.libraryList(list([item()],cursor),20));
  assert.throws(()=>M.libraryList(list([item()],'BAD_CURSOR')));
  assert.throws(()=>M.libraryList(wrap({schema:'unknown',items:[],nextCursor:null,verification:'bad'})));
  assert.throws(()=>M.libraryList({code:403,data:{}}));
  assert.throws(()=>M.libraryList(list(Array.from({length:21},()=>item())),20));
});
test('group payloads are aggregations, never calibrated analysis or capture UUIDs',()=>{
  const parsed=M.group(group());
  assert.deepEqual([parsed.examined,parsed.sessionPartitions,parsed.spectralSets,parsed.fiveChannelSets],[4,1,1,0]);
  assert.deepEqual(parsed.bands,{RGB:0,G:1,R:1,RE:1,NIR:1});
  assert.doesNotMatch(JSON.stringify(parsed),/captureUuid|calibrat|objectKey/);
  for(const [field,value] of [['ndviReady',true],['xmpVerified',true],['captureUuidVerified',true],['reflectanceReady',true],
    ['classification','calibrated'],['examined',6000]]){
    const bad=group();bad.data[field]=value;
    assert.throws(()=>M.group(bad),field);
  }
});
test('verified media viewer never sends writes, media downloads, or stores tokens',()=>{
  const js=read('verified-media.js');
  assert.doesNotMatch(js,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|console\.|createObjectURL/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/'X-Auth-Token':token/);
  assert.doesNotMatch(js,/method:\s*['"](PUT|POST|PATCH|DELETE)['"]/);
  assert.doesNotMatch(js,/\/api\/media\/objects/);
  for(const route of ['/assets','/groups/'])assert.ok(js.includes(route));
  const html=read('index.html');
  assert.match(html,/id="verified-workspace"/);
  assert.match(html,/id="verified-token" type="password" autocomplete="off"/);
  assert.match(html,/id="storage-inspector"/);
  assert.match(html,/BEISPIELMEDIEN/);
  assert.ok(html.indexOf('id="verified-library"')<html.indexOf('id="storage-inspector"'));
  for(const name of ['verified-media-model.js','verified-media.js']){
    assert.ok(html.indexOf(name)>0&&html.indexOf(name)<html.indexOf('src="app.js"'));
    new vm.Script(read(name),{filename:name});
  }
});
