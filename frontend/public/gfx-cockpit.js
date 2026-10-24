/* SKY//PULSE field-provenance cockpit. Presentation-only; no data fetches. */
(function(root){
'use strict';
const SPECS=Object.freeze([
  {key:'battery',id:'Battery',digits:0,unit:' %',range:[0,100]},
  {key:'altitude',id:'Altitude',digits:1,unit:' m'},
  {key:'horizontalSpeed',id:'Speed',digits:1,unit:' m/s'},
  {key:'heading',id:'Heading',digits:0,unit:' °'},
  {key:'verticalSpeed',id:'Climb',digits:1,unit:' m/s'},
  {key:'linkQuality',id:'Link',digits:0,unit:' / 5',range:[0,5]}
]);
function valueFor(device,spec,freshness,now){
  const source=device&&device.telemetry;
  const value=source&&source[spec.key];
  if(!Number.isFinite(value)||(spec.range&&(value<spec.range[0]||value>spec.range[1]))){
    return {value:'—',age:'Nicht empfangen',kind:'missing',meter:null};
  }
  const status=freshness.evaluateField(device,spec.key,now);
  const formatted=value.toFixed(spec.digits).replace('.',',')+spec.unit;
  const meter=spec.range?100*(value-spec.range[0])/(spec.range[1]-spec.range[0]):null;
  return {value:formatted,age:status.text,kind:status.kind,meter};
}
function mount({document:doc,fieldFreshness,onLocate}={}){
  const rootEl=doc&&doc.getElementById('gfxCockpit');
  if(!rootEl||!fieldFreshness||typeof fieldFreshness.evaluateField!=='function')return null;
  const picker=doc.getElementById('gfxCockpitDevice');
  const status=doc.getElementById('gfxCockpitStatus');
  const locate=doc.getElementById('gfxCockpitLocate');
  if(!picker||!status||!locate)return null;
  let selected=null;
  let signature='';
  let current=null;
  picker.addEventListener('change',()=>{
    selected=picker.value||null;
    updateView();
  });
  locate.addEventListener('click',()=>{
    if(current&&typeof onLocate==='function')onLocate(current.sn);
  });
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
    locate.disabled=!current||
      current.positionUnavailable===true||
      !current.telemetry||
      !Number.isFinite(current.telemetry.latitude)||
      !Number.isFinite(current.telemetry.longitude)||
      Math.abs(current.telemetry.latitude)>90||
      Math.abs(current.telemetry.longitude)>180||
      (current.telemetry.latitude===0&&current.telemetry.longitude===0)||
      !Number.isFinite(current.lastPositionAt);
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
    const ordered=devices.map(d=>d.sn);
    const nextSignature=ordered.map(sn=>JSON.stringify(sn)).join('|');
    if(signature!==nextSignature){
      const fragment=doc.createDocumentFragment();
      for(const d of devices){
        const option=doc.createElement('option');
        option.value=d.sn;
        option.textContent=(typeof d.modelName==='string'&&d.modelName.trim()?
          d.modelName:'Gerät')+' · '+d.sn;
        fragment.appendChild(option);
      }
      picker.replaceChildren(fragment);
      signature=nextSignature;
    }
    if(!devices.some(d=>d.sn===selected))selected=devices.length?devices[0].sn:null;
    picker.value=selected||'';
    picker.disabled=!devices.length;
    updateView();
  }
  return {render};
}
const api=Object.freeze({SPECS,valueFor,mount});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyHubGfxCockpit=api;
})(typeof window==='object'?window:null);
