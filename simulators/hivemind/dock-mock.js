'use strict';

// Synthetic lab-only DJI Dock onboarding responder. NOT a production Cloud API.
// No external targets, no real credentials, no serials or request bodies in logs.
const ORG = 'skyhub-lab-org';
const CODE = 'skyhub-lab-code';
const MAX_BYTES = 8192;
const METHODS = Object.freeze([
  'config', 'airport_bind_status', 'airport_organization_get', 'airport_organization_bind'
]);
const SN = /^[A-Za-z0-9_.-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function sn(value) {
  return typeof value === 'string' && SN.test(value);
}
function parseRequest(topic, raw, now = Date.now()) {
  const match = /^thing\/product\/([A-Za-z0-9_.-]{1,100})\/requests$/.exec(topic);
  if (!match || !Buffer.isBuffer(raw) || raw.length < 2 || raw.length > MAX_BYTES) return null;
  let request;
  try { request = JSON.parse(raw.toString('utf8')); } catch { return null; }
  if (!isObject(request) || !isObject(request.data) ||
      !METHODS.includes(request.method) || !UUID.test(request.tid) ||
      !UUID.test(request.bid) || request.gateway !== match[1] ||
      !Number.isSafeInteger(request.timestamp) ||
      Math.abs(now - request.timestamp) > 60000) return null;
  return { gateway: match[1], request };
}

function validRequest(method, data, gateway) {
  if (method === 'config')
    return data.config_type === 'json' && data.config_scope === 'product';
  if (method === 'airport_bind_status')
    return Array.isArray(data.devices) && data.devices.length === 2 &&
      data.devices[0]?.sn === gateway && sn(data.devices[1]?.sn) &&
      data.devices[1].sn !== gateway;
  if (method === 'airport_organization_get')
    return data.organization_id === ORG && data.device_binding_code === CODE;
  if (method === 'airport_organization_bind')
    return Array.isArray(data.bind_devices) && data.bind_devices.length === 2 &&
      data.bind_devices[0]?.sn === gateway && sn(data.bind_devices[1]?.sn) &&
      data.bind_devices[1].sn !== gateway &&
      data.bind_devices.every(d => isObject(d) && d.organization_id === ORG &&
        d.device_binding_code === CODE && typeof d.device_model_key === 'string' &&
        d.device_model_key.length > 0 && d.device_model_key.length < 80);
  return false;
}

function createResponder(clock = Date.now) {
  const stages = new Map();
  const counters = { config: 0, airport_bind_status: 0,
    airport_organization_get: 0, airport_organization_bind: 0, update_topo: 0 };
  function reply(topic, payload) {
    const event = parseRequest(topic, payload, clock());
    if (!event) return null;
    const {gateway, request} = event;
    if (!validRequest(request.method, request.data, gateway)) return null;
    const index = METHODS.indexOf(request.method);
    const current = stages.get(gateway) ?? 0;
    if (index !== current || (current === 0 && stages.size >= 8)) return null;
    stages.set(gateway, current + 1);
    counters[request.method]++;
    let data = {result: 0};
    if (request.method === 'config') {
      data = {...data, app_id: 'skyhub-lab-app', app_key: 'skyhub-lab-not-a-real-key',
        app_license: ''};
    }
    if (request.method === 'airport_organization_bind')
      data = {...data, output: {err_infos: []}};
    return {
      topic: 'thing/product/' + gateway + '/requests_reply',
      payload: JSON.stringify({
        tid: request.tid, bid: request.bid, method: request.method,
        timestamp: clock(), data
      })
    };
  }
  function topologyReply(topic, raw) {
    const match = /^sys\/product\/([A-Za-z0-9_.-]{1,100})\/status$/.exec(topic);
    if (!match || stages.get(match[1]) !== 4 || !Buffer.isBuffer(raw) ||
        raw.length < 2 || raw.length > MAX_BYTES) return null;
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return null; }
    if (!isObject(msg) || msg.method !== 'update_topo' ||
        !UUID.test(msg.tid) || !UUID.test(msg.bid) ||
        !Number.isSafeInteger(msg.timestamp) ||
        Math.abs(clock() - msg.timestamp) > 60000 ||
        !isObject(msg.data) || !Array.isArray(msg.data.sub_devices) ||
        msg.data.sub_devices.length > 1 ||
        (msg.data.sub_devices.length === 1 && !sn(msg.data.sub_devices[0]?.sn)))
      return null;
    counters.update_topo++;
    return {
      topic: 'sys/product/' + match[1] + '/status_reply',
      payload: JSON.stringify({
        tid: msg.tid, bid: msg.bid, method: 'update_topo',
        timestamp: clock(), data: {result: 0}
      })
    };
  }
  function snapshot() { return {...counters}; }
  return {reply, topologyReply, snapshot};
}

function start() {
  const mqtt = require('mqtt');
  // Container DNS and port are compile-time allowlisted for this lab.
  // Never accept user-provided MQTT URLs or production broker credentials.
  const client = mqtt.connect('mqtt://hivemind-broker:1884', {
    clientId: 'skyhub_hivemind_dock_mock',
    protocolVersion: 5, reconnectPeriod: 2500, connectTimeout: 5000
  });
  const service = createResponder();
  client.on('connect', () => {
    client.subscribe(['thing/product/+/requests', 'sys/product/+/status'], {qos: 0},
      (error) => {
        if (error) console.error('[dock lab mock] subscription failed');
        else console.log('[dock lab mock] ready');
      });
  });
  client.on('message', (topic, payload, packet) => {
    if (packet?.retain) return;
    const response = topic.endsWith('/requests') ?
      service.reply(topic, payload) : service.topologyReply(topic, payload);
    if (response) client.publish(response.topic, response.payload, {qos: 0, retain: false});
  });
  client.on('error', () => console.error('[dock lab mock] MQTT error'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
    client.end(true, () => process.exit(0));
  });
}

if (require.main === module) start();
module.exports = {parseRequest, validRequest, createResponder, METHODS, ORG, CODE};
