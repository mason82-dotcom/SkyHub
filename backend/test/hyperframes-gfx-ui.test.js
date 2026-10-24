'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../frontend/public');
const pages=['index.html','smart-farming.html','wpml-editor.html','wpml-route-library.html','wpml-survey-preview.html'];

test('GFX stylesheet and controller are present on every intended product page',()=>{
  for(const page of pages){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    assert.match(html,/<body class="skyhub-gfx gfx-page-/);
    assert.match(html,/<link rel="stylesheet" href="\/hyperframes-gfx\.css">/);
    assert.match(html,/<script src="\/hyperframes-gfx\.js" defer><\/script>/);
    assert.match(html,/<button id="gfxMotionToggle"[^>]+aria-pressed="false"/);
    assert.equal((html.match(/id="gfxMotionToggle"/g)||[]).length,1);
  }
});

test('GFX is visual-only, motion is optional and Leaflet pointer events remain untouched',()=>{
  const css=fs.readFileSync(path.join(root,'hyperframes-gfx.css'),'utf8');
  const js=fs.readFileSync(path.join(root,'hyperframes-gfx.js'),'utf8');
  assert.match(css,/body\.skyhub-gfx/);
  assert.match(css,/prefers-reduced-motion: reduce/);
  assert.match(css,/forced-colors: active/);
  assert.match(css,/pointer-events: none/);
  assert.match(js,/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|WebSocket|io\()\b/);
  assert.doesNotMatch(css,/pointer-events:\s*auto/);
});

test('Dashboard critical controls and warnings remain in place',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const id of ['map','token','connect','tabOperations','tabTak','showTrack','deviceSearch','deviceFilter','mapNote','healthSummary','eventsList']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/Lesende Ansicht · keine Flugsteuerung/);
  assert.match(html,/TAK-Backend nicht integriert · Export AUS/);
});
