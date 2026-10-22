'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pilotConfiguration}=require('../pilot-config');

const configured={
  SKYHUB_PILOT_ENABLED:'true',
  SKYHUB_PILOT_ACCESS_TOKEN:'a'.repeat(48),
  SKYHUB_DJI_APP_ID:'cloud-app-id',
  SKYHUB_DJI_APP_KEY:'example-app-key',
  SKYHUB_DJI_APP_LICENSE:'example-license',
  SKYHUB_PILOT_MQTT_USER:'pilot_publish',
  SKYHUB_PILOT_MQTT_PASSWORD:'example-mqtt-password',
  SKYHUB_PILOT_MQTT_URL:'mqtt://192.168.178.63:1884',
  SKYHUB_PILOT_WORKSPACE_ID:'e3dea0f5-37f2-4d79-ae58-490af3228069'
};
test('Pilot 2 onboarding is disabled by default with no exposed bootstrap secrets',()=>{
  const c=pilotConfiguration({});
  assert.equal(c.ready,false);
  assert.throws(()=>c.bootstrap(),/not configured/);
  assert.equal(c.missing.includes('SKYHUB_PILOT_ENABLED'),true);
  assert.equal(JSON.stringify(c).includes('example-mqtt-password'),false);
});
test('Pilot 2 transport maps Pi MQTT 1884 to DJI Bridge tcp:// URL',()=>{
  const c=pilotConfiguration(configured);
  assert.equal(c.ready,true);
  const b=c.bootstrap();
  assert.equal(b.mqtt.host,'tcp://192.168.178.63:1884');
  assert.equal(b.mqtt.username,'pilot_publish');
  assert.equal(b.workspaceId,configured.SKYHUB_PILOT_WORKSPACE_ID);
  assert.equal(JSON.stringify({ready:c.ready,missing:c.missing}).includes(b.mqtt.password),false);
});
test('Prevent accidental Pilot 2 MQTT 1883, localhost or container hostname',()=>{
  for(const url of ['mqtt://192.168.178.63:1883','mqtt://localhost:1884',
                    'mqtt://host.docker.internal:1884','mqtt://127.0.0.1:1884']){
    const c=pilotConfiguration({...configured,SKYHUB_PILOT_MQTT_URL:url});
    assert.equal(c.ready,false,url);
    assert.throws(()=>c.bootstrap(),/not configured/);
  }
});
test('Reject incomplete license, missing credentials, weak access token and invalid workspace',()=>{
  for(const patch of [
    {SKYHUB_DJI_APP_LICENSE:''},{SKYHUB_DJI_APP_ID:''},
    {SKYHUB_PILOT_MQTT_PASSWORD:''},
    {SKYHUB_PILOT_ACCESS_TOKEN:'123'},
    {SKYHUB_PILOT_WORKSPACE_ID:'foo'},
    {SKYHUB_PILOT_ENABLED:'false'}
  ])assert.equal(pilotConfiguration({...configured,...patch}).ready,false);
});
test('Pilot 2 enabled endpoint rejects broad LAN bind, requiring a trusted HTTPS reverse proxy',()=>{
  const c=pilotConfiguration({...configured,SKYHUB_BIND_ADDRESS:'0.0.0.0'});
  assert.equal(c.ready,false);
  assert.match(c.missing.join(' '),/loopback/);
});
test('No unverified MQTT TLS mode is advertised as working',()=>{
  const c=pilotConfiguration({...configured,SKYHUB_PILOT_MQTT_URL:'mqtts://192.168.178.63:1884'});
  assert.equal(c.ready,false);
});

test('TSA stays off without an HTTPS origin',()=>{
  const inactive=pilotConfiguration(configured);
  assert.equal(inactive.tsa.enabled,false);
  const invalid=pilotConfiguration({...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'http://example.invalid/'});
  assert.equal(invalid.tsa.enabled,false);
  assert.match(invalid.tsa.issue,/HTTPS/);
});
test('TSA accepts only exact trusted proxy IP addresses',()=>{
  const base={...configured,SKYHUB_DJI_TSA_ENABLED:'true',
    SKYHUB_PILOT_PUBLIC_URL:'https://pilot.example.test/'};
  const valid=pilotConfiguration({...base,SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS:'172.18.0.1,::1'});
  assert.equal(valid.tsa.enabled,true);
  assert.deepEqual(valid.tsa.trustedProxyIps,['172.18.0.1','::1']);
  assert.equal(valid.bootstrap().tsa.wsHost,'wss://pilot.example.test/ws/tsa');
  for(const bad of ['172.16.0.0/12','*','0.0.0.0','::','192.168.*','none']){
    const c=pilotConfiguration({...base,SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS:bad});
    assert.equal(c.tsa.enabled,false,bad);
    assert.match(c.tsa.issue,/proxy IPs/);
  }
});
