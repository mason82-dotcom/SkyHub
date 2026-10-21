'use strict';
const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {io}=require('socket.io-client');

// This process starts the real app on an ephemeral port. External services point
// to the local closed port 1, so the test cannot contact the Pi broker or Redis.
const VIEW_TOKEN='test-view-token-abcdefghijklmnopqrstuvwxyz';
const PILOT_TOKEN='test-pilot-token-abcdefghijklmnopqrstuvwxyz';
const LICENSE='test-license-marker';
Object.assign(process.env,{
  NODE_ENV:'test',
  PORT:'0',SKYHUB_BIND_ADDRESS:'127.0.0.1',
  SKYHUB_VIEW_TOKEN:VIEW_TOKEN,
  SKYHUB_LAN_VIEW_CIDR:'192.168.178.0/24',
  MQTT_BROKER_URL:'mqtt://127.0.0.1:1',
  REDIS_URL:'redis://127.0.0.1:1',
  SKYHUB_TOPOLOGY_ACK_ENABLED:'false',
  SKYHUB_PILOT_ENABLED:'true',
  SKYHUB_PILOT_ACCESS_TOKEN:PILOT_TOKEN,
  SKYHUB_DJI_APP_ID:'test-app-id',
  SKYHUB_DJI_APP_KEY:'test-app-key',
  SKYHUB_DJI_APP_LICENSE:LICENSE,
  SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_MQTT_USER:'test-pilot-user',
  SKYHUB_PILOT_MQTT_PASSWORD:'test-pilot-password',
  SKYHUB_PILOT_WORKSPACE_ID:'123e4567-e89b-42d3-a456-426614174000',
  SKYHUB_DJI_MAP_ELEMENTS_ENABLED:'true'
});
delete process.env.DATABASE_URL;
const {server,stop}=require('../server');
let base;
before(async()=>{
  if(!server.listening)await once(server,'listening');
  base='http://127.0.0.1:'+server.address().port;
});
after(()=>stop());

async function request(path,{method='GET',token,xAuthToken,lan,https}={}){
  const headers={};
  if(token)headers.authorization='Bearer '+token;
  if(xAuthToken)headers['x-auth-token']=xAuthToken;
  if(lan)headers['x-forwarded-for']=lan;
  if(https)headers['x-forwarded-proto']='https';
  return fetch(base+path,{method,headers});
}
function socketOutcome({token,lan}={}){
  return new Promise((resolve,reject)=>{
    const options={transports:['polling'],reconnection:false,timeout:2000};
    if(token)options.auth={token};
    if(lan)options.extraHeaders={'x-forwarded-for':lan};
    const client=io(base,options);
    const timer=setTimeout(()=>{client.disconnect();reject(Error('Socket.IO timeout'));},3000);
    function finish(value){clearTimeout(timer);client.disconnect();resolve(value);}
    client.once('connect',()=>finish('connected'));
    client.once('connect_error',error=>finish(error.message));
  });
}

test('public health does not reveal Pilot credentials',async()=>{
  const response=await request('/api/health');
  assert.equal(response.status,200);
  const health=await response.json();
  assert.equal(health.postgresConfigured,false);
  assert.equal(health.postgresMigrationReady,false);
  const body=JSON.stringify(health);
  assert.equal(body.includes(LICENSE),false);
  assert.equal(body.includes('test-pilot-password'),false);
  assert.equal(body.includes(VIEW_TOKEN),false);
});

test('DJI field HTTP diagnostics returns all six catalogued model definitions',async()=>{
  const {fieldDefinitions}=require('../dji-properties');
  for(const model of ['2:144:0','2:174:0','0:77:0','0:77:1','0:77:2','0:99:1']){
    const response=await request('/api/diagnostics/dji-fields?model='+model,{token:VIEW_TOKEN});
    assert.equal(response.status,200,model);
    const [domain,type,subType]=model.split(':');
    assert.deepEqual(await response.json(),
      fieldDefinitions({domain,type:Number(type),subType:Number(subType)}));
  }
});

