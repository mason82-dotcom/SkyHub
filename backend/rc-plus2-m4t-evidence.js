'use strict';

// Deliberately restrictive projection for a *local* read-only diagnosis.
// No serials, pairing records, packet payloads, model user-agent strings,
// device coordinates or arbitrary upstream field names are transferred.
const SCHEMA='skyhub-rcplus2-m4t-evidence-v1';
const PREFLIGHT_KEYS=[
  'healthApi','devicesApi','shapesApi','pairingsApi','mqttConnected',
  'subscribed','topologyAckEnabled','topologyAckConnected'
];

function measuredAtISOString(date){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime())){
    throw new TypeError('invalid measurement time');
  }
  return date.toISOString();
}
function boundedCount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1000?value:null;
}
function receiptBase(mode,date){
  return {
    schema:SCHEMA,mode,
    measuredAt:measuredAtISOString(date),
    measurementClock:'diagnostic-host',
    classification:'read-only-diagnostic-not-hardware-certification',
    hardwareAcceptanceComplete:false,
    flightReady:false,
    dispatchAllowed:false
  };
}
function makePreflightEvidence(snapshot,date=new Date()){
  if(snapshot?.schema!=='skyhub-rcplus2-m4t-preflight-v1'||
      PREFLIGHT_KEYS.some(key=>typeof snapshot[key]!=='boolean')){
    throw new TypeError('invalid preflight response');
  }
  const checks=Object.fromEntries(PREFLIGHT_KEYS.map(key=>[key,snapshot[key]]));
  return {
    ...receiptBase('backend-preflight',date),
    result:PREFLIGHT_KEYS.every(key=>checks[key])?'READY':'INCOMPLETE',
    checks
  };
}
function summarizeDevice(device,includeAircraft){
  // Always return explicit null (not fabricated zero) for unsupported profiles.
  const fields=device?.fieldInterface===true?device.fields:null;
  const summary={
    seen:device?.seen===true,
    topologyOnline:device?.topologyOnline===true,
    osdFresh:device?.osdFresh===true,
    osdAgeSeconds:boundedCount(device?.osdAgeSeconds),
    stateObserved:device?.stateObserved===true,
    fieldInterface:device?.fieldInterface===true,
    staticFieldsDocumented:boundedCount(fields?.documented),
    staticFieldsObserved:boundedCount(fields?.observed),
    staticFieldsFresh:boundedCount(fields?.fresh)
  };
  if(includeAircraft){
    summary.aircraftConnected=device?.aircraftConnected===true;
    summary.dynamicGimbalTypesObserved=boundedCount(
      device?.fieldInterface===true?device?.dynamicFields?.observed:null);
  }
  return summary;
}
function makeLiveEvidence(report,date=new Date()){
  if(!report||typeof report.passed!=='boolean'||
      typeof report.transportPassed!=='boolean'||
      typeof report.pairingConfirmed!=='boolean'||
      !report.transport||!report.controller||!report.aircraft){
    throw new TypeError('invalid transport report');
  }
  return {
    ...receiptBase('live-transport-smoke',date),
    result:report.passed?'TRANSPORT_SMOKE_OK':'INCOMPLETE',
    transport:{
      mqttConnected:report.transport.mqttConnected===true,
      subscribed:report.transport.subscribed===true,
      topologyAckEnabled:report.transport.topologyAckEnabled===true,
      topologyAckConnected:report.transport.topologyAckConnected===true,
      transportPassed:report.transportPassed===true
    },
    pairing:{
      listingAvailable:report.pairing?.available===true,
      rcPlus2Registered:(report.pairing?.rcPlus2Paired??0)>0,
      rcPlus2RecentlyUsed:(report.pairing?.rcPlus2RecentlyUsed??0)>0,
      independentlyConfirmed:report.pairingConfirmed===true
    },
    linkedPairs:boundedCount(report.candidateCount?.linkedPairs),
    controller:summarizeDevice(report.controller,false),
    aircraft:summarizeDevice(report.aircraft,true)
  };
}
module.exports={makePreflightEvidence,makeLiveEvidence};
