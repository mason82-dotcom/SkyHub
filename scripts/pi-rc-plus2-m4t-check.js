#!/usr/bin/env node
'use strict';
// Read-only validation of RC Plus 2 Enterprise + Matrice 4T against the
// already running SkyHub Next backend. No service restart and no MQTT publish.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {evaluateHardwareSession,formatReport}=
  require('../backend/rc-plus2-m4t-hardware-validation');

function help(){
  console.log('Nutzung: node scripts/pi-rc-plus2-m4t-check.js');
  console.log('Leseprüfung: RC Plus 2 Enterprise + Matrice 4T (DJI Cloud API 1.18).');
  console.log('Nur Modell, Topologie, Status und dokumentierte Feldnamen.');
  console.log('Keine Seriennummern, Rohwerte, GPS-Koordinaten oder Tokens.');
  console.log('Bestehender Backend-Container wird weder neu gebaut noch gestartet.');
  console.log('SKYHUB_COMPOSE_DIR kann auf den bestehenden Compose-Ordner zeigen.');
  console.log('Exit 0: aktueller Hardware-Smoketest; 3: unvollständig; 1: API-Fehler; 2: Parameter.');
}
if(process.argv.length===3&&process.argv[2]==='--help'){
  help();
}else if(process.argv.length!==2){
  console.error('Ungültige Parameter. --help zeigt die sichere Nutzung.');
  process.exitCode=2;
}else{
  // This runs *inside* the already-running backend container. The view token
  // is read there, never forwarded to or printed by the host shell.
  const inside=String.raw`'use strict';
(async()=>{
  const token=process.env.SKYHUB_VIEW_TOKEN;
  if(!token){process.exitCode=1;return;}
  async function get(uri,authorized){
    const res=await fetch('http://127.0.0.1:4000'+uri,{
      headers:authorized?{Authorization:'Bearer '+token}:{},
      signal:AbortSignal.timeout(5000)
    });
    if(!res.ok)throw Error('request rejected');
    return res.json();
  }
  try{
    const [health,devices,shapes]=await Promise.all([
      get('/api/health',false),get('/api/devices',true),
      get('/api/diagnostics/mqtt-shapes',true)
    ]);
    const payload=JSON.stringify({health,devices,shapes});
    if(payload.length>3000000)throw Error('response too large');
    process.stdout.write(payload);
  }catch(_){process.exitCode=1;}
})();`;
  const composeDir=process.env.SKYHUB_COMPOSE_DIR?
    path.resolve(process.env.SKYHUB_COMPOSE_DIR):path.resolve(__dirname,'..');
  const exec=spawnSync('docker',
    ['compose','-p','skyhub-next','exec','-T','backend','node','-e',inside],
    {cwd:composeDir,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  if(exec.error||exec.status!==0||!exec.stdout){
    console.error('Hardwarecheck fehlgeschlagen: Docker/Backend oder geschützte GET-APIs prüfen.');
    process.exitCode=1;
  }else{
    try{
      const data=JSON.parse(exec.stdout);
      const report=evaluateHardwareSession(data.devices,data.health,data.shapes);
      console.log(formatReport(report));
      process.exitCode=report.passed?0:3;
    }catch(_){
      console.error('Hardwarecheck fehlgeschlagen: Backend-Antwort nicht auswertbar.');
      process.exitCode=1;
    }
  }
}
