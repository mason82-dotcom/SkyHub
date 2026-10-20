'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPilotPairing,deviceModel}=require('../pilot-pairing');

function memoryStore(){
  const data=new Map();
  return {
    data,
    get:async key=>data.get(key)??null,
    set:async(key,value)=>{data.set(key,value);},
    del:async key=>{data.delete(key);},
    all:async()=>Object.fromEntries(data)
  };
}
const UA='Mozilla/5.0 (Linux; Android 10; DJI RC Pro Enterprise Build/V80.50.02.16; wv) AppleWebKit/537.36';

test('device model comes from the Pilot 2 WebView user agent only',()=>{
  assert.equal(deviceModel(UA),'DJI RC Pro Enterprise');
  assert.equal(deviceModel('curl/8.0'),'Unbekanntes Gerät');
  assert.equal(deviceModel(undefined),'Unbekanntes Gerät');
});

test('approved pairing hands out the device token once and stores only its hash',async()=>{
  const store=memoryStore();
  const pairing=createPilotPairing({store});
  const started=pairing.start(UA,1000);
  assert.match(started.code,/^\d{6}$/);
  assert.match(started.pairingId,/^[0-9a-f]{32}$/);
  assert.equal((await pairing.poll(started.pairingId,1500)).status,'pending');
  assert.equal(pairing.approve('abcdef',1600),false);
  assert.equal(pairing.approve(started.code,1700),true);
  const result=await pairing.poll(started.pairingId,1800);
  assert.equal(result.status,'approved');
  assert.match(result.deviceToken,/^[0-9a-f]{64}$/);
  assert.equal((await pairing.poll(started.pairingId,1900)).status,'expired');
  const stored=JSON.stringify([...store.data]);
  assert.equal(stored.includes(result.deviceToken),false);
  const device=await pairing.verify(result.deviceToken,5000);
  assert.equal(device.model,'DJI RC Pro Enterprise');
  assert.equal(device.lastUsedAt,5000);
  assert.equal(await pairing.verify('f'.repeat(64)),null);
  assert.equal(await pairing.verify('not-a-token'),null);
});

test('pairing codes expire and pending pairings are bounded',async()=>{
  const pairing=createPilotPairing({store:memoryStore(),ttlMs:1000,maxPending:2});
  const first=pairing.start(UA,0);
  assert.ok(pairing.start(UA,0));
  assert.equal(pairing.start(UA,0),null);
  assert.equal(pairing.approve(first.code,2000),false);
  assert.equal((await pairing.poll(first.pairingId,2000)).status,'expired');
  assert.ok(pairing.start(UA,2000));
  assert.equal((await pairing.poll('../../etc',2000)).status,'unknown');
});

test('pending list and device list contain no pairing IDs or tokens; revoke works',async()=>{
  const pairing=createPilotPairing({store:memoryStore()});
  const started=pairing.start(UA,0);
  assert.equal(JSON.stringify(pairing.pending(0)).includes(started.pairingId),false);
  pairing.approve(started.code,1);
  const {deviceToken}=await pairing.poll(started.pairingId,2);
  const devices=await pairing.devices();
  assert.equal(devices.length,1);
  assert.equal(JSON.stringify(devices).includes(deviceToken),false);
  assert.equal(await pairing.revoke('zz'),false);
  assert.equal(await pairing.revoke(devices[0].id),true);
  assert.equal(await pairing.verify(deviceToken),null);
});
