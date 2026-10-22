'use strict';
(function(){
 const core=window.SkyHubCommandCenterCore;
 const el=id=>document.getElementById(id);
 const records=new Map();
 let selected=null,token=null,socket=null,attempt=0,buckets=[];
 const keys=[['altitude','Höhe (DJI-Meldung)',' m'],['horizontalSpeed','Horizontalgeschwindigkeit',' m/s'],
   ['battery','Akku',' %'],['gpsSatellites','GNSS-Satelliten',''],
   ['rtkFixState','RTK-Code',''],['attitudePitch','Nickwinkel',' °'],
   ['attitudeRoll','Rollwinkel',' °'],['windSpeed','Wind',' m/s']];
 const map=window.L?L.map('map',{zoomControl:true}).setView([51.16,10.45],6):null;
 let markers=map?L.layerGroup():null;
 if(map){
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
     {maxZoom:19,attribution:'© OpenStreetMap',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
   markers.addTo(map);
 }else{
   el('map-note').textContent='Karte nicht verfügbar (Leaflet nicht geladen). Gerätedaten bleiben lesbar.';
 }
 function elem(tag,text,classname){
   const e=document.createElement(tag);
   if(text!==undefined)e.textContent=String(text);
   if(classname)e.className=classname;
   return e;
 }
 function setMessage(id,msg){el(id).textContent=msg;}
 function headers(){return token?{Authorization:'Bearer '+token}:{};}
 async function readApi(url){
   const r=await fetch(url,{headers:headers(),cache:'no-store'});
   if(!r.ok)throw new Error(r.status===401?'Zugriff nicht autorisiert':
     r.status===404?'Funktion nicht aktiviert':'Dienst momentan nicht erreichbar');
   return r.json();
 }
 function renderDetails(){
   const d=selected&&records.get(selected);
   el('telemetry').replaceChildren();
   el('hms-list').replaceChildren();
   if(!d){
     setMessage('selected-label','Keines ausgewählt.');
     el('hms-list').append(elem('li','Kein Fluggerät ausgewählt.'));
     return;
   }
   setMessage('selected-label',(d.modelName||d.role||'Gerät')+' · '+core.deviceState(d));
   for(const [field,label,unit] of keys){
     const metric=core.metric(d,field,unit);
     const dt=elem('dt',label),dd=elem('dd',metric.value);
     if(metric.state!=='fresh'){
       const state={'unavailable':'Nicht verfügbar','stale':'Veraltet','time-unverified':'DJI-Zeit ungeprüft'}[metric.state];
       dd.append(elem('small',state||'Unbekannt','metric-state'));
     }
     el('telemetry').append(dt,dd);
   }
   const alerts=core.hmsAlerts(d);
   if(!alerts.length)el('hms-list').append(elem('li','Keine aktuellen HMS-Meldungen.'));
   for(const a of alerts.slice(0,15)){
     const li=elem('li');
     li.append(elem('strong','Stufe '+(Number.isInteger(a.level)?a.level:'?')+' · '+(a.code||'DJI HMS')));
     li.append(elem('p',a.text||'DJI HMS-Ereignis','smaller'));
     el('hms-list').append(li);
   }
 }
 function renderMap(){
   if(!map)return;
   markers.clearLayers();
   let count=0;
   for(const d of records.values()){
     const pos=core.knownPosition(d);
     if(!pos)continue;
     count++;
     const isRecent=core.isFresh(d.lastPositionAt);
     const marker=L.circleMarker([pos.lat,pos.lon],{
       radius:7,color:isRecent?'#34d399':'#fbbf78',
       fillColor:isRecent?'#34d399':'#fbbf78',fillOpacity:.75
     }).addTo(markers);
     marker.on('click',()=>{selected=d.sn;render();});
   }
   setMessage('map-note',count?count+' bekannte Position(en). Orange = veraltet; Karte wird nicht automatisch auf Standort bewegt.':
     'Keine gültige Position (0/0 gilt als nicht verfügbar).');
 }
 function render(){
   const all=[...records.values()];
   const stats=core.summarize(all);
   el('count').textContent=stats.devices;
   el('live').textContent=stats.live;
   el('warnings').textContent=stats.warnings;
   const root=el('devices');root.replaceChildren();
   if(!all.length)root.append(elem('p','Keine registrierten Geräte.','muted'));
   for(const d of all.sort((a,b)=>(b.lastTelemetryAt||0)-(a.lastTelemetryAt||0))){
     const button=elem('button',undefined,'device-item'+(selected===d.sn?' selected':''));
     button.type='button';
     button.setAttribute('aria-pressed',selected===d.sn?'true':'false');
     const main=elem('span');
     main.append(elem('strong',d.modelName||d.role||'Unbekanntes Gerät'));
     main.append(elem('small',core.deviceState(d)));
     button.append(main,elem('small',d.role||''));
     button.addEventListener('click',()=>{
       selected=d.sn;render();
       const pos=core.knownPosition(d);if(pos&&map)map.setView([pos.lat,pos.lon],14);
     });
     root.append(button);
   }
   if(selected&&!records.has(selected))selected=null;
   renderMap();renderDetails();
 }
 function applySnapshot(list){
   if(!Array.isArray(list))return;
   records.clear();
   for(const d of list){
     if(d&&typeof d.sn==='string'&&d.sn.length<=100)records.set(d.sn,d);
   }
   render();
 }
 async function connect(provided,auto=false){
   if(!auto&&!provided){setMessage('connection','Zugriffstoken fehlt');return;}
   const id=++attempt;
   setMessage('connection','Verbinde …');
   if(socket){socket.disconnect();socket=null;}
   try{
     const response=await fetch('/api/devices',{
       headers:provided?{Authorization:'Bearer '+provided}:{},cache:'no-store'});
     if(id!==attempt)return;
     if(!response.ok)throw new Error(response.status===401?'Token erforderlich oder ungültig':
       'API nicht erreichbar');
     const list=await response.json();
     if(id!==attempt)return;
     token=provided;
     applySnapshot(list);
     el('load-buckets').disabled=false;
     el('load-m3m').disabled=false;
     setMessage('connection','HTTP verbunden · WebSocket wird aufgebaut');
     if(typeof io==='function'){
       const active=io({auth:provided?{token:provided}:{},reconnectionDelayMax:5000});
       socket=active;
       active.on('connect',()=>{if(socket===active)setMessage('connection','OSD-WebSocket verbunden');});
       active.on('disconnect',()=>{if(socket===active)setMessage('connection','WebSocket getrennt · Daten altern');});
       active.on('connect_error',()=>{if(socket===active)setMessage('connection','WebSocket nicht autorisiert oder offline');});
       active.on('snapshot',value=>{if(socket===active)applySnapshot(value);});
       active.on('device_update',d=>{
         if(socket!==active||!d||typeof d.sn!=='string'||d.sn.length>100)return;
         records.set(d.sn,d);render();
       });
     }else setMessage('connection','WebSocket-Bibliothek fehlt · Momentaufnahme');
     if(auto){el('token').hidden=true;el('connect').hidden=true;}
     checkHealth();
   }catch(err){
     if(id!==attempt)return;
     token=null;records.clear();selected=null;render();
     el('load-buckets').disabled=true;el('load-objects').disabled=true;
     el('load-m3m').disabled=true;
     setMessage('connection',auto?'Token für Zugriff außerhalb Heimnetz erforderlich':err.message);
   }
 }
 async function checkHealth(){
   try{
     const r=await fetch('/api/health',{cache:'no-store'});
     if(!r.ok)throw new Error('Status nicht erreichbar');
     const h=await r.json();
     setMessage('health-status','Backend: '+(h.status||'unbekannt')+
       ' · MQTT: '+(h.mqtt?'verbunden':'getrennt')+
       ' · Abonnement: '+(h.subscribed?'aktiv':'inaktiv')+
       ' · Redis: '+(h.redis?'bereit':'nicht bereit'));
   }catch(_err){setMessage('health-status','Backend-Status nicht abrufbar');}
 }
 async function loadBuckets(){
   setMessage('media-message','Bucket-Verfügbarkeit wird gelesen …');
   el('load-objects').disabled=true;
   try{
     const result=await readApi('/api/media/buckets');
     buckets=Array.isArray(result.buckets)?result.buckets.filter(b=>typeof b==='string'):[];
     el('bucket').replaceChildren(elem('option','—'));
     for(const name of buckets){
       const op=elem('option',name);op.value=name;el('bucket').append(op);
     }
     el('bucket').disabled=!buckets.length;
     el('load-objects').disabled=!buckets.length;
     setMessage('media-message',buckets.length?buckets.length+' verfügbare Buckets':'Keine Buckets verfügbar');
   }catch(err){setMessage('media-message',err.message);}
 }
 function prefixValue(){return el('prefix').value.trim();}
 async function loadObjects(){
   const bucket=el('bucket').value,prefix=prefixValue();
   if(!buckets.includes(bucket)){setMessage('media-message','Bucket auswählen');return;}
   if(prefix.length>512){setMessage('media-message','Präfix zu lang');return;}
   setMessage('media-message','Objekte werden gelesen …');
   el('objects').replaceChildren();
   try{
     const result=await readApi('/api/media/objects?bucket='+encodeURIComponent(bucket)+
       '&prefix='+encodeURIComponent(prefix)+'&limit=100');
     for(const file of Array.isArray(result.objects)?result.objects:[]){
       el('objects').append(elem('li',String(file.key||'')+' · '+String(file.size??'—')+' Byte'));
     }
     setMessage('media-message',(result.objects?.length||0)+' Objekte geladen'+
       (result.truncated?' · weitere vorhanden (maximal 100 pro Abruf)':''));
   }catch(err){setMessage('media-message',err.message);}
 }
 async function loadM3m(){
   const prefix=prefixValue();
   if(prefix.length<2||!prefix.endsWith('/')){setMessage('m3m-message','Einen konkreten M3M-Präfix mit abschließendem / eingeben.');return;}
   setMessage('m3m-message','M3M-Inventur wird geprüft …');
   try{
     const report=await readApi('/api/media/m3m/inventory?prefix='+encodeURIComponent(prefix));
     // The backend only releases aggregate inventory. Never display arbitrary raw JSON.
     if(report.schema!=='skyhub-m3m-media-inventory-v1')throw new Error('Unbekanntes Inventarschema');
     const count=key=>Number.isInteger(report[key])&&report[key]>=0?report[key]:'—';
     setMessage('m3m-message','Dateinamen geprüft: '+count('totalEntries')+
       ' · Spektralsätze: '+count('spectralSets')+
       ' · Fünf-Kanal-Gruppen: '+count('fiveChannelSets')+
       ' · unvollständig: '+count('partialSets')+
       ' · doppelt: '+count('duplicateSets')+
       '. Nur Dateinamenshinweise! Reflektanz, NDVI und NDRE nicht freigegeben.');
   }catch(err){setMessage('m3m-message',err.message);}
 }
 document.querySelectorAll('nav button[data-view]').forEach(button=>
   button.addEventListener('click',()=>{
     const chosen=button.dataset.view;
     for(const name of ['dashboard','media','analysis'])el(name).hidden=name!==chosen;
     document.querySelectorAll('nav button[data-view]').forEach(b=>
       b.setAttribute('aria-current',b===button?'page':'false'));
     if(chosen==='dashboard'&&map)setTimeout(()=>map.invalidateSize(),0);
   }));
 el('connect').addEventListener('click',()=>connect(el('token').value.trim()));
 el('token').addEventListener('keydown',event=>{if(event.key==='Enter')connect(el('token').value.trim());});
 el('check-health').addEventListener('click',checkHealth);
 el('load-buckets').addEventListener('click',loadBuckets);
 el('bucket').addEventListener('change',()=>{el('objects').replaceChildren();});
 el('load-objects').addEventListener('click',loadObjects);
 el('load-m3m').addEventListener('click',loadM3m);
 setInterval(()=>{if(records.size)render();},5000);
 checkHealth();
 // Only attempt token-free read-only access on a configured home LAN.
 connect(null,true);
})();
