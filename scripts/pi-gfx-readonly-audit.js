#!/usr/bin/env node
'use strict';
// Host wrapper: never starts/restarts containers or prints raw backend JSON.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const SCHEMA='skyhub-gfx-readonly-hardware-audit-v1';
const KEY_ORDER=['battery','altitude','horizontalSpeed','heading','verticalSpeed',
  'attitudePitch','attitudeRoll','linkQuality'];
const KINDS=['current','stale','unverified','unknown','missing'];
const MODELS=['Matrice 4T','RC Plus 2 Enterprise','Anderes/unklares Modell'];
const ROLES=['Gateway','Fluggerät','Andere Rolle'];
function display(report){
  if(!report||report.schema!==SCHEMA||
     report.classification!=='field-status-only-no-flight-authority'||
     !Number.isInteger(report.examined)||report.examined<0||report.examined>16||
     !Array.isArray(report.results)||report.results.length!==report.examined||
     typeof report.truncated!=='boolean')throw Error('report');
  const lines=['SKY//PULSE · Live-OSD-Feldabnahme (nur lesend)',
    'Prüfung: acht Instrumentenfelder · Feldstatus, keine Messwerte oder Kennungen',
    'Geprüfte Geräte: '+report.examined+(report.truncated?' · auf 16 begrenzt':'')];
  for(const [i,d] of report.results.entries()){
    if(!d||d.slot!==i+1||!MODELS.includes(d.model)||!ROLES.includes(d.role)||
       typeof d.compassDrawable!=='boolean'||typeof d.horizonDrawable!=='boolean'||
       !d.quality||!d.fieldKinds)throw Error('device');
    let total=0;
    for(const kind of KINDS){
      if(!Number.isInteger(d.quality[kind])||d.quality[kind]<0||
         d.quality[kind]>8)throw Error('count');
      total+=d.quality[kind];
    }
    if(total!==8||Object.keys(d.fieldKinds).length!==8||
       KEY_ORDER.some(key=>!KINDS.includes(d.fieldKinds[key]))||
       KINDS.some(kind=>KEY_ORDER.filter(k=>d.fieldKinds[k]===kind).length!==d.quality[kind]))
      throw Error('field counts');
    lines.push('Gerät '+d.slot+' · '+d.model+' · '+d.role,
      '  aktuell='+d.quality.current+' veraltet='+d.quality.stale+
      ' ungeprüft='+d.quality.unverified+' unbekannt='+d.quality.unknown+
      ' fehlend='+d.quality.missing);
    lines.push('  Feldstatus: '+KEY_ORDER.map(k=>k+'='+d.fieldKinds[k]).join(', '));
    lines.push('  Kursrose sichtbar: '+(d.compassDrawable?'ja':'nein')+
      ' · schematischer Horizont sichtbar: '+(d.horizonDrawable?'ja':'nein'));
  }
  lines.push('Kein Nachweis von Flugbereitschaft, DJI-Verbindung oder Paketverlust.');
  return lines.join('\n');
}
function usage(){
  console.log('Nutzung: node scripts/pi-gfx-readonly-audit.js');
  console.log('Nur GET /api/devices im vorhandenen Backend; Docker-Container werden nicht verändert.');
  console.log('Benötigt das auf dem laufenden Backend-Image enthaltene GFX-Cockpit.');
  console.log('SKYHUB_COMPOSE_DIR optional: bestehender SkyHub-Next Compose-Ordner.');
  console.log('Exit 0: Fluggerät-Snapshot geprüft; 3: nicht nachgewiesen; 1: Infrastruktur/Format; 2: Aufruf.');
  console.log('Nur Feldstatus und feste Modellklassen; keine Kennungen, Tokens, GPS- oder Rohwerte.');
}
function main(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){usage();return 0;}
  if(args.length){console.error('Ungültiger Aufruf; --help für lesende Prüfung.');return 2;}
  const composeDir=process.env.SKYHUB_COMPOSE_DIR?
    path.resolve(process.env.SKYHUB_COMPOSE_DIR):path.resolve(__dirname,'..');
  const worker=fs.readFileSync(path.join(__dirname,'lib/pi-gfx-audit-worker.js'),'utf8');
  const proc=spawnSync('docker',
    ['compose','-p','skyhub-next','exec','-T','backend','node','-'],
    {cwd:composeDir,input:worker,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(proc.error||!([0,3].includes(proc.status))||!proc.stdout){
    console.error('Abnahme nicht abgeschlossen: Backend erreichbar und GFX-Image-Version prüfen.');
    return proc.status===3?3:1;
  }
  try{
    const report=JSON.parse(proc.stdout);
    console.log(display(report));
    return proc.status===3?3:0;
  }catch(_){
    console.error('Abnahme nicht abgeschlossen: geschützte Backend-Antwort ungültig.');
    return 1;
  }
}
if(require.main===module)process.exitCode=main();
module.exports={display,main};
