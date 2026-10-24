/* SKY//PULSE field-provenance cockpit. Presentation-only; no data fetches. */
(function(root){
'use strict';
const SPECS=Object.freeze([
  {key:'battery',id:'Battery',digits:0,unit:' %',range:[0,100]},
  {key:'altitude',id:'Altitude',digits:1,unit:' m'},
  {key:'horizontalSpeed',id:'Speed',digits:1,unit:' m/s'},
  {key:'heading',id:'Heading',digits:0,unit:' °',limit:[-360,360]},
  {key:'verticalSpeed',id:'Climb',digits:1,unit:' m/s'},
  {key:'attitudePitch',id:'Pitch',digits:1,unit:' °',limit:[-90,90]},
  {key:'attitudeRoll',id:'Roll',digits:1,unit:' °',limit:[-180,180]},
  {key:'linkQuality',id:'Link',digits:0,unit:' / 5',range:[0,5]}
]);
function valueFor(device,spec,freshness,now){
  const source=device&&device.telemetry;
  const value=source&&source[spec.key];
  const validRange=spec.range||spec.limit;
  if(!Number.isFinite(value)||(validRange&&(value<validRange[0]||value>validRange[1]))){
    return {value:'—',age:'Nicht empfangen',kind:'missing',meter:null};
  }
  const status=freshness.evaluateField(device,spec.key,now);
  const formatted=value.toFixed(spec.digits).replace('.',',')+spec.unit;
  const meter=spec.range?100*(value-spec.range[0])/(spec.range[1]-spec.range[0]):null;
  return {value:formatted,age:status.text,kind:status.kind,meter};
}
// Direction is visualized only from current, time-verified DJI heading data.
function bearingFor(device,fieldFreshness,now=Date.now()){
  const heading=device?.telemetry?.heading;
  if(!Number.isFinite(heading)||Math.abs(heading)>360)return null;
  const status=fieldFreshness?.evaluateField?.(device,'heading',now);
  if(!status||status.kind!=='current')return null;
  return ((heading%360)+360)%360;
}
/* Presentation-only pitch/roll geometry. Both values must carry fresh, verified
 * field-level provenance; the scene is schematic, not a certified attitude indicator. */
function attitudeFor(device,freshness,now=Date.now()){
  const pitch=device?.telemetry?.attitudePitch;
  const roll=device?.telemetry?.attitudeRoll;
  if(!Number.isFinite(pitch)||Math.abs(pitch)>90||
     !Number.isFinite(roll)||Math.abs(roll)>180)return null;
  if(freshness?.evaluateField?.(device,'attitudePitch',now)?.kind!=='current'||
     freshness?.evaluateField?.(device,'attitudeRoll',now)?.kind!=='current')return null;
  return {pitch,roll,offset:Math.round(pitch*0.8*10)/10};
}
function mount({document:doc,fieldFreshness,onLocate,mapAvailable=false}={}){
  const rootEl=doc&&doc.getElementById('gfxCockpit');
  if(!rootEl||!fieldFreshness||typeof fieldFreshness.evaluateField!=='function')return null;
  const picker=doc.getElementById('gfxCockpitDevice');
  const status=doc.getElementById('gfxCockpitStatus');
  const locate=doc.getElementById('gfxCockpitLocate');
  if(!picker||!status||!locate)return null;
  let selected=null;
  let previousMapSelection=null;
  let signature='';
  let current=null;
  picker.addEventListener('change',()=>{
    selected=picker.value||null;
    updateView();
  });
  locate.addEventListener('click',()=>{
    if(current&&typeof onLocate==='function')onLocate(current.sn);
  });
  const compass=doc.getElementById('gfxCockpitCompass');
  const needle=doc.getElementById('gfxCockpitNeedle');
  const attitude=doc.getElementById('gfxCockpitAttitude');
  const attitudePlane=doc.getElementById('gfxCockpitAttitudePlane');
  const nodes=new Map(SPECS.map(spec=>[spec.key,{
    value:doc.getElementById('gfxCockpit'+spec.id),
    age:doc.getElementById('gfxCockpit'+spec.id+'Age'),
    meter:doc.getElementById('gfxCockpit'+spec.id+'Meter')
  }]));
  let devices=[];
  let state='loading';
  let lastStatus='';
  function updateView(){
    const now=Date.now();
    current=devices.find(d=>d&&d.sn===selected)||null;
    const nextStatus=!current?
      state==='auth-required'?'Zugriffstoken zum Laden der Geräte erforderlich.':
      state==='error'?'Geräteabruf fehlgeschlagen. Verbindung prüfen.':
      state==='loading'?'Warte auf Gerätedaten.':'Keine Geräte empfangen.':
      current.aircraftConnected===false?'Fluggerät nicht verbunden · Werte können veraltet sein.':
      current.telemetryTimeVerified===false?'OSD empfangen · Gesamtzeit ungeprüft; Felder separat bewerten.':
      'Gerätemesswerte · Frische je Feld separat angegeben.';
    if(nextStatus!==lastStatus){status.textContent=nextStatus;lastStatus=nextStatus;}
    locate.disabled=!mapAvailable||!current||
      current.positionUnavailable===true||
      !current.telemetry||
      !Number.isFinite(current.telemetry.latitude)||
      !Number.isFinite(current.telemetry.longitude)||
      Math.abs(current.telemetry.latitude)>90||
      Math.abs(current.telemetry.longitude)>180||
      (current.telemetry.latitude===0&&current.telemetry.longitude===0)||
      !Number.isFinite(current.lastPositionAt);
    // No needle if heading is missing, disconnected, stale or time-unverified.
    if(compass&&needle){
      const bearing=bearingFor(current,fieldFreshness,now);
      compass.hidden=bearing===null;
      needle.style.transform=bearing===null?'':('rotate('+bearing+'deg)');
    }
    // No animated or guessed horizon: neutral if either source is stale.
    if(attitude&&attitudePlane){
      const geometry=attitudeFor(current,fieldFreshness,now);
      attitude.hidden=geometry===null;
      attitudePlane.style.transform=geometry===null?'':(
        'rotate('+(-geometry.roll)+'deg) translateY('+geometry.offset+'px)');
    }
    for(const spec of SPECS){
      const el=nodes.get(spec.key);
      if(!el||!el.value||!el.age)continue;
      const result=valueFor(current,spec,fieldFreshness,now);
      el.value.textContent=result.value;
      el.age.textContent=result.age;
      el.age.dataset.kind=result.kind;
      if(el.meter){
        // A bar is shown only with verified, fresh, field-level provenance.
        const pct=result.kind==='current'&&result.meter!==null?result.meter:0;
        el.meter.style.width=pct.toFixed(1)+'%';
      }
    }
  }
  function render(records,ignoredMapSelection,listState){
    devices=Array.isArray(records)?records.filter(d=>d&&typeof d.sn==='string'&&d.sn.length>0):[];
    state=listState||'loading';
    // The command instrument has its own explicit selection; nothing is stored.
    const ordered=[...devices].sort((a,b)=>a.sn.localeCompare(b.sn,'de'));
    const nextSignature=ordered.map(d=>JSON.stringify([d.sn,d.modelName])).join('|');
    if(signature!==nextSignature){
      const fragment=doc.createDocumentFragment();
      for(const d of ordered){
        const option=doc.createElement('option');
        option.value=d.sn;
        option.textContent=(typeof d.modelName==='string'&&d.modelName.trim()?
          d.modelName:'Gerät')+' · '+d.sn;
        fragment.appendChild(option);
      }
      picker.replaceChildren(fragment);
      signature=nextSignature;
    }
    if(ignoredMapSelection&&ignoredMapSelection!==previousMapSelection&&devices.some(d=>d.sn===ignoredMapSelection))selected=ignoredMapSelection;
    previousMapSelection=ignoredMapSelection||null;
    if(!devices.some(d=>d.sn===selected))selected=devices.length?devices[0].sn:null;
    picker.value=selected||'';
    picker.disabled=!devices.length;
    updateView();
  }
  return {render};
}
const api=Object.freeze({SPECS,valueFor,bearingFor,attitudeFor,mount});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyHubGfxCockpit=api;
})(typeof window==='object'?window:null);
