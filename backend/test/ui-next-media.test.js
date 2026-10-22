'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const model=require('../../frontend/public/next/media-live-model.js');

const ROOT=path.resolve(__dirname,'../../frontend/public/next');
const source=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const sample=(extra={})=>({bucket:'dji-cloud',prefix:'missions/',objects:[
  {key:'missions/DJI_0001.TIF',size:1536,lastModified:'2026-10-22T10:00:00.000Z'}
],truncated:false,nextCursor:null,...extra});

test('bucket allowlist matches the existing SkyHub S3 reader',()=>{
  assert.deepEqual(model.ALLOWED_BUCKETS,['basemaps','dji-cloud','farming','mapping-results','pv-inspections']);
  assert.deepEqual(model.buckets({buckets:['dji-cloud','farming']}),['dji-cloud','farming']);
  for(const input of [{buckets:['dji-cloud','secret']},{buckets:['dji-cloud','dji-cloud']},
    {buckets:'dji-cloud'},null]){
    assert.throws(()=>model.buckets(input),/Invalid bucket response/);
  }
});

test('object contract displays S3 inventory only, never pretends to verify image metadata',()=>{
  const out=model.page(sample(),{bucket:'dji-cloud',prefix:'missions/',limit:50});
  assert.deepEqual(out,{items:[{name:'missions/DJI_0001.TIF',bytes:1536,
    modified:'2026-10-22T10:00:00.000Z'}],truncated:false,nextCursor:null});
  assert.equal(model.size(1536),'1,5 KiB');
  assert.equal(model.size(0),'0 B');
  assert.equal(model.date('unparseable'),'—');
  assert.deepEqual(Object.keys(out.items[0]),['name','bytes','modified']);
});

test('untrusted S3 names stay text data and control characters are sanitized',()=>{
  const result=model.page(sample({objects:[{key:'<img src=x onerror=alert(1)>\nfile',size:0}]}),
    {bucket:'dji-cloud',prefix:'missions/'});
  assert.equal(result.items[0].name,'<img src=x onerror=alert(1)>�file');
  const ui=source('media-live.js');
  assert.doesNotMatch(ui,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.match(ui,/\.textContent\s*=/);
  assert.match(ui,/\.replaceChildren\(/);
});

test('rejects malformed, oversized and ambiguous pages without partial success',()=>{
  const options={bucket:'dji-cloud',prefix:'missions/',limit:1};
  for(const body of [
    sample({bucket:'private'}),sample({prefix:'elsewhere'}),
    sample({objects:[{key:'x',size:-1}]}),
    sample({objects:[{key:'x',size:1},{key:'y',size:1}]}),
    sample({objects:[{key:'x',size:'99'}]}),
    sample({objects:[{key:'x',size:0}],truncated:true,nextCursor:null}),
    sample({objects:[{key:'x',size:0}],truncated:false,nextCursor:'unexpected'})
  ])assert.throws(()=>model.page(body,options));
  assert.throws(()=>model.page(sample(),{bucket:'private',prefix:'missions/'}));
  assert.throws(()=>model.page(sample(),{bucket:'dji-cloud',prefix:'a'.repeat(513)}));
});

test('pagination accepts only a new bounded opaque cursor',()=>{
  const body=sample({truncated:true,nextCursor:'next-page'});
  assert.equal(model.page(body,{bucket:'dji-cloud',prefix:'missions/',cursor:'prior'}).nextCursor,'next-page');
  assert.throws(()=>model.page(body,{bucket:'dji-cloud',prefix:'missions/',cursor:'next-page'}));
  assert.throws(()=>model.page(sample({truncated:true,nextCursor:'x'.repeat(4097)}),
    {bucket:'dji-cloud',prefix:'missions/'}));
});

test('UI uses only the media GET APIs, Bearer authorization, and no browser storage',()=>{
  const ui=source('media-live.js');
  const html=source('index.html');
  assert.match(ui,/fetch\(path,\{method:'GET'/);
  for(const path of ['status','buckets','objects'])assert.match(ui,new RegExp("get\\('"+path+"'"));
  assert.doesNotMatch(ui,/method:\s*['"](PUT|POST|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(ui,/localStorage|sessionStorage|document\.cookie|window\.location\s*=|console\./);
  assert.doesNotMatch(ui,/URL\.createObjectURL|download\s*=/);
  assert.match(ui,/Authorization:'Bearer '\+token/);
  assert.match(html,/id="storage-inspector"/);
  assert.match(html,/id="storage-token" type="password" autocomplete="off"/);
  assert.match(html,/id="storage-next" type="button" disabled hidden/);
  assert.match(html,/BEISPIELMEDIEN/);
});

test('media scripts and styles are self-hosted and loaded before dashboard',()=>{
  const html=source('index.html');
  assert.match(html,/href="media-live.css"/);
  const first=html.indexOf('media-live-model.js'),second=html.indexOf('media-live.js'),app=html.indexOf('src="app.js"');
  assert.ok(first>0&&first<second&&second<app);
  for(const file of ['media-live.js','media-live-model.js']){
    new (require('node:vm').Script)(source(file),{filename:file});
  }
});
