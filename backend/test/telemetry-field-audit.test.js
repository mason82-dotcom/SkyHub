'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('privacy-safe telemetry audit help does not contact Docker',()=>{
  const cli=path.resolve(__dirname,'../../scripts/pi-telemetry-fields-check.js');
  const out=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/Nur empfangene Feldnamen/);
  assert.doesNotMatch(out.stdout,/latitude.*[0-9]/);
});
