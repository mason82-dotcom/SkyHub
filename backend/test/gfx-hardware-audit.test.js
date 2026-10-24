'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {display}=require('../../scripts/pi-gfx-readonly-audit.js');
const root=path.resolve(__dirname,'../..');
const worker=fs.readFileSync(path.join(root,'scripts/lib/pi-gfx-audit-worker.js'),'utf8');
const NOW=Date.now();
const keys=['battery','altitude','horizontalSpeed','heading','verticalSpeed',
  'attitudePitch','attitudeRoll','linkQuality'];
function device({connected=true,age=1000}={}){
  return {
    sn:'PRIVATE_AIRCRAFT_SERIAL',modelName:'PRIVATE_SESSION_LABEL',
    role:'subdevice',deviceCategory:'aircraft',
    model:{domain:'0',type:99,subType:1},aircraftConnected:connected,
    telemetry:{battery:78,altitude:11,horizontalSpeed:0,heading:270,
      verticalSpeed:0,attitudePitch:2,attitudeRoll:-4,linkQuality:4,
      latitude:51.1234,longitude:8.2345,accessToken:'PRIVATE_SECRET_TOKEN'},
    telemetryFieldAt:Object.fromEntries(keys.map(k=>[k,NOW-age])),
    telemetryFieldTimeVerified:Object.fromEntries(keys.map(k=>[k,true]))
  };
}
function execute(devices,{token=true,apiOk=true}={}){
  const bootstrap=`globalThis.fetch=async(url,options)=>{
    if(options.method!=='GET'||!url.endsWith('/api/devices'))throw Error('unexpected-request');
    return {ok:${apiOk},text:async()=>${JSON.stringify(JSON.stringify(devices))}};
  };\n`;
  return spawnSync(process.execPath,['-'],{
    cwd:path.join(root,'backend'),input:bootstrap+worker,
    encoding:'utf8',timeout:15000,
    env:{...process.env,SKYHUB_VIEW_TOKEN:token?'TEST_VIEW_ONLY_TOKEN':''}
  });
}
test('in-container worker reads only GET, prints valid bounded anonymized field status',()=>{
  const p=execute([device()]);
  assert.equal(p.status,0,p.stderr);
  const report=JSON.parse(p.stdout);
  assert.equal(report.schema,'skyhub-gfx-readonly-hardware-audit-v1');
  assert.equal(report.examined,1);
  assert.equal(report.truncated,false);
  assert.deepEqual(report.results[0].quality,{
    current:8,stale:0,unverified:0,unknown:0,missing:0
  });
  assert.equal(report.results[0].model,'Matrice 4T');
  assert.equal(report.results[0].compassDrawable,true);
  assert.equal(report.results[0].horizonDrawable,true);
  const txt=display(report);
  assert.match(txt,/aktuell=8/);
  for(const forbidden of ['PRIVATE','51.1234','8.2345','TEST_VIEW_ONLY_TOKEN','78,']){
    assert.doesNotMatch(p.stdout+txt,new RegExp(forbidden));
  }
});
test('disconnected or stale M4T is not claimed as current or drawable',()=>{
  for(const record of [device({connected:false}),device({age:25000})]){
    const p=execute([record]);
    assert.equal(p.status,0,p.stderr);
    const item=JSON.parse(p.stdout).results[0];
    assert.equal(item.quality.current,0);
    assert.equal(item.quality.stale,8);
    assert.equal(item.compassDrawable,false);
    assert.equal(item.horizonDrawable,false);
  }
});
test('empty snapshot fails closed rather than treating an idle Pi as ready',()=>{
  const p=execute([]);
  assert.equal(p.status,3);
  assert.equal(JSON.parse(p.stdout).examined,0);
  const noToken=execute([device()],{token:false});
  assert.equal(noToken.status,3);
  assert.equal(noToken.stdout,'');
  assert.doesNotMatch(noToken.stderr,/TOKEN.*TEST/);
});
test('audit is limited to 16 records and does not leak unlisted values',()=>{
  const p=execute(Array.from({length:19},()=>device()));
  assert.equal(p.status,0,p.stderr);
  const report=JSON.parse(p.stdout);
  assert.equal(report.examined,16);
  assert.equal(report.truncated,true);
  const tampered=structuredClone(report);
  tampered.results[0].fieldKinds.battery='PRIVATE_VALUE';
  assert.throws(()=>display(tampered));
  tampered.results[0].fieldKinds.battery='current';
  tampered.results[0].quality.current=20;
  assert.throws(()=>display(tampered));
});
test('host wrapper never accepts extra positional flags and is read-only by contract',()=>{
  const a=spawnSync(process.execPath,[path.join(root,'scripts/pi-gfx-readonly-audit.js'),'--help'],
    {encoding:'utf8'});
  assert.equal(a.status,0);
  assert.match(a.stdout,/Nur GET/);
  const b=spawnSync(process.execPath,[path.join(root,'scripts/pi-gfx-readonly-audit.js'),'--publish'],
    {encoding:'utf8'});
  assert.equal(b.status,2);
  assert.doesNotMatch(worker,/\b(?:publish|POST|PUT|PATCH|DELETE)\s*\(/);
  assert.match(worker,/\.slice\(0,16\)/);
});
