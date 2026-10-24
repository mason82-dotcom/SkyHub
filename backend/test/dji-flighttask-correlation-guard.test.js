'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveFlighttaskObservation:resolve}=require('../dji-flighttask-correlation-guard');
const A='11111111-2222-4333-8444-555555555555';
const B='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base={workspaceId:A,observationId:A,gatewaySn:'gateway1',flightId:'flight1',tid:'tid1',bid:'bid1'};
const reply={workspaceId:A,gatewaySn:'gateway1',flightId:'flight1',tid:'tid1',bid:'bid1',kind:'service_reply'};
test('exact reply correlation is scoped to workspace, gateway, flight and transaction',()=>{
 const result=resolve([{...base,workspaceId:B},{...base,tid:'other'},base],reply);
 assert.deepEqual(result,{workspaceId:A,observationId:A});
 assert.ok(Object.isFrozen(result));
});
test('progress without transaction identifiers requires a unique gateway and flight',()=>{
 assert.deepEqual(resolve([base],{workspaceId:A,gatewaySn:'gateway1',flightId:'flight1',kind:'flighttask_progress'}),{workspaceId:A,observationId:A});
 assert.throws(()=>resolve([base,{...base,observationId:B,tid:'tid2'}],{workspaceId:A,gatewaySn:'gateway1',flightId:'flight1',kind:'flighttask_progress'}),/refused/);
});
test('same flight and gateway with two transaction IDs is ambiguous for progress',()=>{
 assert.throws(()=>resolve([base,{...base,observationId:B,tid:'tid2'}],{...reply,kind:'flighttask_progress'}),/refused/);
});
test('replies with incorrect transaction, missing identity or unknown observation fail closed',()=>{
 for(const report of [{...reply,tid:'wrong'},{...reply,bid:'wrong'},{...reply,workspaceId:B},{...reply,gatewaySn:'other'},{...reply,flightId:'other'},{...reply,tid:null},{...reply,kind:'other'}]){
  assert.throws(()=>resolve([base],report),/refused/);
 }
 assert.throws(()=>resolve([],reply),/refused/);
});
test('duplicates and malformed candidate sets cannot silently select a mission',()=>{
 assert.throws(()=>resolve([base,base],reply),/refused/);
 assert.throws(()=>resolve([base,{...base,observationId:'bad'}],reply),/refused/);
 assert.throws(()=>resolve('not-an-array',reply),/refused/);
 assert.throws(()=>resolve(Array.from({length:1001},()=>base),reply),/refused/);
});
test('no flight command transport or persistent store is introduced',()=>{
 assert.deepEqual(Object.keys(require('../dji-flighttask-correlation-guard')),[ 'resolveFlighttaskObservation' ]);
});
