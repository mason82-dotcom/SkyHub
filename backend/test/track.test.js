'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTrackPolicy,distanceMeters}=require('../track-policy');
const {createTrackStore,retentionDays}=require('../track-store');

const at=1792528000000;
const pt=(lat,lon,alt=10,sn='AIR01')=>({deviceSn:sn,gatewaySn:'RC01',latitude:lat,longitude:lon,altitude:alt,battery:50});

test('distance approximation is accurate for metre-scale movement',()=>{
  // 0.00001 deg latitude is about 1.11 m.
  assert.ok(Math.abs(distanceMeters(pt(49,8),pt(49.00001,8))-1.11)<0.02);
});

test('stationary devices write one point per minute instead of every OSD packet',()=>{
  const policy=createTrackPolicy();
  let stored=0;
  for(let i=0;i<120;i++)if(policy.shouldStore(pt(49.1,8.4),at+i*1000))stored++;
  assert.equal(stored,2);
});

test('movement of 2 m horizontally or vertically is always stored',()=>{
  const policy=createTrackPolicy();
  assert.equal(policy.shouldStore(pt(49.1,8.4,10),at),true);
  assert.equal(policy.shouldStore(pt(49.100005,8.4,10),at+1000),false);
  assert.equal(policy.shouldStore(pt(49.10002,8.4,10),at+2000),true);
  assert.equal(policy.shouldStore(pt(49.10002,8.4,12.5),at+3000),true);
  assert.equal(policy.shouldStore(pt(49.10002,8.4,null),at+4000),true);
});

test('0/0 without a position fix is never persisted',()=>{
  const policy=createTrackPolicy();
  for(let i=0;i<5;i++)assert.equal(policy.shouldStore(pt(0,0),at+i*120000),false);
  assert.equal(policy.shouldStore(pt(0.5,0),at),true);
});

test('devices are tracked independently and memory stays bounded',()=>{
  const policy=createTrackPolicy({limit:2});
  assert.equal(policy.shouldStore(pt(49,8,10,'A'),at),true);
  assert.equal(policy.shouldStore(pt(49,8,10,'B'),at),true);
  assert.equal(policy.shouldStore(pt(49,8,10,'A'),at+1000),false);
  assert.equal(policy.shouldStore(pt(49,8,10,'C'),at+1000),true);
  // A was evicted, so its next point counts as a first point again.
  assert.equal(policy.shouldStore(pt(49,8,10,'A'),at+2000),true);
});

test('retention days are validated',()=>{
  assert.equal(retentionDays(undefined),30);
  assert.equal(retentionDays('7'),7);
  for(const bad of ['0','-1','3651','1.5','abc'])assert.throws(()=>retentionDays(bad),undefined,bad);
});

function fakePool(rows=[]){
  const calls=[];
  return {calls,async query(sql,params){calls.push({sql,params});return {rows,rowCount:rows.length};}};
}

test('track store uses parameters only and returns the newest points oldest-first',async()=>{
  const pool=fakePool([{t:'3000',latitude:49.2,longitude:8.4,altitude:12,time_verified:true},
    {t:'2000',latitude:49.1,longitude:8.4,altitude:11,time_verified:true}]);
  const store=createTrackStore(pool);
  await store.migrate();
  assert.match(pool.calls[0].sql,/ADD COLUMN IF NOT EXISTS source_ts/);
  const track=await store.track("AIR01'; DROP TABLE x;--",'99999');
  const q=pool.calls.at(-1);
  assert.doesNotMatch(q.sql,/DROP TABLE/);
  assert.deepEqual(q.params,["AIR01'; DROP TABLE x;--",1440,5000]);
  assert.match(q.sql,/NOT \(latitude=0 AND longitude=0\)/);
  assert.deepEqual(track.map(p=>p.t),[2000,3000]);
  await store.track('AIR01','abc');
  assert.equal(pool.calls.at(-1).params[1],60);
  await store.insert({...pt(49,8),sourceTs:at,timeVerified:true,heightEllipsoid:130,
    gpsSatellites:12,rtkSatellites:20,rtkFixState:2,positionQuality:10});
  assert.equal(pool.calls.at(-1).params.length,13);
  await store.prune(30);
  assert.deepEqual(pool.calls.at(-1).params,[30]);
});

test('without a database the track store is a safe no-op',async()=>{
  const store=createTrackStore(null);
  await store.migrate();
  assert.deepEqual(await store.track('AIR01',60),[]);
  assert.equal(await store.prune(30),0);
});
