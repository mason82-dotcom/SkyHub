'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deviceCachePayload}=require('../device-cache');

test('Redis projection never persists per-field OSD clocks or verification flags',()=>{
  const live={sn:'TEST',telemetry:{battery:0,latitude:49.1},
    lastTelemetryAt:1000,lastPositionAt:800,
    telemetryFieldAt:{battery:1000,latitude:800},
    telemetryFieldTimeVerified:{battery:true,latitude:false}};
  const cached=deviceCachePayload(live);
  assert.equal(cached.sn,'TEST');
  assert.deepEqual(cached.telemetry,live.telemetry);
  assert.equal(cached.lastTelemetryAt,1000);
  assert.equal(cached.lastPositionAt,800);
  assert.equal(Object.hasOwn(cached,'telemetryFieldAt'),false);
  assert.equal(Object.hasOwn(cached,'telemetryFieldTimeVerified'),false);
  assert.doesNotMatch(JSON.stringify(cached),/telemetryFieldAt|telemetryFieldTimeVerified/);
  assert.deepEqual(Object.keys(live.telemetryFieldAt),['battery','latitude']);
});
test('cache projection does not mutate live API/WebSocket snapshots',()=>{
  const live={telemetryFieldAt:{windSpeed:300},
    telemetryFieldTimeVerified:{windSpeed:true}};
  const cached=deviceCachePayload(live);
  assert.notEqual(cached,live);
  assert.equal(live.telemetryFieldAt.windSpeed,300);
  assert.equal(cached.telemetryFieldAt,undefined);
});
