'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const cli=path.resolve(__dirname,'../../scripts/pi-rc-plus2-m4t-check.js');
const fakeDocker=String.raw`#!/usr/bin/env node
'use strict';
// Execute the real in-container read-only collector with a fake GET API.
// This fake is only created in a temporary test directory, never deployed.
const args=process.argv.slice(2);
const scriptIndex=args.indexOf('-e');
if(scriptIndex===-1 || !args[scriptIndex+1])process.exit(4);
process.env.SKYHUB_VIEW_TOKEN='SECRET_VIEW_TOKEN';
const data={
  '/api/health':{
    mqtt:true,subscribed:true,topologyReplyEnabled:true,
    topologyReplyConnected:true,privateKey:'SECRET_HEALTH'
  },
  '/api/devices':[{sn:'SECRET_DEVICE',latitude:49.123456,
    model:{domain:'2',type:174,subType:0}}],
  '/api/diagnostics/mqtt-shapes':[{channel:'osd',dataKeys:['SECRET_FIELD']}],
  '/api/pilot-admin/pairings':{
    devices:[{id:'SECRET_PAIRING',model:'DJI RC Plus 2',token:'SECRET_TOKEN'}],
    pending:[{code:'987654'}]
  }
};
globalThis.fetch=async url=>{
  const endpoint=new URL(url).pathname;
  const disabled=process.env.TEST_MISSING_PAIRINGS==='1'&&
    endpoint==='/api/pilot-admin/pairings';
  return {ok:!disabled,json:async()=>data[endpoint]};
};
eval(args[scriptIndex+1]);
`;
function executePreflight(broken=false){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyhub-hardware-preflight-'));
  try{
    const executable=path.join(dir,'docker');
    fs.writeFileSync(executable,fakeDocker,{mode:0o700});
    return spawnSync(process.execPath,[cli,'--preflight'],{
      cwd:dir,encoding:'utf8',timeout:10000,
      env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,
        SKYHUB_COMPOSE_DIR:dir,TEST_MISSING_PAIRINGS:broken?'1':'0'}
    });
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
test('preflight evaluates backend-only gates and exposes no private API data',()=>{
  const result=executePreflight();
  assert.equal(result.status,0,result.stderr+' '+result.stdout);
  assert.match(result.stdout,/Pi-Backend-Voraussetzungen: BEREIT/);
  assert.match(result.stdout,/Pairing-API \(nur GET\): JA/);
  assert.match(result.stdout,/Kein DJI-Gerätenachweis/);
  assert.doesNotMatch(result.stdout,/SECRET_|987654|49\.123456/);
});
test('unavailable read-only pairing endpoint is incomplete, not paired',()=>{
  const result=executePreflight(true);
  assert.equal(result.status,3,result.stderr+' '+result.stdout);
  assert.match(result.stdout,/Pairing-API \(nur GET\): NEIN/);
  assert.match(result.stdout,/Pi-Backend-Voraussetzungen: UNVOLLSTÄNDIG/);
  assert.doesNotMatch(result.stdout,/SECRET_|987654|49\.123456/);
});
