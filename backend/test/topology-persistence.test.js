'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMessage}=require('../dji');
const {createRegistry}=require('../registry');
const {createTopologyStore}=require('../topology-store');

const now=1792528000000;
function topo(timestamp,children=[{sn:'AIR01',domain:'0',type:77,sub_type:2,device_secret:'HIDDEN'}]){
  return parseMessage('sys/product/RC01/status',Buffer.from(JSON.stringify({
    tid:'6a7bfe89-c386-4043-b600-b518e10096cc',bid:'42a19f36-5117-4520-bd13-fd61d818d52e',
    timestamp,method:'update_topo',
    data:{domain:'2',type:144,sub_type:0,thing_version:'1.2.0',sub_devices:children}
  })));
}
function osd(sn,timestamp){
  return parseMessage('thing/product/'+sn+'/osd',Buffer.from(JSON.stringify({
    timestamp,data:{latitude:49.1,longitude:8.4,capacity_percent:80}})));
}
function fakeRedis(){
  const data=new Map();let expire=null;
  return {
    data,get expire(){return expire;},
    multi(){
      const ops=[];
      const chain={
        hset(key,...pairs){ops.push(()=>{for(let i=0;i<pairs.length;i+=2)data.set(pairs[i],pairs[i+1]);});return chain;},
        expire(key,seconds){ops.push(()=>{expire=seconds;});return chain;},
        async exec(){ops.forEach(op=>op());return [];}
      };
      return chain;
    },
    async hgetall(){return Object.fromEntries(data);}
  };
}

test('topology survives a restart without telemetry or topology secrets',async()=>{
  const live=createRegistry();
  const result=live.ingest(topo(now-1000),now);
  assert.equal(result.topologyChanged,true);
  live.ingest(osd('AIR01',now-500),now);
  const redis=fakeRedis();
  const store=createTopologyStore(redis);
  await store.save(live.topologyRecords(result.updates.map(d=>d.sn)));
  assert.equal(redis.expire,7*24*3600);
  const stored=JSON.stringify([...redis.data.values()]);
  assert.doesNotMatch(stored,/HIDDEN|device_secret|latitude|49\.1|capacity/);

  const restarted=createRegistry();
  assert.equal(restarted.restoreTopology(await store.load(),now+60000),2);
  const rc=restarted.get('RC01',now+60000);
  const air=restarted.get('AIR01',now+60000);
  assert.equal(rc.modelName,'DJI RC Pro Enterprise');
  assert.equal(air.modelName,'Mavic 3M');
  assert.equal(air.gatewaySn,'RC01');
  assert.deepEqual(rc.children,['AIR01']);
  assert.equal(rc.topologyRestored,true);
  // Restored topology never pretends to be fresh telemetry or a current position.
  assert.equal(air.fresh,false);
  assert.equal(air.positionFresh,false);
  assert.equal(air.telemetry.latitude,null);
  assert.equal(air.lastTelemetryAt,null);
});

test('stored topology never overwrites newer live topology',()=>{
  const old=createRegistry();
  old.ingest(topo(now-60000),now-59000);
  const records=old.topologyRecords();
  const live=createRegistry();
  live.ingest(topo(now-1000,[]),now);
  assert.equal(live.restoreTopology(records,now),0);
  assert.deepEqual(live.get('RC01',now).children,[]);
  assert.equal(live.get('RC01',now).topologyRestored,false);
});

test('a live update_topo after restore replaces the restored state',()=>{
  const old=createRegistry();
  old.ingest(topo(now-60000),now-59000);
  const registry=createRegistry();
  registry.restoreTopology(old.topologyRecords(),now);
  registry.ingest(topo(now-1000),now);
  assert.equal(registry.get('RC01',now).topologyRestored,false);
  assert.equal(registry.get('AIR01',now).topologyRestored,false);
});

test('restored status timestamp keeps update_topo replay protection',()=>{
  const old=createRegistry();
  old.ingest(topo(now-1000),now);
  const registry=createRegistry();
  registry.restoreTopology(old.topologyRecords(),now+5000);
  assert.equal(registry.ingest(topo(now-1000),now+6000).dropReason,'duplicate');
  assert.equal(registry.ingest(topo(now-2000),now+6000).dropReason,'duplicate');
  assert.equal(registry.ingest(topo(now+4000),now+6000).dropReason,undefined);
});

test('invalid or tampered stored records are ignored',async()=>{
  const valid={sn:'RC01',role:'gateway',gatewaySn:null,
    model:{domain:'2',type:144,subType:0,thingVersion:'1.2.0'},topologyOnline:true,
    lastTopologyAt:now-1000,topologyTimeVerified:true,children:[],statusTimestamp:now-1000};
  const bad=[
    {...valid,sn:'../x'},
    {...valid,role:'admin'},
    {...valid,lastTopologyAt:now+3600000},
    {...valid,children:['ok','bad sn']},
    {...valid,model:{domain:'<script>',type:1,subType:0,thingVersion:null}},
    {...valid,gatewaySn:'a/b'},
    {...valid,topologyOnline:'yes'},
    null,'string',42
  ];
  const registry=createRegistry();
  assert.equal(registry.restoreTopology(bad,now),0);
  assert.equal(registry.count(),0);
  assert.equal(registry.restoreTopology([{...valid,secret:'X'}],now),1);
  assert.doesNotMatch(JSON.stringify(registry.snapshot(now)),/secret/);

  const redis=fakeRedis();
  redis.data.set('RC01','{not json');
  redis.data.set('RC02',JSON.stringify({...valid,sn:'RC02'}));
  const loaded=await createTopologyStore(redis).load();
  assert.equal(loaded.length,1);
  assert.equal(registry.restoreTopology('not an array',now),0);
});
