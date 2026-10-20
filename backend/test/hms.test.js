'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeHms}=require('../hms-catalog');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');

const now=1792528000000;
const hmsEvent=(codes,timestamp)=>parseMessage('thing/product/AIR01/events',Buffer.from(JSON.stringify({
  timestamp,data:{event:'hms',method:'hms',output:{codes}}})));

test('HMS codes observed on the Mavic 3M resolve to German text with English fallback',()=>{
  const rtk=describeHms({code:'0x16100066'},{domain:'0'});
  assert.match(rtk.de,/RTK-Signal schwach/);
  assert.match(rtk.en,/RTK signal weak/);
  assert.equal(describeHms({code:'0xFFFFFFFF'},{domain:'0'}),null);
  assert.equal(describeHms(null),null);
});

test('in-the-sky variant is used only while the aircraft is flying',()=>{
  const ground=describeHms({code:'0x16100091'},{domain:'0',modeCode:0});
  const air=describeHms({code:'0x16100091'},{domain:'0',modeCode:3});
  assert.ok(ground && air);
  assert.notEqual(ground.en,air.en);
});

test('component placeholders are counted from 1',()=>{
  const texts=require('../data/hms-texts.json');
  const key=Object.keys(texts).find(k=>k.startsWith('fpv_tip_') && /%component_index/.test(texts[k].en||''));
  const text=describeHms({code:key.slice(8,18),componentIndex:1},{domain:'0'});
  assert.doesNotMatch(text.en,/%component_index/);
  assert.match(text.en,/2/);
});

test('registry keeps the latest complete HMS list with freshness and texts',()=>{
  const registry=createRegistry();
  registry.ingest(hmsEvent([{id:370147430,level:2,component_index:0,sensor_index:0},
    {id:453640193,level:1,component_index:0,sensor_index:0}],now-1000),now);
  let d=registry.get('AIR01',now);
  assert.equal(d.hms.length,2);
  assert.equal(d.hms[0].code,'0x16100066');
  assert.match(d.hms[0].text.de,/RTK/);
  assert.equal(d.hmsFresh,true);
  assert.equal(d.hmsTimeVerified,true);
  // HMS is not telemetry: it must not make OSD look fresh.
  assert.equal(d.fresh,false);
  registry.ingest(hmsEvent([],now+1000),now+2000);
  d=registry.get('AIR01',now+2000);
  assert.deepEqual(d.hms,[]);
  assert.equal(registry.get('AIR01',now+40000).hmsFresh,false);
});

test('an older HMS list cannot replace a newer one',()=>{
  const registry=createRegistry();
  registry.ingest(hmsEvent([],now),now);
  const result=registry.ingest(hmsEvent([{id:370147430,level:2}],now-5000),now+100);
  assert.equal(result.dropReason,'duplicate');
  assert.deepEqual(registry.get('AIR01',now+100).hms,[]);
});
