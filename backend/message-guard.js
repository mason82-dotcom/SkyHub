'use strict';

// Read-only DJI MQTT intake policy. DJI Cloud API timestamps are epoch milliseconds.
// Receive-time freshness alone must not turn a delayed packet into fresh telemetry.
// Allow a longer window for event/state/topology channels than for periodic OSD.
const MAX_OSD_AGE_MS = 120000;
const MAX_OTHER_AGE_MS = 300000;
const MAX_FUTURE_SKEW_MS = 30000;

function classifyMessage(message, packet = {}, now = Date.now()) {
  if (packet && packet.retain === true) {
    return {accept:false, reason:'retained', timestampVerified:false};
  }
  if (!message || !Number.isFinite(now)) {
    return {accept:false, reason:'invalid', timestampVerified:false};
  }
  if (message.timestamp === null || message.timestamp === undefined) {
    return {accept:true, reason:null, timestampVerified:false};
  }
  if (!Number.isSafeInteger(message.timestamp)) {
    return {accept:false, reason:'invalid', timestampVerified:false};
  }
  if (message.timestamp > now + MAX_FUTURE_SKEW_MS) {
    return {accept:false, reason:'future', timestampVerified:false};
  }
  const maxAge = message.channel === 'osd' ? MAX_OSD_AGE_MS : MAX_OTHER_AGE_MS;
  if (now - message.timestamp > maxAge) {
    return {accept:false, reason:'stale', timestampVerified:false};
  }
  return {accept:true, reason:null, timestampVerified:true};
}

module.exports = {classifyMessage, MAX_OSD_AGE_MS, MAX_OTHER_AGE_MS, MAX_FUTURE_SKEW_MS};
