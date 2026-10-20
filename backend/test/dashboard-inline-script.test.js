'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkInlineScripts}=require('../../scripts/check-dashboard-inline');

test('dashboard inline JavaScript parses without executing the page',()=>{
  const filename=path.resolve(__dirname,'../../frontend/public/index.html');
  const html=fs.readFileSync(filename,'utf8');
  assert.equal(checkInlineScripts(html,{filename}),1);
});

test('inline checker ignores external scripts and rejects malformed JavaScript',()=>{
  const html='<script src="/app.js"></script><script>const = ;</script>';
  assert.throws(()=>checkInlineScripts(html),/inline script 1/);
});

test('inline checker rejects broken script markup',()=>{
  assert.throws(()=>checkInlineScripts('<script>let active=true;'),/unmatched script tag/);
});
