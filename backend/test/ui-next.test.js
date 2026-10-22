'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {checkInlineScripts}=require('../../scripts/check-dashboard-inline');

const NEXT=path.resolve(__dirname,'../../frontend/public/next');
const read=name=>fs.readFileSync(path.join(NEXT,name),'utf8');
const html=read('index.html');

test('the NEXT dashboard loads every script and stylesheet from SkyHub itself',()=>{
  const sources=[...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(sources.length>=7);
  for(const src of sources){
    assert.doesNotMatch(src,/^(https?:)?\/\//,src);
    if(src.startsWith('/'))assert.ok(['/socket.io/socket.io.js','/telemetry-freshness.js'].includes(src),src);
    else assert.ok(fs.existsSync(path.join(NEXT,src)),src);
  }
  assert.doesNotMatch(html,/unpkg|cdn\.|https?:\/\/(?!www\.w3\.org)/);
  // No inline scripts or inline event handlers (the CSP forbids them).
  assert.doesNotMatch(html,/<script(?![^>]*\ssrc=)[^>]*>/);
  assert.doesNotMatch(html,/\son[a-z]+=/i);
});

test('live data scripts load before the prototype script that uses them',()=>{
  const order=[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m=>m[1]);
  for(const [before,after] of [['live-model.js','live.js'],['live.js','app.js'],['/telemetry-freshness.js','live.js'],
    ['vendor/leaflet/leaflet.js','app.js'],['/socket.io/socket.io.js','live.js']])
    assert.ok(order.indexOf(before)<order.indexOf(after),before+' before '+after);
});

test('vendored Leaflet is byte-identical to the official 1.9.4 release (SRI)',()=>{
  const sri=file=>'sha256-'+crypto.createHash('sha256').update(fs.readFileSync(path.join(NEXT,'vendor/leaflet',file))).digest('base64');
  assert.equal(sri('leaflet.js'),'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=');
  assert.equal(sri('leaflet.css'),'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=');
  assert.match(read('vendor/leaflet/LICENSE'),/BSD 2-Clause/);
  for(const image of ['layers.png','layers-2x.png','marker-icon.png','marker-icon-2x.png','marker-shadow.png'])
    assert.ok(fs.existsSync(path.join(NEXT,'vendor/leaflet/images',image)),image);
});

test('backend data reaches the page only through textContent',()=>{
  for(const file of ['live.js','live-model.js']){
    const source=read(file);
    assert.doesNotMatch(source,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,file);
  }
  // The view token is never persisted or placed into a URL.
  const live=read('live.js');
  assert.doesNotMatch(live,/localStorage|sessionStorage|document\.cookie|\?token=|x-auth-token/i);
});

test('the prototype no longer pretends to have a demo fleet or a Python backend',()=>{
  const app=read('app.js');
  assert.doesNotMatch(app,/const fleet=\[/);
  assert.doesNotMatch(html,/DEMO · KEINE LIVE-VERBINDUNG|Python-REST-Dienst|RTK Fix verloren/);
  assert.match(html,/id="mission-export" disabled/);
  assert.match(html,/id="media-import" disabled/);
  assert.match(app,/async function remoteValidate\(payload\)\{return validatePayload\(payload\)\}/);
  // switchView('system') still calls checkBackend(): it must exist.
  assert.match(app,/function checkBackend\(\)\{\}/);
});

test('all NEXT scripts parse and the page has no inline scripts to check',()=>{
  const vm=require('node:vm');
  for(const file of ['app.js','live.js','live-model.js'])new vm.Script(read(file),{filename:file});
  assert.throws(()=>checkInlineScripts(html),/no inline scripts/);
});
