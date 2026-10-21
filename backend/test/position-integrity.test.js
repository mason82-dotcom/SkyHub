'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistry } = require('../registry');
const osd = (sn, telemetry, timestamp = null) => ({
  sn, channel: 'osd', timestamp, gatewaySn: null,
  telemetry: Object.assign({
    latitude:null, longitude:null, altitude:null, heightEllipsoid:null, battery:null,
    heading:null, horizontalSpeed:null, verticalSpeed:null
  }, telemetry),
  state: null, topology: null, method: null
});

test('split latitude/longitude packets never produce a synthetic GPS fix', () => {
  const store = createRegistry();
  assert.equal(store.ingest(osd('AIR',{latitude:49.1}),1000).point,null);
  assert.equal(store.ingest(osd('AIR',{longitude:8.4}),2000).point,null);
  const d=store.get('AIR',2001);
  assert.equal(d.telemetry.latitude,null);
  assert.equal(d.telemetry.longitude,null);
  assert.equal(d.lastPositionAt,null);
  assert.equal(d.positionFresh,false);
});

test('partial GPS packets preserve a previously valid coordinate pair', () => {
  const store = createRegistry();
  const first=store.ingest(osd('AIR',{latitude:49.2,longitude:8.5,battery:55}),1000);
  assert.deepEqual([first.point.latitude,first.point.longitude],[49.2,8.5]);
  assert.equal(store.ingest(osd('AIR',{latitude:48.1,battery:40}),5000).point,null);
  const current=store.get('AIR',5001);
  assert.deepEqual([current.telemetry.latitude,current.telemetry.longitude],[49.2,8.5]);
  assert.equal(current.telemetry.battery,40);
  assert.equal(current.lastPositionAt,1000);
  assert.equal(current.lastTelemetryAt,5000);
  assert.equal(current.fresh,true);
  assert.equal(current.positionFresh,true);
  const expired=store.get('AIR',16000);
  assert.equal(expired.positionFresh,false);
  assert.equal(expired.fresh,true);
});

test('paired DJI 0/0 coordinates mean unavailable GPS, not a current fix', () => {
  const store=createRegistry();
  const result=store.ingest(osd('AIR',{latitude:0,longitude:0,battery:0}),20000);
  assert.equal(result.point,null);
  const device=store.get('AIR',20001);
  assert.equal(device.positionUnavailable,true);
  assert.equal(device.positionFresh,false);
  assert.equal(device.lastPositionAt,null);
  assert.equal(device.telemetry.latitude,null);
  assert.equal(device.telemetry.longitude,null);
  assert.equal(device.telemetry.battery,0);
  assert.equal(device.fresh,true);
});

test('state/events do not refresh GPS age', () => {
  const store=createRegistry();
  store.ingest(osd('AIR',{latitude:49,longitude:8}),500);
  store.ingest({sn:'AIR',channel:'state',timestamp:null,gatewaySn:null,
    telemetry:null,state:{modeCode:5,firmwareVersion:null},topology:null,method:null},20000);
  const current=store.get('AIR',20001);
  assert.equal(current.positionFresh,false);
  assert.equal(current.modeCode,5);
});

test('missing longitude cannot form a GPS fix', () => {
  const store=createRegistry();
  store.ingest(osd('AIR',{latitude:49,longitude:null}),1000);
  assert.equal(store.get('AIR',1001).lastPositionAt,null);
});
