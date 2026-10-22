'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const publicDir=path.resolve(__dirname,'../../frontend/public');
const html=fs.readFileSync(path.join(publicDir,'command-center.html'),'utf8');
const script=fs.readFileSync(path.join(publicDir,'command-center.js'),'utf8');
const core=fs.readFileSync(path.join(publicDir,'command-center-core.js'),'utf8');
const index=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
test('command center scripts compile with no frontend build step',()=>{
  assert.doesNotThrow(()=>new vm.Script(script,{filename:'command-center.js'}));
  assert.doesNotThrow(()=>new vm.Script(core,{filename:'command-center-core.js'}));
});
test('command center is linked but opt-in; existing dashboard remains intact',()=>{
  assert.match(index,/href="\/command-center\.html"/);
  assert.match(html,/href="\/wpml-editor\.html"/);
  assert.match(html,/href="\/wpml-survey-preview\.html"/);
  assert.match(html,/href="\/"/);
});
test('read-only UI calls existing authenticated interfaces; never enables pilot upload or job dispatch',()=>{
  assert.match(script,/\/api\/devices/);
  assert.match(script,/\/api\/health/);
  assert.match(script,/\/api\/media\/buckets/);
  assert.match(script,/\/api\/media\/objects/);
  assert.match(script,/\/api\/media\/m3m\/inventory/);
  assert.doesNotMatch(script,/\.emit\s*\(/);
  assert.doesNotMatch(script,/method\s*:\s*['"]POST/);
  assert.doesNotMatch(script,/localStorage|sessionStorage/);
  assert.doesNotMatch(script,/innerHTML|document\.write/);
});
test('no synthetic flight claims or hardcoded MinIO credentials in new view',()=>{
  assert.doesNotMatch(html+script+core,/skyhub_super_secret|skyhub_minio_admin/);
  assert.doesNotMatch(script+core,/Math\.random|MOCK_TELEMETRY|mockInterval/);
  assert.match(html,/Keine simulierte Telemetrie/);
  assert.match(html,/Keine radiometrische Freigabe/);
});
test('all interactive controls used by controller exist in HTML',()=>{
  const ids=[...script.matchAll(/el\('([a-z][a-z-]*)'\)/g)].map(x=>x[1]);
  for(const id of ids)assert.match(html,new RegExp('id="'+id+'"'),'Missing HTML control '+id);
});
