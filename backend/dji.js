'use strict';

// DJI Cloud API 1.x message reader (not a Pilot 2/Cloud API 2 write interface).
// Never log, cache or forward raw topology credentials: device_secret and nonce.
function finite(value, min = -Infinity, max = Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function serial(value) {
  return typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : null;
}
function parseTopic(topic) {
  const match = /^(thing|sys)\/product\/([^/]{1,100})\/(osd|state|events|services_reply|status)$/.exec(topic);
  if (!match || !serial(match[2]) ||
      (match[1] === 'sys' && match[3] !== 'status') ||
      (match[1] === 'thing' && match[3] === 'status')) return null;
  return { source: match[1], sn: match[2], channel: match[3] };
}
function extractTelemetry(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  const battery = properties.battery && typeof properties.battery === 'object' ? properties.battery : {};
  const firstBattery = Array.isArray(battery.batteries) ? battery.batteries[0]?.capacity_percent : null;
  return {
    latitude: finite(properties.latitude, -90, 90),
    longitude: finite(properties.longitude, -180, 180),
    altitude: finite(properties.height ?? properties.altitude ?? properties.height_above_takeoff),
    battery: finite(properties.battery_percentage ?? properties.capacity_percent ?? battery.capacity_percent ?? firstBattery, 0, 100),
    heading: finite(properties.attitude_head ?? properties.heading, -360, 360)
  };
}
function extractState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    modeCode: Number.isInteger(data.mode_code) ? data.mode_code : null,
    firmwareVersion: typeof data.firmware_version === 'string' && data.firmware_version.length <= 64
      ? data.firmware_version : null
  };
}
function extractTopology(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.sub_devices)) return null;
  // A topology snapshot is not a flight-status message. Only allowlist non-secret fields.
  return {
    model: {
      type: Number.isInteger(data.type) ? data.type : null,
      subType: Number.isInteger(data.sub_type) ? data.sub_type : null
    },
    children: data.sub_devices.slice(0, 100).filter(d => d && serial(d.sn)).map(d => ({
      sn: d.sn,
      model: {
        type: Number.isInteger(d.type) ? d.type : null,
        subType: Number.isInteger(d.sub_type) ? d.sub_type : null
      }
    }))
  };
}
function parseMessage(topic, raw) {
  const meta = parseTopic(topic);
  if (!meta) return null;
  if (!raw || raw.length > 131072) throw new Error('Invalid MQTT payload length');
  const envelope = JSON.parse(raw.toString('utf8'));
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
    throw new Error('Invalid DJI envelope');
  const data = envelope.data;
  const method = typeof envelope.method === 'string' ? envelope.method.slice(0, 80) : null;
  const timestamp = finite(envelope.timestamp, 1e12, 1e15);
  return {
    ...meta,
    method,
    timestamp,
    gatewaySn: serial(envelope.gateway),
    telemetry: meta.channel === 'osd' ? extractTelemetry(data) : null,
    state: meta.channel === 'state' ? extractState(data) : null,
    topology: meta.channel === 'status' && method === 'update_topo' ? extractTopology(data) : null
  };
}
function fresh(last, now = Date.now()) {
  return Number.isFinite(last) && last <= now && now - last < 15000;
}
module.exports = { finite, serial, parseTopic, extractTelemetry, extractState, extractTopology, parseMessage, fresh };
