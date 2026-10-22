// SkyHub NEXT dashboard: live connection to the SkyHub backend (read-only).
// Uses the same API as the existing dashboard: GET /api/devices, /api/events, /api/health and
// Socket.IO (snapshot, device_update, device_event). Backend data reaches the DOM only through
// textContent; the view-token stays in memory and is never stored or put into a URL.
(function(){
'use strict';
const M=window.SkyhubLiveModel;
const F=window.SkyHubTelemetryFreshness;
const $=id=>document.getElementById(id);
const state={token:null,live:false,devices:new Map(),selected:null,events:[],health:null,
  socket:null,map:null,markers:new Map(),attempt:0,message:'Verbindung wird hergestellt …',renderQueued:false};

function el(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
}
function setText(id,text,className){
  const node=$(id);
  if(!node)return;
  node.textContent=text;
  if(className!==undefined)node.className=className;
}
const list=()=>[...state.devices.values()];
function sortDevices(a,b){
  if((a.role==='gateway')!==(b.role==='gateway'))return a.role==='gateway'?-1:1;
  return M.deviceName(a).localeCompare(M.deviceName(b),'de')||a.sn.localeCompare(b.sn);
}

// ---- Rendering ----------------------------------------------------------------------------
function renderFleet(){
  const target=$('fleet-list');
  if(!target)return;
  target.replaceChildren();
  setText('fleet-source',state.live?'LIVE':'GETRENNT');
  if(!state.live){target.append(el('p','hint fleet-note',state.message));return;}
  const query=($('fleet-search')?.value||'').trim().toLowerCase();
  const items=list().filter(d=>(M.deviceName(d)+' '+d.sn).toLowerCase().includes(query)).sort(sortDevices);
  if(!items.length){
    target.append(el('p','hint fleet-note',state.devices.size?'Kein Gerät passt zur Suche.':'Noch keine Geräte gemeldet.'));
    return;
  }
  const names=new Map(list().map(d=>[d.sn,M.deviceName(d)]));
  for(const d of items){
    const status=M.deviceStatus(d);
    const card=el('button','fleet-card'+(d.sn===state.selected?' selected':''));
    card.type='button';
    card.dataset.device=d.sn;
    const head=el('div','fleet-name',M.deviceName(d));
    head.append(el('span',status.kind==='live'?'online':'offline',
      '● '+({live:'LIVE',disconnected:'GETRENNT',stale:'VERALTET'}[status.kind]||'UNBEKANNT')));
    const link=d.role==='gateway'?
      (d.children?.length?'verbunden mit '+d.children.map(sn=>names.get(sn)||sn).join(', '):'kein Fluggerät gemeldet'):
      (d.gatewaySn?'über '+(names.get(d.gatewaySn)||d.gatewaySn):'kein Gateway gemeldet');
    const row=el('div','fleet-sub');
    row.append(el('span',null,d.sn),el('span',null,link));
    card.append(head,el('small',null,M.roleLabel(d)+' · '+status.text),row);
    const hms=M.hmsSummary(d);
    if(hms)card.append(el('small','fleet-alert '+(hms.level>=2?'bad':'warn'),
      hms.label+': '+hms.text+(hms.more?' · '+hms.more+' weitere':'')));
    const air=M.airsenseText(d.airsense);
    if(air)card.append(el('small','fleet-alert '+(air.level>=3?'bad':'info'),air.text));
    card.addEventListener('click',()=>{state.selected=d.sn;renderFleet();renderTelemetry();focusDevice(d.sn);});
    target.append(card);
  }
}

function renderTelemetry(){
  const target=$('telemetry-fields');
  if(!target)return;
  const d=state.selected?state.devices.get(state.selected):null;
  const empty=$('inspector-empty');
  if(empty)empty.hidden=Boolean(d);
  setText('inspector-source',d?'GERÄT':'AUSWAHL');
  setText('inspector-heading',d?M.deviceName(d)+' · '+d.sn:'Fluggerät & RTK');
  target.replaceChildren();
  if(!d){
    target.append(el('p','hint inspector-note',state.live?'Gerät links auswählen.':'Nicht verbunden.'));
    return;
  }
  const status=M.deviceStatus(d);
  const top=el('div','telemetry-row');
  top.append(el('span',null,'Status'),el('b',status.kind==='live'?'ok':'bad',status.text));
  target.append(top);
  for(const [label,value,key] of M.telemetryRows(d)){
    const row=el('div','telemetry-row');
    const val=el('b',null,value);
    if(key&&F){
      const age=F.evaluateField(d,key);
      val.append(el('small','field-age '+age.kind,age.text));
    }
    row.append(el('span',null,label),val);
    target.append(row);
  }
  const hms=M.activeHms(d);
  for(const alert of hms){
    const row=el('div','telemetry-row');
    row.append(el('span',null,'HMS '+alert.code),
      el('b',alert.level>=2?'bad':null,alert.text&&(alert.text.de||alert.text.en)||'ohne Text'));
    target.append(row);
  }
  const air=M.airsenseText(d.airsense);
  if(air){
    const row=el('div','telemetry-row');
    row.append(el('span',null,'AirSense'),el('b',air.level>=3?'bad':null,air.text.replace(/^AirSense: /,'')));
    target.append(row);
  }
}

function renderStats(){
  const s=M.fleetStats(list(),state.health);
  setText('stat-live',String(s.live));
  setText('stat-live-total','/ '+s.total);
  setText('stat-live-note',state.live?s.liveNote:'nicht verbunden',state.live&&s.live?'':'stat-danger');
  setText('stat-mqtt',s.mqtt.text);
  setText('stat-mqtt-note',s.mqtt.note,s.mqtt.ok===false?'stat-danger':'');
  setText('stat-last',s.lastText);
  setText('stat-last-note',s.lastNote);
  setText('fleet-chip',state.live?s.total+' Geräte · live':'nicht verbunden');
  const pill=$('live-pill');
  if(pill){
    pill.textContent=state.live?'● LIVE · '+s.live+' von '+s.total+' frisch':'● NICHT VERBUNDEN';
    pill.className='pill '+(state.live?'status-live':'status-red');
  }
  const h=state.health;
  setText('comm-mqtt',!h?'unbekannt':h.mqtt&&h.subscribed?'verbunden · abonniert':h.mqtt?'verbunden · Abo offen':'getrennt',
    h&&h.mqtt&&h.subscribed?'ok':'bad');
  setText('comm-topology',!h?'unbekannt':h.topologyReplyEnabled?(h.topologyReplyConnected?'status_reply aktiv':'Publisher getrennt'):
    'status_reply aus',h&&h.topologyReplyEnabled&&h.topologyReplyConnected?'ok':'');
  setText('comm-last',h&&Number.isFinite(h.mqttLastMessageAt)?M.ago(Date.now()-h.mqttLastMessageAt):'—');
  setText('comm-fresh','15 s (OSD), 30 s (HMS)');
  setText('backend-status',h?'online · '+(h.status==='online'?'MQTT abonniert':'eingeschränkt'):'nicht erreichbar',
    h&&h.status==='online'?'ok':'bad');
  setText('sys-mqtt',h?(h.mqtt&&h.subscribed?'verbunden':'getrennt'):'unbekannt',h&&h.mqtt&&h.subscribed?'ok':'bad');
  setText('sys-tsa',h&&h.tsa?h.tsa.clients+' RC verbunden':'aus',h&&h.tsa?'ok':'');
  setText('sys-tracks',h?(h.trackRecordingEnabled?'aktiv':'aus'):'unbekannt');
  setText('map-mode',state.live?'GERÄTE LIVE · ROUTE/FLÄCHE: BEISPIEL':'NICHT VERBUNDEN · ROUTE/FLÄCHE: BEISPIEL');
}

function renderEvents(){
  const target=$('event-list');
  if(!target)return;
  target.replaceChildren();
  setText('events-source',state.live?'LIVE':'—');
  if(!state.events.length){
    target.append(el('p','hint fleet-note',state.live?'Noch keine Ereignisse.':'Nicht verbunden.'));
    return;
  }
  const names=new Map(list().map(d=>[d.sn,M.deviceName(d)]));
  for(const e of state.events.slice(0,8)){
    const row=el('div','event');
    const dot=el('b','dot '+(e.method==='hms'||e.method==='airsense_warning'?'amber':e.channel==='status'?'blue':'green'));
    const body=el('div');
    body.append(el('strong',null,M.eventText(e)),el('small',null,(names.get(e.sn)||e.sn)+' · '+M.ago(Date.now()-e.at)));
    row.append(dot,body);
    target.append(row);
  }
}

// ---- Map ----------------------------------------------------------------------------------
function updateMarkers(){
  if(!state.map||typeof L==='undefined')return;
  const seen=new Set();
  for(const p of M.positions(list())){
    seen.add(p.sn);
    let marker=state.markers.get(p.sn);
    if(!marker){
      marker=L.circleMarker([p.lat,p.lon],{radius:p.gateway?6:8,weight:2,color:p.gateway?'#7caaf7':'#35d7bd',
        fillColor:p.gateway?'#7caaf7':'#35d7bd',fillOpacity:.75});
      marker.bindTooltip('',{direction:'top',offset:[0,-6]});
      marker.on('click',()=>{state.selected=p.sn;renderFleet();renderTelemetry();});
      marker.addTo(state.map);
      state.markers.set(p.sn,marker);
    }
    marker.setLatLng([p.lat,p.lon]);
    marker.setTooltipContent(p.name+' · '+p.sn);
  }
  for(const [sn,marker] of state.markers)if(!seen.has(sn)){marker.remove();state.markers.delete(sn);}
}
function attachMap(map){state.map=map;updateMarkers();}
function focusDevice(sn){
  const d=state.devices.get(sn);
  if(state.map&&d&&M.hasPosition(d))state.map.setView([d.telemetry.latitude,d.telemetry.longitude],Math.max(state.map.getZoom(),16));
}
// Returns false when no live position exists, so the caller can fall back to the demo area.
function fitDevices(){
  const points=M.positions(list());
  if(!state.map||!points.length)return false;
  if(points.length===1)state.map.setView([points[0].lat,points[0].lon],17);
  else state.map.fitBounds(points.map(p=>[p.lat,p.lon]),{padding:[40,40],maxZoom:18});
  return true;
}

function renderAll(){
  state.renderQueued=false;
  renderFleet();renderTelemetry();renderStats();renderEvents();updateMarkers();
}
function scheduleRender(){
  if(state.renderQueued)return;
  state.renderQueued=true;
  requestAnimationFrame(renderAll);
}

// ---- Connection ---------------------------------------------------------------------------
function showAuth(visible,message){
  const form=$('auth-form');
  if(form)form.hidden=!visible;
  if(message)state.message=message;
}
function setDevices(items){
  if(!Array.isArray(items))return;
  state.devices=new Map(items.filter(d=>d&&typeof d.sn==='string').map(d=>[d.sn,d]));
  if(state.selected&&!state.devices.has(state.selected))state.selected=null;
  if(!state.selected&&state.devices.size)state.selected=list().sort(sortDevices).find(d=>d.role!=='gateway')?.sn||list()[0].sn;
}
async function loadEvents(token){
  try{
    const res=await fetch('/api/events',{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store'});
    if(!res.ok)return;
    const items=await res.json();
    if(Array.isArray(items))state.events=items.filter(e=>e&&typeof e.sn==='string'&&Number.isFinite(e.at)).slice(0,50);
  }catch(_){/* events are optional */}
}
function openSocket(token){
  if(state.socket){state.socket.close();state.socket=null;}
  if(typeof io!=='function')return;
  const socket=io({auth:token?{token}:{},reconnectionDelayMax:5000});
  socket.on('snapshot',items=>{if(socket===state.socket){setDevices(items);scheduleRender();}});
  socket.on('device_update',d=>{
    if(socket!==state.socket||!d||typeof d.sn!=='string')return;
    state.devices.set(d.sn,d);
    if(!state.selected)state.selected=d.sn;
    scheduleRender();
  });
  socket.on('device_event',e=>{
    if(socket!==state.socket||!e||typeof e.sn!=='string'||!Number.isFinite(e.at))return;
    state.events.unshift(e);
    state.events.length=Math.min(state.events.length,50);
    scheduleRender();
  });
  socket.on('disconnect',()=>{if(socket===state.socket)window.SkyhubToast?.('Live-Verbindung unterbrochen · Socket.IO verbindet neu');});
  state.socket=socket;
}
// token===null: token-free read-only view from the configured home LAN.
async function connect(token){
  const attempt=++state.attempt;
  state.message='Verbindung wird hergestellt …';
  let res;
  try{res=await fetch('/api/devices',{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store'});}
  catch(_){if(attempt===state.attempt){state.live=false;showAuth(true,'Backend nicht erreichbar.');renderAll();}return false;}
  if(attempt!==state.attempt)return false;
  if(res.status===401){
    state.live=false;
    showAuth(true,token?'Zugriffstoken ungültig.':'Zugriffstoken eingeben, um Geräte zu laden.');
    renderAll();
    return false;
  }
  if(!res.ok){state.live=false;showAuth(true,'Geräte konnten nicht geladen werden (HTTP '+res.status+').');renderAll();return false;}
  setDevices(await res.json());
  state.token=token;
  state.live=true;
  showAuth(false,'');
  openSocket(token);
  await loadEvents(token);
  renderAll();
  return true;
}
async function pollHealth(){
  try{
    const res=await fetch('/api/health',{cache:'no-store'});
    state.health=res.ok?await res.json():null;
  }catch(_){state.health=null;}
  scheduleRender();
}

function start(){
  const input=$('token-input');
  const submit=()=>{
    const token=input?input.value.trim():'';
    if(!token){showAuth(true,'Zugriffstoken eingeben.');renderAll();return;}
    connect(token).then(ok=>{if(ok&&input)input.value='';});
  };
  $('token-connect')?.addEventListener('click',submit);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
  $('fleet-search')?.addEventListener('input',renderFleet);
  pollHealth();
  setInterval(pollHealth,5000);
  // Ages and freshness change with time even without new messages.
  setInterval(scheduleRender,1000);
  connect(null);
}

window.SkyhubLive=Object.freeze({start,renderFleet,renderTelemetry,attachMap,fitDevices,
  isLive:()=>state.live});
})();
