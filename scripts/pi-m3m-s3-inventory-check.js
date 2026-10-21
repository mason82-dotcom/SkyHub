#!/usr/bin/env node
'use strict';
// Read-only Raspberry Pi test of the existing authenticated SkyHub media API.
// Runs inventory logic from this checkout, without deploying it to production.
// Object names flow only between the existing backend container and this
// parent process over bounded in-memory pipes, NEVER to terminal or disk.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {inventoryM3MFromS3,validatePrefix}=require('../backend/m3m-s3-inventory');

const FETCH_PAGE=String.raw`'use strict';
(async()=>{
  try{
    const req=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
    const token=process.env.SKYHUB_VIEW_TOKEN;
    if(!token||req.bucket!=='dji-cloud'||typeof req.prefix!=='string'||
       !Number.isInteger(req.limit)||req.limit<1||req.limit>200) {
      process.exitCode=1;return;
    }
    const url=new URL('http://127.0.0.1:4000/api/media/objects');
    url.searchParams.set('bucket','dji-cloud');
    url.searchParams.set('prefix',req.prefix);
    url.searchParams.set('limit',String(req.limit));
    if(req.cursor!==undefined)url.searchParams.set('cursor',req.cursor);
    const response=await fetch(url,{
      headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok){process.exitCode=2;return;}
    const json=await response.json();
    const output=JSON.stringify(json);
    if(output.length>300000){process.exitCode=3;return;}
    process.stdout.write(output);
  }catch(_){process.exitCode=4;}
})();`;

function createApiStorage(invoke){
  return {
    async objects(bucket,options){
      if(bucket!=='dji-cloud'||!options||typeof options.prefix!=='string')
        throw new Error('Unsupported inventory request');
      const page=await invoke({
        bucket,prefix:options.prefix,limit:options.limit,
        ...(options.cursor?{cursor:options.cursor}:{})
      });
      if(!page||!Array.isArray(page.objects))
        throw new Error('Invalid media API response');
      return page;
    }
  };
}

function piInvoker(composeDir){
  return async request=>{
    const p=spawnSync('docker',[
      'compose','-p','skyhub-next','exec','-T','backend',
      'node','-e',FETCH_PAGE
    ],{
      cwd:composeDir,encoding:'utf8',input:JSON.stringify(request),
      timeout:16000,maxBuffer:512*1024
    });
    if(p.error||p.status!==0||!p.stdout)
      throw new Error('Existing authenticated media API unavailable');
    try{return JSON.parse(p.stdout);}
    catch(_){throw new Error('Invalid media API response');}
  };
}
async function main(args){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/pi-m3m-s3-inventory-check.js --prefix missions/KNOWN-M3M-FOLDER/');
    console.log('Reads existing backend media API only; outputs aggregate counts, no filenames or S3 keys.');
    return;
  }
  if(args.length!==2||args[0]!=='--prefix')
    throw new Error('Invalid CLI arguments');
  const prefix=args[1];
  validatePrefix(prefix);
  const cwd=path.resolve(process.env.SKYHUB_COMPOSE_DIR||path.join(__dirname,'..'));
  const report=await inventoryM3MFromS3(
    createApiStorage(piInvoker(cwd)),prefix);
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module){
  main(process.argv.slice(2)).catch(()=>{
    // Never print paths, query parameters, object keys or exception details.
    console.error('M3M S3 inventory failed: check prefix, read-only media API and bounded pagination. No data changed.');
    process.exitCode=2;
  });
}
module.exports={createApiStorage,main};
