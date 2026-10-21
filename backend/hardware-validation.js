'use strict';
// Offline, value-free evaluator for DJI RC Pro Enterprise + Mavic 3M.
// Input comes from existing, authorized read-only backend endpoints.
// Never print serial numbers, GPS coordinates, measurement values or secrets.
const {summarizeTelemetryFields}=require('./telemetry-field-profile');
const catalog=require('./data/dji-cloud-api-118-fields.json');
// Never echo unrecognized MQTT property keys: a producer can encode an ID
// or arbitrary secret as an object key. Show only documented root names.
const knownShapeKeys=new Set(['app_version','mode_code','sub_devices','domain',
  'type','sub_type','thing_version','list','data','timestamp','firmware_version']);
for(const p of Object.values(catalog.profiles)){
  for(const f of p.fields){
    if(!f.path.includes('.'))knownShapeKeys.add(f.path);
  }
}

const RC='2:144:0',M3M='0:77:2';
const keyOf=d=>d?.model&&[d.model.domain,d.model.type,d.model.subType].join(':');
const age=(at,now)=>Number.isFinite(at)&&at<=now?Math.round((now-at)/1000):null;
function statusLabel(valid,observed){
  return valid?'BESTÄTIGT':observed?'NICHT AKTUELL':'NICHT NACHGEWIESEN';
}
function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function hasPropertyDiagnostics(device){
  // Version gate: a previous backend can supply real topology, osd and
  // telemetry values, but not the 1.18 sanitized property snapshots.
  // Never interpret an absent interface as 0 out of N DJI fields.
  return isObject(device?.propertyProfile) &&
    typeof device.propertyProfile.name==='string' &&
    isObject(device.deviceProperties?.osd) &&
    isObject(device.deviceProperties?.state) &&
    isObject(device.propertyObservedAt) &&
    isObject(device.propertyFieldObservedAt?.osd) &&
    isObject(device.propertyFieldObservedAt?.state);
}
function deviceSummary(device,now){
  if(!device)return {seen:false,modelConfirmed:false,role:null,topologyOnline:null,
    osdFresh:false,osdAgeSeconds:null,stateObserved:false,stateAgeSeconds:null,
    propertyDiagnosticsAvailable:false,
    propertyFields:{documented:0,inspectable:null,observed:null,fresh:null,stale:null,
      missing:null,redacted:null,untyped:null,observedNames:[],freshNames:[]}};
  const capable=hasPropertyDiagnostics(device);
  const [audit]=summarizeTelemetryFields([device],now);
  const stateAge=capable?age(device.propertyObservedAt?.state,now):null;
  return {
    seen:true,modelConfirmed:true,
    role:device.role==='gateway'?'gateway':device.role==='subdevice'?'subdevice':'other',
    topologyOnline:device.topologyOnline===true,
    osdFresh:device.fresh===true&&age(device.lastTelemetryAt,now)!==null&&age(device.lastTelemetryAt,now)<15,
    osdAgeSeconds:age(device.lastTelemetryAt,now),
    stateObserved:stateAge!==null,
    stateAgeSeconds:stateAge,
    propertyDiagnosticsAvailable:capable,
    aircraftConnected:device.aircraftConnected===true,
    positionFixFresh:device.positionFresh===true,
    fieldProfileConfidence:device.propertyProfile?.confidence??null,
    propertyFields:{
      documented:audit.documentedTotal,
      inspectable:capable?audit.documentedInspectableTotal:null,
      observed:capable?audit.observedDocumented.length:null,
      fresh:capable?audit.freshDocumented.length:null,
      stale:capable?audit.staleDocumented.length:null,
      missing:capable?audit.notObservedDocumented.length:null,
      redacted:capable?audit.redactedDocumented.length:null,
      untyped:capable?audit.unsupportedDocumented.length:null,
      observedNames:capable?audit.observedDocumented.slice(0,60):[],
      freshNames:capable?audit.freshDocumented.slice(0,60):[]
    }
  };
}
function evaluateHardwareSession(devices,health,shapes,now=Date.now()){
  const list=Array.isArray(devices)?devices:[];
  const rc=list.find(d=>keyOf(d)===RC&&d.role==='gateway');
  const air=list.find(d=>keyOf(d)===M3M&&d.role==='subdevice');
  const linked=Boolean(rc&&air&&rc.sn&&air.gatewaySn===rc.sn&&
    Array.isArray(rc.children)&&rc.children.includes(air.sn));
  const counts=health?.mqttObservedChannelCounts??{};
  const shapeList=Array.isArray(shapes)?shapes:[];
  const shapeKeys=channel=>[...new Set(shapeList.filter(s=>s?.channel===channel)
    .flatMap(s=>Array.isArray(s.dataKeys)?s.dataKeys:[])
    .filter(k=>typeof k==='string'&&knownShapeKeys.has(k)))].sort().slice(0,70);
  const transport={
    mqttConnected:health?.mqtt===true,subscribed:health?.subscribed===true,
    ackEnabled:health?.topologyReplyEnabled===true,
    ackSent:Number.isSafeInteger(health?.topologyReplySent)?health.topologyReplySent:null,
    ackErrors:Number.isSafeInteger(health?.topologyReplyErrors)?health.topologyReplyErrors:null,
    osdPackets:Number.isSafeInteger(health?.mqttObservedOsdPackets)?health.mqttObservedOsdPackets:null,
    osdAccepted:Number.isSafeInteger(health?.mqttOsdMessages)?health.mqttOsdMessages:null,
    telemetryUpdates:Number.isSafeInteger(health?.mqttValidTelemetryUpdates)?health.mqttValidTelemetryUpdates:null,
    statusPackets:Number.isSafeInteger(counts.status)?counts.status:null,
    statePackets:Number.isSafeInteger(counts.state)?counts.state:null,
    osdShapeFields:shapeKeys('osd'),
    stateShapeFields:shapeKeys('state')
  };
  const controller=deviceSummary(rc,now);
  const aircraft=deviceSummary(air,now);
  const stateStatus=d=>
    !d.seen?'NICHT NACHGEWIESEN':
    !d.propertyDiagnosticsAvailable?'NICHT PRÜFBAR':
    statusLabel(d.stateObserved&&d.stateAgeSeconds<15,d.stateObserved);
  const stages=[
    {step:'DJI-MQTT verbunden und abonniert',status:statusLabel(transport.mqttConnected&&transport.subscribed,transport.mqttConnected)},
    {step:'RC Pro Enterprise per Topologie erkannt',status:statusLabel(controller.seen&&controller.topologyOnline,controller.seen)},
    {step:'Mavic 3M per Topologie erkannt',status:statusLabel(aircraft.seen&&aircraft.topologyOnline,aircraft.seen)},
    {step:'RC und M3M zugeordnet',status:statusLabel(linked,Boolean(rc&&air))},
    {step:'RC sendet aktuelle OSD-Telemetrie',status:statusLabel(controller.osdFresh,controller.osdAgeSeconds!==null)},
    {step:'M3M verbunden und mit aktueller OSD-Telemetrie',status:statusLabel(aircraft.aircraftConnected&&aircraft.osdFresh,aircraft.osdAgeSeconds!==null)},
    {step:'RC State-Feldbeobachtung vorhanden',status:stateStatus(controller)},
    {step:'M3M State-Feldbeobachtung vorhanden',status:stateStatus(aircraft)}
  ];
  return {target:'DJI RC Pro Enterprise + Mavic 3M',mode:'nur Lesen',
    transport,controller,aircraft,linked,stages,
    notes:[
      'MQTT- und Shape-Zähler gelten backendweit, nicht individuell für die RC/M3M.',
      'Nicht beobachtet ist kein Beweis für eine von DJI nicht unterstützte Eigenschaft.',
      'M3M (0:77:2) nutzt ein vorläufiges Mavic-3-Familienprofil.',
      'Ohne deviceProperties, propertyProfile und propertyFieldObservedAt kann der Container keine feldgenaue 1.18-Abnahme liefern.',
      'Ein Hardwaretest erfordert echte, zeitnahe Pilot-2-MQTT-Meldungen; synthetische Tests sind kein Ersatz.'
    ]};
}
function formatReport(r){
  const lines=[
    '=== RC Pro Enterprise + Mavic 3M – Hardwareabnahme (nur Lesen) ===',
    'MQTT verbunden: '+r.transport.mqttConnected+' | Abos bestätigt: '+r.transport.subscribed,
    'Topo-Antwort aktiv: '+r.transport.ackEnabled+' | gesendet: '+(r.transport.ackSent??'n/v')+
      ' | Fehler: '+(r.transport.ackErrors??'n/v'),
    'MQTT OSD beobachtet: '+(r.transport.osdPackets??'n/v')+
      ' | übernommen: '+(r.transport.osdAccepted??'n/v')+
      ' | verwertbare Telemetrie: '+(r.transport.telemetryUpdates??'n/v'),
    'Status-/State-Pakete (backendweit): '+(r.transport.statusPackets??'n/v')+' / '+(r.transport.statePackets??'n/v'),
    ...r.stages.map(x=>x.status.padEnd(17)+' '+x.step)
  ];
  for(const [title,d] of [['RC Pro Enterprise',r.controller],['Mavic 3M',r.aircraft]]){
    lines.push('--- '+title+' ---');
    if(!d.seen){lines.push('Gerät nicht in der aktuellen Topologie nachgewiesen');continue;}
    lines.push('OSD Alter (s): '+(d.osdAgeSeconds??'nicht beobachtet')+
      ' | State Alter (s): '+(d.stateAgeSeconds??'nicht beobachtet'));
    if(!d.propertyDiagnosticsAvailable){
      lines.push('Feldparser: NICHT PRÜFBAR (laufendes Backend stellt die DJI-1.18-Schnittstelle nicht bereit).');
      lines.push('Dokumentierte Pfade im Testkatalog: '+d.propertyFields.documented+
        ' | beobachtete/fehlende Pfade: nicht ermittelbar.');
      continue;
    }
    lines.push('Feldparser: verfügbar');
    lines.push('Dokumentierte Pfade: '+d.propertyFields.documented+
      ' | beobachtet: '+d.propertyFields.observed+
      ' | frisch: '+d.propertyFields.fresh+
      ' | veraltet: '+d.propertyFields.stale+
      ' | nicht beobachtet: '+d.propertyFields.missing);
    lines.push('Frische Feldnamen (max. 60): '+(d.propertyFields.freshNames.join(', ')||'keine'));
    lines.push('Beobachtete Feldnamen (max. 60): '+(d.propertyFields.observedNames.join(', ')||'keine'));
  }
  lines.push('Bekannte MQTT OSD-Rootfelder (backendweit): '+(r.transport.osdShapeFields.join(', ')||'keine'));
  lines.push('Bekannte MQTT State-Rootfelder (backendweit): '+(r.transport.stateShapeFields.join(', ')||'keine'));
  lines.push(...r.notes.map(x=>'Hinweis: '+x));
  lines.push('Keine Geräte-IDs, Koordinaten, Messwerte oder Zugangsdaten ausgegeben.');
  return lines.join('\n');
}
module.exports={evaluateHardwareSession,formatReport};
