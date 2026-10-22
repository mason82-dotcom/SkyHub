'use strict';
/* Pure read-only view model. No synthetic OSD data or network side effects. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SkyHubCommandCenterCore=api;
})(typeof window!=='undefined'?window:null,function(){
  const OSD_MAX_AGE=15000,HMS_MAX_AGE=30000;
  function isFresh(at,now=Date.now(),windowMs=OSD_MAX_AGE){
    return Number.isFinite(at)&&at>0&&now>=at&&now-at<windowMs;
  }
  function knownPosition(d){
    const t=d&&d.telemetry||{};
    const lat=t.latitude,lon=t.longitude;
    if(d?.positionUnavailable===true||
      !Number.isFinite(lat)||!Number.isFinite(lon)||
      Math.abs(lat)>90||Math.abs(lon)>180||
      (lat===0&&lon===0)||!Number.isFinite(d?.lastPositionAt)){
      return null;
    }
    return {lat,lon};
  }
  function metric(d,key,unit='',now=Date.now()){
    const t=d&&d.telemetry||{};
    const value=t[key];
    const seen=d?.telemetryFieldAt?.[key];
    if(!Number.isFinite(value)||!Number.isFinite(seen))return {value:'—',state:'unavailable'};
    const state=d.aircraftConnected===false?'stale':
      isFresh(seen,now)?d?.telemetryFieldTimeVerified?.[key]===false?'time-unverified':'fresh':'stale';
    return {value:(Math.round(value*100)/100).toLocaleString('de-DE')+unit,state};
  }
  function hmsAlerts(d,now=Date.now()){
    return isFresh(d?.lastHmsAt,now,HMS_MAX_AGE)&&Array.isArray(d?.hms)?d.hms:[];
  }
  function summarize(devices,now=Date.now()){
    const list=Array.isArray(devices)?devices.filter(d=>d&&typeof d==='object'):[];
    const live=list.filter(d=>d.aircraftConnected!==false&&isFresh(d.lastTelemetryAt,now));
    return {devices:list.length,live:live.length,warnings:list.reduce((n,d)=>n+
      hmsAlerts(d,now).filter(a=>a?.level===2).length,0)};
  }
  function deviceState(d,now=Date.now()){
    if(d?.aircraftConnected===false)return 'Fluggerät nicht verbunden';
    if(!isFresh(d?.lastTelemetryAt,now))return 'Keine aktuelle OSD-Telemetrie';
    if(d?.telemetryTimeVerified===false)return 'OSD empfangen · Zeit ungeprüft';
    return 'OSD aktuell';
  }
  return Object.freeze({isFresh,knownPosition,metric,hmsAlerts,summarize,deviceState});
});
