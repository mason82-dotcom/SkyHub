#!/usr/bin/env node
'use strict';
// Read-only Pi hardware diagnosis; no restart, MQTT subscription or writes.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
if(process.argv.length!==2){
  if(process.argv.length===3&&process.argv[2]==='--help'){
    console.log('Nutzung: node scripts/pi-rc-pro-m3m-check.js');
    console.log('Nur Lesen: RC Pro Enterprise + Mavic 3M, Feldnamen und Status.');
    console.log('Keine Seriennummern, GPS-Koordinaten, Rohdaten oder Tokens.');
  }else{
    console.error('Unbekannte Parameter. Verwende --help.');
    process.exitCode=2;
  }
}else{
  const code="'use strict';\nconst {evaluateHardwareSession,formatReport}=require('./hardware-validation');\n(async()=>{\n  const token=process.env.SKYHUB_VIEW_TOKEN;\n  if(!token){console.error('Hardwarecheck: View-Token im Backend fehlt.');process.exitCode=1;return;}\n  async function get(uri,authorized){\n    const res=await fetch('http://127.0.0.1:4000'+uri,{\n      headers:authorized?{Authorization:'Bearer '+token}:{},\n      signal:AbortSignal.timeout(5000)\n    });\n    if(!res.ok)throw Error('api');\n    return res.json();\n  }\n  try{\n    const [health,devices,shapes]=await Promise.all([\n      get('/api/health',false),get('/api/devices',true),\n      get('/api/diagnostics/mqtt-shapes',true)\n    ]);\n    const report=evaluateHardwareSession(devices,health,shapes);\n    console.log(formatReport(report));\n    if(!report.controller.seen||!report.aircraft.seen||!report.linked){\n      console.log('Abnahme unvollständig: Ziel-Hardware nicht gemeinsam erkannt.');\n      process.exitCode=3;\n    }else if(!report.controller.osdFresh||!report.aircraft.osdFresh){\n      console.log('Abnahme unvollständig: OSD-Werte nicht aktuell.');\n      process.exitCode=3;\n    }else{\n      console.log('Topologie und OSD-Frische beider Geräte bestätigt.');\n    }\n  }catch(_){\n    console.error('Hardwarecheck nicht möglich: Backend-API/Timeout prüfen. Keine Details oder Zugangsdaten ausgegeben.');\n    process.exitCode=1;\n  }\n})();";
  const p=spawnSync('docker',
    ['compose','-p','skyhub-next','exec','-T','backend','node','-e',code],
    {cwd:path.resolve(__dirname,'..'),stdio:'inherit',timeout:30000});
  if(p.error){
    console.error('Docker-Ausführung fehlgeschlagen.');
    process.exitCode=1;
  }else if(p.status!==0){
    process.exitCode=p.status??1;
  }
}
