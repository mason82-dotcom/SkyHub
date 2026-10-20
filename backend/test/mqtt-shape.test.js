'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createShapeCatalog}=require('../mqtt-shape');

const raw=(value)=>Buffer.from(JSON.stringify(value));

test('shape catalog groups by channel, method and field names without values or serials',()=>{
  const catalog=createShapeCatalog();
  const osd=parseMessage('thing/product/5YSZSECRETSN/osd',
    raw({data:{latitude:49.123456,longitude:8.654321,capacity_percent:77}}));
  catalog.record(osd,1000);
  catalog.record(osd,2000);
  catalog.record(parseMessage('sys/product/5YSZSECRETSN/status',
    raw({method:'update_topo',need_reply:1,data:{domain:'2',sub_devices:[]}})),3000);
  const snap=catalog.snapshot();
  assert.equal(snap.length,2);
  assert.deepEqual(snap[1],{channel:'osd',method:null,
    dataKeys:['capacity_percent','latitude','longitude'],count:2,needReply:0,firstAt:1000,lastAt:2000});
  assert.equal(snap[0].method,'update_topo');
  assert.equal(snap[0].needReply,1);
  assert.doesNotMatch(JSON.stringify(snap),/5YSZSECRETSN|49\.12|8\.65|77/);
});
test('shape catalog is bounded and rejects unsafe method names',()=>{
  const catalog=createShapeCatalog(2);
  for(const key of ['a','b','c']){
    catalog.record({channel:'state',method:null,dataKeys:[key]},1);
  }
  assert.equal(catalog.snapshot().length,2);
  const other=createShapeCatalog();
  other.record({channel:'events',method:'x y<script>',dataKeys:[]},1);
  assert.equal(other.snapshot()[0].method,null);
  other.record(null);
  assert.equal(other.snapshot().length,1);
});