test('DJI field HTTP diagnostics rejects invalid queries and distinguishes unknown models',async()=>{
  for(const query of ['', '?model=', '?model=0:77', '?model=0:77:2:1',
    '?model=1:89:0', '?model=0:7777:2', '?model=0:-77:2', '?model=0:77:2.0',
    '?model=0:%5Cd:%5Cd', '?model=0:77:2&model=2:144:0', '?model[type]=77']){
    const response=await request('/api/diagnostics/dji-fields'+query,{token:VIEW_TOKEN});
    assert.equal(response.status,400,query);
    assert.deepEqual(await response.json(),{error:'Expected domain:type:sub_type'});
  }
  const unknown=await request('/api/diagnostics/dji-fields?model=0:999:0',{token:VIEW_TOKEN});
  assert.equal(unknown.status,404);
  assert.deepEqual(await unknown.json(),{error:'Model not in schema catalogue'});
});

test('DJI field HTTP diagnostics requires the view token, including from the LAN',async()=>{
  const path='/api/diagnostics/dji-fields?model=0:77:2';
  for(const options of [{},{lan:'192.168.178.70'},{token:PILOT_TOKEN}]){
    const response=await request(path,options);
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{error:'Unauthorized'});
  }
});

test('LAN view is read-only; pairing administration still needs the view token',async()=>{
  assert.equal((await request('/api/devices')).status,401);
  assert.equal((await request('/api/devices',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/devices',{lan:'203.0.113.9'})).status,401);
  assert.equal((await request('/api/diagnostics/mqtt-shapes',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/drone/AIR01/track',{lan:'192.168.178.70'})).status,200);
  assert.equal((await request('/api/drone/AIR01/telemetry',{lan:'192.168.178.70'})).status,404);
  assert.equal((await request('/api/drone/AIR01/secrets',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/pilot-admin/pairings',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/unknown-future-route',{lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/mission/create',{method:'POST',lan:'192.168.178.70'})).status,401);
  assert.equal((await request('/api/mission/create',{method:'POST',token:VIEW_TOKEN})).status,501);
});

test('Pilot bootstrap requires HTTPS and the Pilot token',async()=>{
  assert.equal((await request('/api/pilot/bootstrap',{method:'POST',token:PILOT_TOKEN})).status,403);
  assert.equal((await request('/api/pilot/bootstrap',{method:'POST',https:true})).status,401);
  const response=await request('/api/pilot/bootstrap',{method:'POST',token:PILOT_TOKEN,https:true});
  assert.equal(response.status,200);
  assert.equal((await response.json()).license,LICENSE);
  const status=await request('/api/pilot/status');
  assert.equal((await status.text()).includes(LICENSE),false);
});

test('DJI map-group route requires HTTPS, the configured workspace and x-auth-token',async()=>{
  const path='/map/api/v1/workspaces/123e4567-e89b-42d3-a456-426614174000/element-groups';
  assert.equal((await request(path,{xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path,{https:true})).status,401);
  assert.equal((await request('/map/api/v1/workspaces/e3dea0f5-37f2-4d79-ae58-490af3228069/element-groups',
    {https:true,xAuthToken:PILOT_TOKEN})).status,404);
  assert.equal((await request(path+'?is_distributed=unknown',
    {https:true,xAuthToken:PILOT_TOKEN})).status,400);
  // The shared Pilot credential is not an operator/admin grant.
  assert.equal((await request(path+'?is_distributed=false',
    {https:true,xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path+'?is_distributed=false&role=admin',
    {https:true,xAuthToken:PILOT_TOKEN})).status,403);
  assert.equal((await request(path,{https:true,xAuthToken:VIEW_TOKEN})).status,401);
  assert.equal((await request(path,{https:true,lan:'192.168.178.70'})).status,401);
  assert.equal((await request(path,{method:'POST',https:true,xAuthToken:PILOT_TOKEN})).status,404);
  // DATABASE_URL is unset in this suite, so the guarded route cannot contact Postgres.
  assert.equal((await request(path,{https:true,xAuthToken:PILOT_TOKEN})).status,503);
});

test('Socket.IO admits only the view token or a configured LAN viewer',async()=>{
  assert.equal(await socketOutcome(),'Unauthorized');
  assert.equal(await socketOutcome({lan:'203.0.113.9'}),'Unauthorized');
  assert.equal(await socketOutcome({lan:'192.168.178.70'}),'connected');
  assert.equal(await socketOutcome({token:VIEW_TOKEN}),'connected');
});
