'use strict';

const { fresh } = require('./dji');
const { resolveDeviceModel, category } = require('./catalog');

function createRegistry(limit = 200) {
  const devices = new Map();
  const events = [];
  function safeDevice(d, now = Date.now()) {
    return {
      sn: d.sn, role: d.role, gatewaySn: d.gatewaySn,
      model: d.model, modelName: resolveDeviceModel(d.model),
      deviceCategory: category(d.model.domain), topologyOnline: d.topologyOnline,
      children: [...d.children], channel: d.channel,
      modeCode: d.modeCode, firmwareVersion: d.firmwareVersion,
      lastSeenAt: d.lastSeenAt, lastTelemetryAt: d.lastTelemetryAt,
      fresh: fresh(d.lastTelemetryAt, now), telemetry: { ...d.telemetry }
    };
  }
  function ensure(sn) {
    if (devices.has(sn)) return devices.get(sn);
    if (devices.size >= limit) devices.delete(devices.keys().next().value);
    const d = {
      sn, role: 'unknown', gatewaySn: null,
      model: {domain:null,type:null,subType:null,thingVersion:null},
      topologyOnline: null, children: [], channel: null,
      modeCode: null, firmwareVersion: null, lastSeenAt: null,
      lastTelemetryAt: null, lastByChannel: Object.create(null),
      telemetry: { latitude:null,longitude:null,altitude:null,heightEllipsoid:null,battery:null,
        heading:null,horizontalSpeed:null,verticalSpeed:null }
    };
    devices.set(sn, d);
    return d;
  }
  function ingest(message, now = Date.now()) {
    if (!message) return { updates:[], event:null, point:null };
    const existing = devices.get(message.sn);
    const prior = existing?.lastByChannel[message.channel];
    // Retained or delayed MQTT packets must not overwrite later snapshots.
    if (message.timestamp !== null && Number.isFinite(prior) && message.timestamp <= prior) {
      return { updates:[], event:null, point:null };
    }
    const d = ensure(message.sn);
    const updates = new Map();
    d.channel = message.channel;
    d.lastSeenAt = now;
    if (message.timestamp !== null) d.lastByChannel[message.channel] = message.timestamp;
    if (message.gatewaySn && message.gatewaySn !== message.sn) {
      d.gatewaySn = message.gatewaySn;
      if (d.role === 'unknown') d.role = 'subdevice';
    }
    let point = null;
    if (message.telemetry) {
      const values = Object.entries(message.telemetry).filter(([,v]) => v !== null);
      if (values.length) {
        for (const [key, value] of values) d.telemetry[key] = value;
        d.lastTelemetryAt = now;
      }
      // Both coordinates must be present in the SAME genuine OSD packet.
      if (message.telemetry.latitude !== null && message.telemetry.longitude !== null) {
        point = {
          deviceSn: d.sn, gatewaySn: d.gatewaySn,
          latitude: message.telemetry.latitude,
          longitude: message.telemetry.longitude,
          altitude: message.telemetry.altitude,
          battery: message.telemetry.battery
        };
      }
    }
    if (message.state) {
      if (message.state.modeCode !== null) d.modeCode = message.state.modeCode;
      if (message.state.firmwareVersion !== null) d.firmwareVersion = message.state.firmwareVersion;
    }
    if (message.topology) {
      d.role = 'gateway';
      d.topologyOnline = true;
      d.model = message.topology.model;
      const priorChildren = new Set(d.children);
      const children = message.topology.children.map(x => x.sn).filter(sn => sn !== d.sn);
      const unique = [...new Set(children)];
      d.children = unique;
      for (const sn of priorChildren) {
        if (unique.includes(sn)) continue;
        const child = devices.get(sn);
        if (child && child.gatewaySn === d.sn) {
          child.topologyOnline = false;
          updates.set(sn, child);
        }
      }
      for (const childData of message.topology.children) {
        if (childData.sn === d.sn) continue;
        const child = ensure(childData.sn);
        child.gatewaySn = d.sn;
        child.role = 'subdevice';
        child.topologyOnline = true;
        child.model = childData.model;
        updates.set(child.sn, child);
      }
    }
    updates.set(d.sn, d);
    let event = null;
    if (['events','status','services_reply'].includes(message.channel)) {
      event = {sn:d.sn,channel:message.channel,method:message.method,at:now};
      events.unshift(event);
      if (events.length > 100) events.pop();
    }
    return {updates:[...updates.values()].map(device => safeDevice(device,now)),event,point};
  }
  return {
    ingest,
    snapshot(now = Date.now()) { return [...devices.values()].map(d => safeDevice(d,now)); },
    events() { return events.map(event => ({...event})); },
    get(sn, now = Date.now()) { const d = devices.get(sn); return d ? safeDevice(d,now) : null; },
    count() { return devices.size; }
  };
}
module.exports = { createRegistry };
