'use strict';
// Device cache is allowed to retain the existing snapshot data for 1 hour,
// but never the per-field time provenance maps from the live DJI registry.
function deviceCachePayload(item) {
  const cached={...item};
  delete cached.telemetryFieldAt;
  delete cached.telemetryFieldTimeVerified;
  return cached;
}
module.exports={deviceCachePayload};
