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
    "const {summarizeTelemetryFields}=require('./telemetry-field-profile');",
    "(async()=>{",
    "const token=process.env.SKYHUB_VIEW_TOKEN;",
    "if(!token)throw Error('Backend token unavailable');",
    "const response=await fetch('http://127.0.0.1:4000/api/devices',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});",
    "if(!response.ok)throw Error('API HTTP '+response.status);",
    "const devices=await response.json();",
    "const report=summarizeTelemetryFields(devices);",
    "console.log('=== DJI-Feldinventar – nach Gerätetyp (nur Lesen) ===');",
    "console.log('Beobachtete Geräte:',report.length);",
    "for(const d of report){",
    "console.log('Gerät '+d.index+' ('+d.model+', '+d.role+')');",
    "console.log('OSD frisch:',d.osdFresh,'| GPS-Fix verfügbar:',d.positionFresh,'| Nullposition:',d.positionUnavailable);",
    "console.log('Typische Felder vorhanden ('+d.observed.length+'/'+d.typicalTotal+'): '+(d.observed.join(', ')||'keine'));",
    "console.log('Typische Felder nicht beobachtet ('+d.notObserved.length+'): '+(d.notObserved.join(', ')||'keine'));",
    "console.log('Weitere optionale Felder vorhanden ('+d.extraObserved.length+'): '+(d.extraObserved.join(', ')||'keine'));",
    "console.log('Weitere optionale Felder nicht beobachtet ('+d.extraNotObserved.length+'): '+(d.extraNotObserved.join(', ')||'keine'));",
    "console.log('Für Gerätetyp nicht anwendbar ('+d.notApplicable.length+'): '+(d.notApplicable.join(', ')||'keine'));",
    "}",
    "console.log('Feldverfügbarkeit ist kein Nachweis für einen aktuellen GNSS-Fix oder Einzelwert-Frische.');",
    "console.log('Keine Speicherung, keine Kennungen, Koordinaten oder Rohmesswerte.');",
    "})().catch(e=>{console.error('Diagnose fehlgeschlagen:',e.message);process.exitCode=1;});"
  ].join('\n');
  const proc=spawnSync('docker',['compose','-p','skyhub-next','exec','-T','backend','node','-e',code],
    {cwd:path.resolve(__dirname,'..'),stdio:'inherit',timeout:20000});
  if(proc.error){console.error('Docker nicht erreichbar:',proc.error.code||'unbekannt');process.exitCode=1;}
  else if(proc.status!==0)process.exitCode=1;
}
