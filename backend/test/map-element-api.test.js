'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMapElementHandler}=require('../map-element-api');

const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';
function response(){
  return {statusCode:200,body:null,
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return body;}};
}
function request({secure=true,token='pilot-token',workspaceId=WORKSPACE,query={}}={}){
  return {secure,headers:{'x-auth-token':token},params:{workspaceId},query};
}

test('map-group route requires HTTPS and a valid DJI API token',async()=>{
  let reads=0;
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token',
    store:{readResponse:async()=>{reads++;return {code:0,data:[]};}}});
  const insecure=response();
  await handler(request({secure:false}),insecure);
  assert.equal(insecure.statusCode,403);
  const unauthorized=response();
  await handler(request({token:'wrong'}),unauthorized);
  assert.equal(unauthorized.statusCode,401);
  assert.equal(reads,0);
});

test('map-group route binds the requested workspace and forwards official GET filters',async()=>{
  let read;
  const expected={code:0,message:'success',data:[]};
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async token=>token==='pilot-token',
    store:{readResponse:async(...args)=>{read=args;return expected;}}});
  const res=response();
  await handler(request({query:{group_id:'shared',is_distributed:'false'}}),res);
  assert.deepEqual(read,[WORKSPACE,{groupId:'shared',isDistributed:false}]);
  assert.equal(res.body,expected);
  const wrongWorkspace=response();
  await handler(request({workspaceId:'123e4567-e89b-42d3-a456-426614174000'}),wrongWorkspace);
  assert.equal(wrongWorkspace.statusCode,404);
});

test('invalid filters and unavailable storage fail without leaking errors',async()=>{
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>true,
    store:{readResponse:async()=>{throw Error('database password must stay private');}}});
  const badFilter=response();
  await handler(request({query:{is_distributed:'yes'}}),badFilter);
  assert.equal(badFilter.statusCode,400);
  const failedRead=response();
  await handler(request(),failedRead);
  assert.equal(failedRead.statusCode,503);
  assert.doesNotMatch(JSON.stringify(failedRead.body),/password|private/);
});

test('authorization backend failures return a redacted service error',async()=>{
  const handler=createMapElementHandler({workspaceId:WORKSPACE,
    authorize:async()=>{throw Error('private redis details');},store:null});
  const res=response();
  await handler(request(),res);
  assert.equal(res.statusCode,503);
  assert.doesNotMatch(JSON.stringify(res.body),/private redis/);
});
