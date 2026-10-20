(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  let ready=false,connecting=false;
  let mqttLogin=null; // Kept only in WebView memory for an explicit retry.
  const isTls=location.protocol==='https:';
  function status(text){el('result').textContent=text;}
  function bridgeResult(value){
    let result=value;
    if(typeof result==='string'){
      try{result=JSON.parse(result);}catch{return {ok:false,message:'Ungültige DJI-Bridge-Antwort'};}
    }
    if(result && typeof result==='object' && typeof result.code==='number')
      return {ok:result.code===0,message:result.message||''};
    return {ok:false,message:'Unerwartete DJI-Bridge-Antwort'};
  }
  function invoke(method,...args){
    if(!window.djiBridge || typeof window.djiBridge[method]!=='function')
      throw new Error('DJI JSBridge-Funktion fehlt: '+method);
    const outcome=bridgeResult(window.djiBridge[method](...args));
    if(!outcome.ok)throw new Error(method+': '+(outcome.message||'nicht bestätigt'));
  }
  // Never log, render or export callback payloads or credentials.
  function decodeMqttState(value){
    let parsed=value;
    if(typeof parsed==='string'){
      try{parsed=JSON.parse(parsed.trim());}catch(_){return null;}
    }
    if(typeof parsed==='boolean')return parsed;
    if(parsed && typeof parsed==='object' && !Array.isArray(parsed)){
      // A failed JSBridge request must not be mistaken for a valid false state.
      if(typeof parsed.code==='number' && parsed.code!==0)return null;
      return typeof parsed.data==='boolean'?parsed.data:null;
    }
    return null;
  }
  function showRetry(enabled){
    const retry=el('retry');
    if(!retry)return;
    retry.hidden=!enabled;
    retry.disabled=!enabled;
  }
  function canRetry(){
    return Boolean(mqttLogin && window.djiBridge &&
      typeof window.djiBridge.thingConnect==='function');
  }
  window.skyhubPilotMqttState=function(_callbackResult){
    // The callback payload is intentionally ignored. Query the current state.
    try{
      const bridge=window.djiBridge;
      if(!bridge || typeof bridge.thingGetConnectState!=='function'){
        status('DJI MQTT: Statusabfrage nicht verfügbar.');
        showRetry(canRetry());
        return;
      }
      const state=decodeMqttState(bridge.thingGetConnectState());
      if(state===true){
        mqttLogin=null;
        showRetry(false);
        status('DJI MQTT: VERBUNDEN. OSD-Empfang im SkyHub prüfen.');
      }else if(state===false){
        showRetry(canRetry());
        status('DJI MQTT: NICHT VERBUNDEN. Erneuten Verbindungsversuch anbieten.');
      }else{
        showRetry(canRetry());
        status('DJI MQTT: Bridge-Rückgabe nicht eindeutig. Keine Verbindung bestätigt.');
      }
    }catch(_){
      showRetry(canRetry());
      status('DJI MQTT: Statusabfrage fehlgeschlagen.');
    }
  };
  // Loading the thing component already initiates MQTT login in DJI Pilot 2.
  // thingConnect is an explicit, user-initiated retry, not an automatic loop.
  function retryMqtt(){
    if(connecting || !canRetry())return;
    connecting=true;
    showRetry(false);
    status('DJI MQTT: Erneuter Verbindungsversuch gestartet ...');
    try{
      const value=window.djiBridge.thingConnect(
        mqttLogin.username,mqttLogin.password,'skyhubPilotMqttState');
      let result=value;
      if(typeof result==='string'){
        try{result=JSON.parse(result);}catch(_){}
      }
      if(result===false || (result && typeof result==='object' &&
          typeof result.code==='number' && result.code!==0)){
        status('DJI MQTT: Wiederverbindung von DJI Bridge abgelehnt.');
        showRetry(true);
      }
      // A successful function return is only request acceptance, not MQTT online.
    }catch(_){
      status('DJI MQTT: Wiederverbindung fehlgeschlagen.');
      showRetry(true);
    }finally{connecting=false;}
  }
  async function init(){
    try{
      const response=await fetch('/api/pilot/status',{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      ready=data.configured===true;
      el('headline').textContent=ready?'Plattform vorbereitet':'Pilot-2-Onboarding noch deaktiviert';
      el('details').textContent=ready?
        'DJI-Lizenz und MQTT-Parameter sind hinterlegt. Verbinden erfolgt erst nach Prüfung und Freigabe.':
        'Noch erforderliche Konfiguration: '+(data.missing||[]).join(', ');
      if(!isTls)el('security').textContent='HTTPS fehlt. Aus Sicherheitsgründen werden keine Zugangsdaten über unverschlüsseltes HTTP übertragen.';
      el('start').disabled=!ready||!isTls||!window.djiBridge;
      if(!window.djiBridge)status('DJI JSBridge nicht verfügbar: Bitte die Seite innerhalb DJI Pilot 2 öffnen.');
    }catch(e){el('headline').textContent='Backend nicht bereit';status(e.message);}
  }
  el('start').addEventListener('click',async()=>{
    if(!ready||!isTls||connecting)return;
    const token=el('access').value.trim();
    if(!token){status('Bitte den Pilot-Zugangstoken eingeben.');return;}
    if(!window.djiBridge){status('DJI JSBridge nicht verfügbar.');return;}
    connecting=true;el('start').disabled=true;
    try{
      status('Sichere Bootstrap-Konfiguration wird angefordert ...');
      const response=await fetch('/api/pilot/bootstrap',{
        method:'POST',cache:'no-store',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body:'{}'
      });
      // Do not echo backend exception text or any potential credentials.
      if(!response.ok)throw new Error('Bootstrap fehlgeschlagen (HTTP '+response.status+').');
      const config=await response.json();
      // Drop the manually entered token as soon as authorization succeeds.
      el('access').value='';
      status('Prüfe DJI Cloud API Lizenz ...');
      invoke('platformVerifyLicense',config.appId,config.appKey,config.license);
      status('Registriere Arbeitsbereich ...');
      invoke('platformSetWorkspaceId',config.workspaceId);
      invoke('platformSetInformation',config.platformName,config.workspaceName,config.description);
      status('Lade DJI Cloud-Modul ...');
      invoke('platformLoadComponent','thing',JSON.stringify({
        host:config.mqtt.host,username:config.mqtt.username,
        password:config.mqtt.password,connectCallback:'skyhubPilotMqttState'
      }));
      // Kept in memory only to support the dedicated retry button.
      mqttLogin={username:config.mqtt.username,password:config.mqtt.password};
      showRetry(false);
      status('DJI Cloud-Modul geladen. MQTT-Verbindungsstatus wird geprüft ...');
      setTimeout(()=>window.skyhubPilotMqttState(),4000);
    }catch(e){status('Verbindung noch nicht bestätigt: '+e.message);}
    finally{connecting=false;el('start').disabled=!ready||!isTls||!window.djiBridge;}
  });
  el('retry').addEventListener('click',retryMqtt);
  init();
})();
