#!/usr/bin/env node
'use strict';
// Read-only Pi-side field availability check. No payloads, coordinates or IDs printed.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
if(process.argv.length!==2){
  if(process.argv.length===3 && process.argv[2]==='--help'){
    console.log('Nutzung: node scripts/pi-telemetry-fields-check.js');
    console.log('Nur empfangene Feldnamen, keine DJI-Kennungen oder Rohwerte.');
  }else{console.error('Unbekannte Parameter');process.exitCode=2;}
}else{
  const code=[
    "'use strict';",
    "(async()=>{",
    "const token=process.env.SKYHUB_VIEW_TOKEN;",
    "if(!token)throw Error('Backend token unavailable');",
    "const response=await fetch('http://127.0.0.1:4000/api/devices',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});",
    "if(!response.ok)throw Error('API HTTP '+response.status);",
    "const devices=await response.json();",
    "const fields=['latitude','longitude','altitude','heightEllipsoid','battery','heading','horizontalSpeed','verticalSpeed','attitudePitch','attitudeRoll','homeDistance','remainingFlightTime','gpsSatellites','rtkSatellites','rtkFixState','positionQuality','linkQuality'];",
    "console.log('=== DJI-Feldinventar – ohne Rohwerte ===');",
    "console.log('Beobachtete Geräte:',devices.length);",
    "for(const [index,d] of devices.entries()){",
    "const t=d.telemetry||{};",
    "const present=fields.filter(k=>Number.isFinite(t[k]));",
    "const missing=fields.filter(k=>!Number.isFinite(t[k]));",
    "const model=['DJI RC Pro Enterprise','Mavic 3M'].includes(d.modelName)?d.modelName:'anderes Gerät';",
    "console.log('Gerät '+(index+1)+' ('+model+')');",
    "console.log('OSD frisch:',d.fresh===true,'| GPS-Fix verfügbar:',d.positionFresh===true,'| Nullposition gemeldet:',d.positionUnavailable===true);",
    "console.log('Felder vorhanden ('+present.length+'): '+(present.join(', ')||'keine'));",
    "console.log('Felder nicht beobachtet ('+missing.length+'): '+(missing.join(', ')||'keine'));",
    "}",
    "console.log('Hinweis: Werte können aus früheren OSD-Paketen stammen. Keine Speicherung.');",
    "})().catch(e=>{console.error('Diagnose fehlgeschlagen:',e.message);process.exitCode=1;});"
  ].join('\n');
  const proc=spawnSync('docker',['compose','-p','skyhub-next','exec','-T','backend','node','-e',code],
    {cwd:path.resolve(__dirname,'..'),stdio:'inherit',timeout:20000});
  if(proc.error){console.error('Docker nicht erreichbar:',proc.error.code||'unbekannt');process.exitCode=1;}
  else if(proc.status!==0)process.exitCode=1;
}
