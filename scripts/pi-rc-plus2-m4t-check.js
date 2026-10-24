#!/usr/bin/env node
'use strict';
// Read-only validation of RC Plus 2 Enterprise + Matrice 4T against the
// already running SkyHub Next backend. No service restart and no MQTT publish.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {makePreflightEvidence,makeLiveEvidence}=
  require('../backend/rc-plus2-m4t-evidence');
const {evaluateHardwareSession,formatReport}=
  require('../backend/rc-plus2-m4t-hardware-validation');

function help(){
  console.log('Nutzung: node scripts/pi-rc-plus2-m4t-check.js [--preflight] [--json]');
  console.log('--json: streng begrenzter JSON-Prüfbeleg auf stdout, keine Dateien.');
  console.log('--preflight: ausschließlich Backend-APIs, MQTT und ACK prüfen; kein DJI-Gerät nötig.');
  console.log('Leseprüfung: RC Plus 2 Enterprise + Matrice 4T (DJI Cloud API 1.18).');
  console.log('Nur Modell, Topologie, Pairing-ANZAHLEN und dokumentierte Feldnamen.');
  console.log('Keine Seriennummern, Rohwerte, GPS-Koordinaten oder Tokens.');
  console.log('Bestehender Backend-Container wird weder neu gebaut noch gestartet.');
  console.log('SKYHUB_COMPOSE_DIR kann auf den bestehenden Compose-Ordner zeigen.');
  console.log('Exit 0: aktueller Hardware-Smoketest; 3: unvollständig; 1: API-Fehler; 2: Parameter.');
}
const args=process.argv.slice(2);
const preflight=args.includes('--preflight');
const json=args.includes('--json');
const valid=args.length<=2&&new Set(args).size===args.length&&
  args.every(a=>a==='--preflight'||a==='--json');
if(args.length===1&&args[0]==='--help'){
  help();
}else if(!valid){
  console.error('Ungültige Parameter. --help zeigt die sichere Nutzung.');
  process.exitCode=2;
}else{
  // This runs *inside* the already-running backend container. The view token
  // is read there, never forwarded to or printed by the host shell.
  const inside=String.raw`'use strict';
const PREFLIGHT=${preflight};
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
    const [health,devices,shapes,pairings]=await Promise.all([
      get('/api/health',false),get('/api/devices',true),
      get('/api/diagnostics/mqtt-shapes',true),
      get('/api/pilot-admin/pairings',true).catch(()=>null)
    ]);
    if(PREFLIGHT){
      // Preflight intentionally keeps full snapshots inside the container:
      // only a fixed, anonymized allowlist of booleans crosses stdout.
      const okObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
      const result={
        schema:'skyhub-rcplus2-m4t-preflight-v1',
        healthApi:okObject(health),
        devicesApi:Array.isArray(devices),
        shapesApi:Array.isArray(shapes),
        pairingsApi:okObject(pairings)&&Array.isArray(pairings.devices)&&
          Array.isArray(pairings.pending),
        mqttConnected:health?.mqtt===true,
        subscribed:health?.subscribed===true,
        topologyAckEnabled:health?.topologyReplyEnabled===true,
        topologyAckConnected:health?.topologyReplyConnected===true
      };
      process.stdout.write(JSON.stringify(result));
      return;
    }
    const payload=JSON.stringify({health,devices,shapes,pairings});
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
      if(preflight){
        const keys=['healthApi','devicesApi','shapesApi','pairingsApi',
          'mqttConnected','subscribed','topologyAckEnabled','topologyAckConnected'];
        if(data?.schema!=='skyhub-rcplus2-m4t-preflight-v1'||
            keys.some(k=>typeof data[k]!=='boolean')){
          throw Error('unrecognized preflight reply');
        }
        const ready=keys.every(k=>data[k]===true);
        if(json){
          console.log(JSON.stringify(makePreflightEvidence(data)));
        }else{
          console.log('=== RC Plus 2/M4T – nur lesender Pi-Backend-Preflight ===');
          for(const [key,label] of [
            ['healthApi','Health-API'],['devicesApi','Devices-API'],
            ['shapesApi','MQTT-Shapes-API'],['pairingsApi','Pairing-API (nur GET)'],
            ['mqttConnected','MQTT verbunden'],['subscribed','MQTT abonniert'],
            ['topologyAckEnabled','Topologie-ACK aktiviert'],
            ['topologyAckConnected','Topologie-ACK-Publisher verbunden']
          ]){
            console.log(label+': '+(data[key]?'JA':'NEIN'));
          }
          console.log('Pi-Backend-Voraussetzungen: '+(ready?'BEREIT':'UNVOLLSTÄNDIG'));
          console.log('Kein DJI-Gerätenachweis, keine Hardware- oder Flugfreigabe.');
        }
        process.exitCode=ready?0:3;
      }else{
        const report=evaluateHardwareSession(data.devices,data.health,data.shapes,
          Date.now(),data.pairings);
        console.log(json?JSON.stringify(makeLiveEvidence(report)):
          formatReport(report));
        process.exitCode=report.passed?0:3;
      }
    }catch(_){
      console.error('Hardwarecheck fehlgeschlagen: Backend-Antwort nicht auswertbar.');
      process.exitCode=1;
    }
  }
}
