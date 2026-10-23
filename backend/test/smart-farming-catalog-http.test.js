'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
// The main server owns its auth middleware; avoid importing a draft-only helper.
const {createSmartFarmingCatalogRouter}=require('../smart-farming-catalog');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const secret='local-test-token-32-characters-01234';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'m3m-http-catalog-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const receipt='a1'.repeat(32), candidateId='m3m-exp-'+sha(Buffer.from(receipt,'hex')).slice(0,24);
  const indices=['ndvi','ndre','gndvi','osavi'].map(index=>({index,title:index.toUpperCase(),
    validPixels:5,mean:0.2,min:0.1,max:0.3,unit:'dimensionless',mapTilesAvailable:false}));
  const record={schema:'skyhub-m3m-smart-farming-candidate-v1',candidateId,
    state:'experimental_candidate',classification:'locally-verified-integrity-not-radiometric-validity',
    indexCount:4,indexLayers:indices,integrity:{receiptSha256:receipt,
      rasterQaPassedAtRegistration:true,sealedArtifactsMatched:11},
    cameraProvenanceVerified:false,radiometricCalibrationVerified:false,
    bandCoregistrationVerified:false,reflectanceReady:false,ndviReady:false,
    ndreReady:false,operationalUseAllowed:false,prescriptionExportAllowed:false,
    flightMissionAllowed:false,geolocationPublished:false,tileUrlsPublished:false,
    secretPath:'/sensitive/private/flight.tif'};
  fs.mkdirSync(path.join(root,'entries','test'),{recursive:true});
  const candidateData=JSON.stringify(record)+'\n';
  fs.writeFileSync(path.join(root,'entries','test','candidate.json'),candidateData);
  const manifest={schema:'skyhub-m3m-smart-farming-catalog-manifest-v1',
    entries:[{candidateId,slot:'test',candidateSha256:sha(candidateData)}]};
  const manifestPath=path.join(root,'catalog-manifest.json');
  const raw=JSON.stringify(manifest)+'\n';fs.writeFileSync(manifestPath,raw);
  return {root,candidateId,manifestPath,manifestSha256:sha(raw)};
}
async function serve(options,fn){
  const app=express();
  // Reproduce the main-server Bearer check only for this isolated HTTP
  // router test; the source wiring/lan allowlist is checked separately.
  const auth=(req,res,next)=>{
    const value=req.headers.authorization || '';
    const supplied=value.startsWith('Bearer ')?value.slice(7):'';
    const a=Buffer.from(supplied),b=Buffer.from(secret);
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b))
      return res.status(401).json({error:'Unauthorized'});
    next();
  };
  app.use('/api',auth); // same protection order as real SkyHub server
  app.use('/api/smart-farming/candidates',createSmartFarmingCatalogRouter({express,auth,...options}));
  const srv=app.listen(0,'127.0.0.1');
  try{
    await new Promise((resolve,reject)=>srv.listening?resolve():srv.once('listening',resolve).once('error',reject));
    await fn('http://127.0.0.1:'+srv.address().port);
  }finally{await new Promise(resolve=>srv.close(resolve))}
}
test('GET requires bearer token even when LAN view is permitted',async t=>{
  const cfg=fixture(t);
  await serve(cfg,async base=>{
    const url=base+'/api/smart-farming/candidates/';
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer wrong'}})).status,401);
    const valid=await fetch(url,{headers:{Authorization:'Bearer '+secret}});
    assert.equal(valid.status,200);
    assert.equal(valid.headers.get('cache-control'),'no-store');
    const body=await valid.json();
    assert.equal(body.count,1);
    assert.equal(body.candidates[0].candidateId,cfg.candidateId);
    assert.equal(body.candidates[0].rasterQaRecheckedAtRead,false);
    assert.equal(body.candidates[0].operationalUseAllowed,false);
    assert.equal(JSON.stringify(body).includes('sensitive/private'),false);
  });
});
test('individual lookup protected, no POST routes or arbitrary paths',async t=>{
  const cfg=fixture(t), headers={Authorization:'Bearer '+secret};
  await serve(cfg,async base=>{
    const url=base+'/api/smart-farming/candidates/';
    assert.equal((await fetch(url+cfg.candidateId,{headers})).status,200);
    assert.equal((await fetch(url+'m3m-exp-'+('0'.repeat(24)),{headers})).status,404);
    assert.equal((await fetch(url,{method:'POST',headers})).status,404);
  });
});
test('changed registry yields generic 503 without private paths',async t=>{
  const cfg=fixture(t), headers={Authorization:'Bearer '+secret};
  await serve(cfg,async base=>{
    fs.writeFileSync(cfg.manifestPath,'{}');
    const response=await fetch(base+'/api/smart-farming/candidates/',{headers});
    const body=await response.text();
    assert.equal(response.status,503);
    assert.equal(body.includes(cfg.root),false);
  });
});

test('main-server catalog mount is disabled by default and behind auth',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
  assert.match(src,/app\.use\('\/api',auth\);/);
  assert.match(src,/SKYHUB_M3M_CATALOG_ENABLED\s*===\s*'true'/);
  assert.match(src,/app\.use\('\/api\/smart-farming\/candidates'/);
  const outer=src.indexOf("app.use('/api',auth);");
  const inner=src.indexOf("app.use('/api/smart-farming/candidates'");
  assert.ok(outer>=0 && inner>outer);
  const prefix=src.slice(0,outer);
  assert.doesNotMatch(prefix,/smart-farming\/candidates/);
  // Main auth allowlist lives in http-auth.js, not in server.js.
  const httpAuth=fs.readFileSync(path.resolve(__dirname,'../http-auth.js'),'utf8');
  const allowed=httpAuth.match(/const lanReadPaths=new Set\(\[([^\]]*)\]/);
  assert.ok(allowed,'Explicit LAN-view route allowlist is mandatory');
  assert.doesNotMatch(allowed[1],/smart-farming|candidates/);
});
