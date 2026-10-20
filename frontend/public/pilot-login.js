(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  let ready=false,connecting=false;
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
  // Never print the RC serial, password, license, token or MQTT config.
  window.skyhubPilotMqttState=function(result){
    // Do not infer online state from unspecified vendor callback structures.
    status('MQTT-Statusänderung von DJI Pilot 2 gemeldet. Verbindung im Broker prüfen.');
  };
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
      status('DJI Cloud-Modul geladen; MQTT-Verbindungsstatus muss separat bestätigt werden.');
    }catch(e){status('Verbindung noch nicht bestätigt: '+e.message);}
    finally{connecting=false;el('start').disabled=!ready||!isTls||!window.djiBridge;}
  });
  init();
})();
