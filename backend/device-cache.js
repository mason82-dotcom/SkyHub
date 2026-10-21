'use strict';
// Preserve the original redis:device snapshot contract while keeping
// per-field source/arrival clocks transient (Registry, HTTP, Socket.IO only).
function deviceCachePayload(device){
  const result={...device};
  delete result.telemetryFieldAt;
  delete result.telemetryFieldTimeVerified;
  return result;
}
module.exports={deviceCachePayload};
