'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deviceCachePayload}=require('../device-cache');

test('Redis device payload excludes per-field timestamps but keeps existing fields',()=>{
  const live={sn:'TEST',role:'subdevice',telemetry:{battery:0,latitude:49},
    lastTelemetryAt:1000,telemetryFieldAt:{battery:1000,latitude:800},
    telemetryFieldTimeVerified:{battery:true,latitude:false}};
  const cached=deviceCachePayload(live);
  assert.deepEqual(cached.telemetry,live.telemetry);
  assert.equal(cached.lastTelemetryAt,1000);
  assert.equal(cached.sn,'TEST');
  assert.equal(Object.hasOwn(cached,'telemetryFieldAt'),false);
  assert.equal(Object.hasOwn(cached,'telemetryFieldTimeVerified'),false);
  assert.deepEqual(Object.keys(live.telemetryFieldAt),['battery','latitude']);
  assert.doesNotMatch(JSON.stringify(cached),/telemetryFieldAt|telemetryFieldTimeVerified/);
});
test('cache projection does not modify the original live API/WebSocket object',()=>{
  const live={telemetryFieldAt:{battery:123},telemetryFieldTimeVerified:{battery:true}};
  const cached=deviceCachePayload(live);
  assert.notEqual(cached,live);
  assert.equal(live.telemetryFieldAt.battery,123);
  assert.equal(cached.telemetryFieldAt,undefined);
});
