'use strict';
// Browser/Node helper: overall OSD freshness does not refresh individual fields.
(function(root){
  const CURRENT_MS=15000;
  function ago(ms){
    const s=Math.max(0,Math.floor(ms/1000));
    if(s<60)return 'vor '+s+' s';
    if(s<3600)return 'vor '+Math.floor(s/60)+' min';
    if(s<86400)return 'vor '+Math.floor(s/3600)+' h';
    return 'vor '+Math.floor(s/86400)+' Tagen';
  }
  function evaluateField(device,key,now=Date.now()){
    const d=device||{},t=d.telemetry||{};
    if(!Number.isFinite(t[key]))return {kind:'missing',text:'Nicht empfangen'};
    const at=d.telemetryFieldAt?.[key];
    if(!Number.isFinite(at)||at>now)return {kind:'unknown',text:'Zeitpunkt nicht bekannt'};
    const age=ago(now-at);
    if((key==='latitude'||key==='longitude')&&d.positionUnavailable===true)
      return {kind:'unavailable',text:'Letzter Fix · DJI meldet (0/0) · '+age};
    const verified=d.telemetryFieldTimeVerified?.[key]===true;
    if(d.aircraftConnected===false)
      return {kind:'stale',text:'Fluggerät getrennt · '+age};
    if(now-at>=CURRENT_MS)
      return {kind:'stale',text:'Veraltet · '+age+(verified?'':' · Zeit ungeprüft')};
    if(!verified)return {kind:'unverified',text:'Zeit ungeprüft · '+age};
    return {kind:'current',text:'Aktuell · '+age};
  }
  const api=Object.freeze({CURRENT_MS,evaluateField});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SkyHubTelemetryFreshness=api;
})(typeof window==='object'?window:null);
