'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateField,CURRENT_MS}=require('../../frontend/public/telemetry-freshness');

test('old battery never becomes fresh when a different OSD field updates',()=>{
  const d={fresh:true,lastTelemetryAt:21000,telemetry:{battery:70,windSpeed:2},
    telemetryFieldAt:{battery:1000,windSpeed:21000},
    telemetryFieldTimeVerified:{battery:true,windSpeed:true}};
  assert.equal(evaluateField(d,'battery',22000).kind,'stale');
  assert.equal(evaluateField(d,'windSpeed',22000).kind,'current');
});
test('15-second freshness threshold, future timestamps unknown',()=>{
  const d={telemetry:{battery:0},telemetryFieldAt:{battery:1000},
    telemetryFieldTimeVerified:{battery:true}};
  assert.equal(evaluateField(d,'battery',1000+CURRENT_MS-1).kind,'current');
  assert.equal(evaluateField(d,'battery',1000+CURRENT_MS).kind,'stale');
  assert.equal(evaluateField(d,'battery',999).kind,'unknown');
});
test('unverified source time cannot claim a verified current measurement',()=>{
  const d={telemetry:{rtkFixState:0},telemetryFieldAt:{rtkFixState:10000},
    telemetryFieldTimeVerified:{rtkFixState:false}};
  assert.equal(evaluateField(d,'rtkFixState',10001).kind,'unverified');
  assert.match(evaluateField(d,'rtkFixState',40000).text,/Zeit ungeprüft/);
});
test('missing values and legacy devices never pretend a live measurement',()=>{
  assert.equal(evaluateField({telemetry:{battery:null}},'battery',1000).kind,'missing');
  assert.equal(evaluateField({telemetry:{battery:44}},'battery',1000).kind,'unknown');
});
test('GPS 0/0 invalidates old GPS field freshness without impacting battery',()=>{
  const d={positionUnavailable:true,telemetry:{latitude:49.4,longitude:8.5,battery:90},
    telemetryFieldAt:{latitude:9900,longitude:9900,battery:10000},
    telemetryFieldTimeVerified:{latitude:true,longitude:true,battery:true}};
  assert.equal(evaluateField(d,'latitude',10000).kind,'unavailable');
  assert.equal(evaluateField(d,'longitude',10000).kind,'unavailable');
  assert.equal(evaluateField(d,'battery',10000).kind,'current');
});
test('aircraft disconnection prevents presenting last measurement as current',()=>{
  const d={aircraftConnected:false,telemetry:{battery:90},
    telemetryFieldAt:{battery:1000},telemetryFieldTimeVerified:{battery:true}};
  assert.equal(evaluateField(d,'battery',1001).kind,'stale');
});
