#!/usr/bin/env node
'use strict';
// Read-only Pi hardware diagnosis. Existing container is NOT rebuilt/restarted.
// Sensitive API data travels in an in-memory local stdout pipe, never printed.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {evaluateHardwareSession,formatReport}=require('../backend/hardware-validation');
if(process.argv.length!==2){
  if(process.argv.length===3&&process.argv[2]==='--help'){
    console.log('Nutzung: node scripts/pi-rc-pro-m3m-check.js');
    console.log('Nur Lesen: RC Pro Enterprise + Mavic 3M, Feldnamen und Status.');
    console.log('Keine Seriennummern, GPS-Koordinaten, Rohdaten oder Tokens.');
    console.log('Keine Containeränderung und kein Backend-Deployment erforderlich.');
  }else{
    console.error('Unbekannte Parameter. Verwende --help.');
    process.exitCode=2;
  }
}else{
  const code="'use strict';\n(async()=>{\n  const token=process.env.SKYHUB_VIEW_TOKEN;\n  if(!token){process.exitCode=1;return;}\n  async function get(uri,authorized){\n    const res=await fetch('http://127.0.0.1:4000'+uri,{\n      headers:authorized?{Authorization:'Bearer '+token}:{},\n      signal:AbortSignal.timeout(5000)\n    });\n    if(!res.ok)throw Error('api');\n    return res.json();\n  }\n  try{\n    const [health,devices,shapes,modelShapes]=await Promise.all([\n      get('/api/health',false),get('/api/devices',true),\n      get('/api/diagnostics/mqtt-shapes',true),\n      get('/api/diagnostics/mqtt-model-shapes',true).catch(()=>null)\n    ]);\n    // Values and device IDs stay solely in this bounded, local stdout pipe;\n    // the parent captures stdout and prints a sanitized summary only.\n    const data=JSON.stringify({health,devices,shapes,modelShapes});\n    if(data.length>3000000)throw Error('too-large');\n    process.stdout.write(data);\n  }catch(_){process.exitCode=1;}\n})();";
  const p=spawnSync('docker',
    ['compose','-p','skyhub-next','exec','-T','backend','node','-e',code],
    {cwd:process.env.SKYHUB_COMPOSE_DIR?path.resolve(process.env.SKYHUB_COMPOSE_DIR):path.resolve(__dirname,'..'),
      encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  if(p.error || p.status!==0 || !p.stdout){
    console.error('Hardwarecheck nicht möglich: bestehende Backend-APIs oder Docker prüfen.');
    process.exitCode=1;
  }else{
    try{
      const data=JSON.parse(p.stdout);
      const report=evaluateHardwareSession(data.devices,data.health,data.shapes,Date.now(),data.modelShapes);
      console.log(formatReport(report));
      if(!report.controller.seen||!report.aircraft.seen||!report.linked){
        console.log('Abnahme unvollständig: Ziel-Hardware nicht gemeinsam erkannt.');
        process.exitCode=3;
      }else if(!report.controller.osdFresh||!report.aircraft.osdFresh){
        console.log('Abnahme unvollständig: OSD-Werte nicht aktuell.');
        process.exitCode=3;
      }else if(!report.controller.propertyDiagnosticsAvailable||
               !report.aircraft.propertyDiagnosticsAvailable){
        console.log('Transporttest bestanden: beide Geräte senden Live-OSD.');
        console.log('Feldabnahme NICHT PRÜFBAR: auf dem Pi fehlen die DJI-1.18-Feldschnittstellen im laufenden Backend.');
        console.log('Kein Nachweis fehlender DJI-Hardwarefelder. Backend-Version vor separatem Update prüfen.');
        process.exitCode=3;
      }else{
        console.log('Topologie und OSD-Frische beider Geräte bestätigt; Feldparser für Einzelprüfung verfügbar.');
      }
    }catch(_){
      console.error('Hardwarecheck nicht möglich: Antwort nicht auswertbar.');
      process.exitCode=1;
    }
  }
}
