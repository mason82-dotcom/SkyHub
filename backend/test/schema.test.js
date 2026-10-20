'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ddl=fs.readFileSync(path.resolve(__dirname,'../db/schema.sql'),'utf8');
test('new data layout tracks device and optionally gateway independently',()=>{
  const table=ddl.split('CREATE TABLE IF NOT EXISTS drone_telemetry (')[1]?.split(');')[0];
  assert.ok(table);
  assert.match(table,/device_sn\s+VARCHAR\(\d+\) NOT NULL/);
  assert.match(table,/gateway_sn\s+VARCHAR\(\d+\)\s*,/);
  assert.match(table,/latitude\s+DOUBLE PRECISION NOT NULL/);
  assert.match(table,/longitude\s+DOUBLE PRECISION NOT NULL/);
});
