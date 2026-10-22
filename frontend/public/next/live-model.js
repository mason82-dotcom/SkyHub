'use strict';
// SkyHub NEXT dashboard: pure view model for live SkyHub data (browser and Node tests).
// No DOM and no network here. Unknown values stay "—"; nothing is invented from absent data.
(function(root){
  const CURRENT_MS=15000;
  const HMS_FRESH_MS=30000;
  const DASH='—';
  // DJI position_state.is_fixed (aircraft property reference).
  const RTK_FIX={0:'nicht gestartet',1:'Fix läuft',2:'Fix erfolgreich',3:'Fix fehlgeschlagen'};
  const HMS_LEVEL=['Hinweis','Achtung','Warnung'];

  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function num(v,suffix='',digits=2){
    if(!finite(v))return DASH;
    const factor=10**digits;
    return String(Math.round(v*factor)/factor).replace('.',',')+suffix;
  }
  function ago(ms){
    if(!finite(ms))return DASH;
    const s=Math.max(0,Math.floor(ms/1000));
    if(s<60)return 'vor '+s+' s';
    if(s<3600)return 'vor '+Math.floor(s/60)+' min';
    if(s<86400)return 'vor '+Math.floor(s/3600)+' h';
    return 'vor '+Math.floor(s/86400)+' Tagen';
  }
  function isFresh(at,now){return finite(at)&&at<=now&&now-at<CURRENT_MS;}

  function deviceName(d){
    return d&&typeof d.modelName==='string'&&d.modelName?d.modelName:'Unbekanntes Gerät';
  }
  function roleLabel(d){
    if(!d)return DASH;
    if(d.role==='gateway')return 'Fernsteuerung (Gateway)';
    if(d.deviceCategory==='aircraft')return 'Fluggerät';
    if(d.deviceCategory==='dock')return 'Dock';
    return d.role==='subdevice'?'Untergerät':'Rolle unbekannt';
  }
  // Same rules as the existing dashboard: OSD freshness, explicit aircraft disconnect.
  function deviceStatus(d,now=Date.now()){
    if(!d)return {kind:'unknown',text:'Unbekannt'};
    if(d.aircraftConnected===false)return {kind:'disconnected',text:'Fluggerät nicht verbunden'};
    if(isFresh(d.lastTelemetryAt,now)){
      return d.telemetryTimeVerified===false?{kind:'live',text:'OSD empfangen · Zeit ungeprüft'}:
        {kind:'live',text:'OSD frisch'};
    }
    if(finite(d.lastTelemetryAt))return {kind:'stale',text:'OSD veraltet · '+ago(now-d.lastTelemetryAt)};
    if(d.topologyOnline===true)return {kind:'stale',text:'Topologie gemeldet · kein OSD'};
    return {kind:'unknown',text:'Noch keine Daten'};
  }
  function hasPosition(d,now=Date.now()){
    const t=d&&d.telemetry||{};
    return Boolean(d)&&d.positionUnavailable!==true&&isFresh(d.lastPositionAt,now)&&
      finite(t.latitude)&&finite(t.longitude)&&Math.abs(t.latitude)<=90&&Math.abs(t.longitude)<=180&&
      !(t.latitude===0&&t.longitude===0);
  }
  function activeHms(d,now=Date.now()){
    return d&&Array.isArray(d.hms)&&finite(d.lastHmsAt)&&d.lastHmsAt<=now&&now-d.lastHmsAt<HMS_FRESH_MS?d.hms:[];
  }
  function hmsSummary(d,now=Date.now()){
    const list=activeHms(d,now).filter(a=>Number.isInteger(a.level)).sort((a,b)=>b.level-a.level);
    if(!list.length)return null;
    const first=list[0];
    const text=first.text&&(first.text.de||first.text.en)||'Unbekannter HMS-Code '+first.code;
    return {level:first.level,label:HMS_LEVEL[first.level]||'HMS',text,more:list.length-1};
  }
  function airsenseText(a){
    if(!a||a.fresh!==true||!Number.isInteger(a.count)||a.count<1||!Number.isInteger(a.maxWarningLevel))return null;
    const distance=finite(a.nearestDistanceM)?' · nächstes '+(a.nearestDistanceM>=1000?
      num(a.nearestDistanceM/1000,' km',1):Math.round(a.nearestDistanceM)+' m'):'';
    return {level:a.maxWarningLevel,text:'AirSense: '+a.count+(a.count===1?' Luftfahrzeug':' Luftfahrzeuge')+
      ' · Stufe '+a.maxWarningLevel+distance+(a.maxWarningLevel>=3?' · Ausweichen empfohlen':'')};
  }
  function rtkLabel(t){
    if(!t||!Number.isInteger(t.rtkFixState))return DASH;
    const label=RTK_FIX[t.rtkFixState]||'Code '+t.rtkFixState;
    return label+(finite(t.rtkSatellites)?' · '+t.rtkSatellites+' Sat.':'');
  }
  function gnssLabel(t){
    if(!t||!finite(t.gpsSatellites))return DASH;
    const q=t.positionQuality;
    const quality=q===10?' · RTK fixiert':Number.isInteger(q)?' · Stufe '+q:'';
    return t.gpsSatellites+' Sat.'+quality;
  }

  // Inspector rows: [label, value, telemetry key for the per-field age or null].
  function telemetryRows(d,now=Date.now()){
    if(!d)return [];
    const t=d.telemetry||{};
    const gateway=d.role==='gateway';
    const rows=[
      ['Gerät',deviceName(d)+' · '+roleLabel(d),null],
      ['Firmware',d.firmwareVersion||DASH,null],
      ['Akku',num(t.battery,' %',0),'battery'],
      ['Position',hasPosition(d,now)?num(t.latitude,'',6)+' / '+num(t.longitude,'',6):'keine gültige Position','latitude'],
      ['Höhe Ellipsoid',num(t.heightEllipsoid,' m',1),'heightEllipsoid']
    ];
    if(gateway){
      rows.push(['Funkqualität (SDR)',num(t.linkQuality,' / 5',0),'linkQuality'],
        ['SDR-Link',t.sdrLinkState===1?'verbunden':t.sdrLinkState===0?'getrennt':DASH,'sdrLinkState'],
        ['4G-Link',t.fourGLinkState===1?'verbunden':t.fourGLinkState===0?'getrennt':DASH,'fourGLinkState']);
    }else{
      rows.push(['Höhe rel. Start',num(t.altitude,' m',1),'altitude'],
        ['GNSS',gnssLabel(t),'gpsSatellites'],
        ['RTK',rtkLabel(t),'rtkFixState'],
        ['H-/V-Speed',num(t.horizontalSpeed,' m/s',1)+' / '+num(t.verticalSpeed,' m/s',1),'horizontalSpeed'],
        ['Kurs',num(t.heading,' °',1),'heading'],
        ['Distanz Home',num(t.homeDistance,' m',1),'homeDistance'],
        ['Restflugzeit',finite(t.remainingFlightTime)?Math.round(t.remainingFlightTime/60)+' min':DASH,'remainingFlightTime'],
        ['Wind (DJI-Rohwert)',num(t.windSpeed,'',1),'windSpeed'],
        ['Modus-Code',Number.isInteger(d.modeCode)?String(d.modeCode):DASH,null]);
    }
    return rows;
  }

  function fleetStats(devices,health,now=Date.now()){
    const list=Array.isArray(devices)?devices:[];
    const live=list.filter(d=>deviceStatus(d,now).kind==='live').length;
    const newest=list.reduce((max,d)=>finite(d.lastTelemetryAt)&&d.lastTelemetryAt>max?d.lastTelemetryAt:max,-Infinity);
    const mqtt=!health?{text:'unbekannt',ok:null,note:'Health nicht abrufbar'}:
      health.mqtt&&health.subscribed?{text:'ONLINE',ok:true,note:'abonniert · Port '+(health.mqttBrokerPort??DASH)}:
      {text:'OFFLINE',ok:false,note:health.mqtt?'Abonnement nicht bestätigt':'Broker nicht verbunden'};
    return {
      live,total:list.length,
      liveNote:list.length?(live===list.length?'alle mit frischem OSD':(list.length-live)+' ohne frisches OSD'):'keine Geräte gemeldet',
      mqtt,
      lastText:finite(newest)?ago(now-newest):DASH,
      lastNote:finite(newest)?(isFresh(newest,now)?'OSD frisch':'kein frisches OSD'):'noch kein OSD'
    };
  }
  function eventText(e){
    if(!e||typeof e!=='object')return 'Geräteereignis';
    if(e.channel==='events'&&e.method==='hms')return 'HMS-Meldungen geändert';
    if(e.channel==='events'&&e.method==='airsense_warning')return 'AirSense-Warnstufe geändert';
    if(e.channel==='status'&&e.method==='update_topo')return 'Topologie gemeldet';
    if(e.channel==='services_reply')return 'Dienstantwort empfangen';
    return e.channel==='status'?'Statusmeldung':'Geräteereignis';
  }
  function positions(devices,now=Date.now()){
    return (Array.isArray(devices)?devices:[]).filter(d=>hasPosition(d,now)).map(d=>({
      sn:d.sn,name:deviceName(d),gateway:d.role==='gateway',
      lat:d.telemetry.latitude,lon:d.telemetry.longitude
    }));
  }
  const api=Object.freeze({CURRENT_MS,ago,num,deviceName,roleLabel,deviceStatus,hasPosition,activeHms,
    hmsSummary,airsenseText,rtkLabel,gnssLabel,telemetryRows,fleetStats,eventText,positions});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SkyhubLiveModel=api;
})(typeof window==='object'?window:null);
