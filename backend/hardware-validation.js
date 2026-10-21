'use strict';
// Offline, value-free evaluator for DJI RC Pro Enterprise + Mavic 3M.
// Input comes from existing, authorized read-only backend endpoints.
// Never print serial numbers, GPS coordinates, measurement values or secrets.
const {summarizeTelemetryFields}=require('./telemetry-field-profile');

const RC='2:144:0',M3M='0:77:2';
const keyOf=d=>d?.model&&[d.model.domain,d.model.type,d.model.subType].join(':');
const age=(at,now)=>Number.isFinite(at)&&at<=now?Math.round((now-at)/1000):null;
function statusLabel(valid,observed){
  return valid?'BESTÄTIGT':observed?'NICHT AKTUELL':'NICHT NACHGEWIESEN';
}
function deviceSummary(device,now){
  if(!device)return {seen:false,modelConfirmed:false,role:null,topologyOnline:null,
    osdFresh:false,osdAgeSeconds:null,stateObserved:false,stateAgeSeconds:null,
    propertyFields:{documented:0,inspectable:0,observed:0,fresh:0,stale:0,
      missing:0,redacted:0,untyped:0,observedNames:[],freshNames:[]}};
  const [audit]=summarizeTelemetryFields([device],now);
  const stateAge=age(device.propertyObservedAt?.state,now);
  return {
    seen:true,modelConfirmed:true,
    role:device.role==='gateway'?'gateway':device.role==='subdevice'?'subdevice':'other',
    topologyOnline:device.topologyOnline===true,
    osdFresh:device.fresh===true&&age(device.lastTelemetryAt,now)!==null&&age(device.lastTelemetryAt,now)<15,
    osdAgeSeconds:age(device.lastTelemetryAt,now),
    stateObserved:stateAge!==null,
    stateAgeSeconds:stateAge,
    aircraftConnected:device.aircraftConnected===true,
    positionFixFresh:device.positionFresh===true,
    fieldProfileConfidence:device.propertyProfile?.confidence??null,
    propertyFields:{
      documented:audit.documentedTotal,inspectable:audit.documentedInspectableTotal,
      observed:audit.observedDocumented.length,
      fresh:audit.freshDocumented.length,
      stale:audit.staleDocumented.length,
      missing:audit.notObservedDocumented.length,
      redacted:audit.redactedDocumented.length,
      untyped:audit.unsupportedDocumented.length,
      observedNames:audit.observedDocumented.slice(0,60),
      freshNames:audit.freshDocumented.slice(0,60)
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
    .filter(k=>typeof k==='string'&&/^[a-zA-Z0-9_]{1,48}$/.test(k)))].sort().slice(0,70);
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
  const stages=[
    {step:'DJI-MQTT verbunden und abonniert',status:statusLabel(transport.mqttConnected&&transport.subscribed,transport.mqttConnected)},
    {step:'RC Pro Enterprise per Topologie erkannt',status:statusLabel(controller.seen&&controller.topologyOnline,controller.seen)},
    {step:'Mavic 3M per Topologie erkannt',status:statusLabel(aircraft.seen&&aircraft.topologyOnline,aircraft.seen)},
    {step:'RC und M3M zugeordnet',status:statusLabel(linked,Boolean(rc&&air))},
    {step:'RC sendet aktuelle OSD-Telemetrie',status:statusLabel(controller.osdFresh,controller.osdAgeSeconds!==null)},
    {step:'M3M verbunden und mit aktueller OSD-Telemetrie',status:statusLabel(aircraft.aircraftConnected&&aircraft.osdFresh,aircraft.osdAgeSeconds!==null)},
    {step:'RC State-Feldbeobachtung vorhanden',status:statusLabel(controller.stateObserved&&controller.stateAgeSeconds<15,controller.stateObserved)},
    {step:'M3M State-Feldbeobachtung vorhanden',status:statusLabel(aircraft.stateObserved&&aircraft.stateAgeSeconds<15,aircraft.stateObserved)}
  ];
  return {target:'DJI RC Pro Enterprise + Mavic 3M',mode:'nur Lesen',
    transport,controller,aircraft,linked,stages,
    notes:[
      'MQTT- und Shape-Zähler gelten backendweit, nicht individuell für die RC/M3M.',
      'Nicht beobachtet ist kein Beweis für eine von DJI nicht unterstützte Eigenschaft.',
      'M3M (0:77:2) nutzt ein vorläufiges Mavic-3-Familienprofil.',
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
