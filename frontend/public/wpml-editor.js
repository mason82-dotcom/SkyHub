'use strict';
// Client-only waypoint editor; never calls DJI/MQTT/SkyHub write endpoints.
(function () {
  const core=window.SkyHubWpmlPlanner;
  const $=id=>document.getElementById(id);
  if(!core){$('message').textContent='WPML-Modul nicht geladen – kein Export möglich.';return;}
  const points=[];
  let map=null,markers=[],line=null,hasFit=false;
  const renderMessage=(message,error=false)=>{
    $('message').textContent=message;
    $('message').style.color=error?'#ffcb7d':'#ccebf7';
  };
  if(typeof window.L==='object'&&typeof window.L.map==='function'){
    map=L.map('map',{zoomControl:true}).setView([50.5,10.4],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'© OpenStreetMap contributors'
    }).addTo(map);
    map.on('click',event=>addPoint(event.latlng.lat,event.latlng.lng));
  }else{
    $('map').textContent='Kartendienst nicht verfügbar. Wegpunkte können weiterhin manuell hinzugefügt und als KMZ exportiert werden.';
    $('map').style.padding='32px 18px';
  }
  function normalizeCoordinate(raw,min,max){
    if(typeof raw!=='number'||!Number.isFinite(raw)||raw<min||raw>max)return null;
    return Math.round(raw*10000000)/10000000;
  }
  function addPoint(lat,lon){
    const latitude=normalizeCoordinate(lat,-90,90);
    const longitude=normalizeCoordinate(lon,-180,180);
    if(latitude===null||longitude===null){renderMessage('Koordinaten sind ungültig.',true);return;}
    if(points.length>=500){renderMessage('Maximal 500 Wegpunkte.',true);return;}
    if(points.length&&points[points.length-1].lat===latitude&&points[points.length-1].lon===longitude){
      renderMessage('Aufeinanderfolgende identische Wegpunkte sind nicht erlaubt.',true);return;
    }
    points.push({lat:latitude,lon:longitude,photo:false});
    $('latitude').value=String(latitude);
    $('longitude').value=String(longitude);
    render();
  }
  function swap(i,j){
    if(j<0||j>=points.length)return;
    [points[i],points[j]]=[points[j],points[i]];
    render();
  }
  function action(label,callback){
    const b=document.createElement('button');
    b.type='button';b.textContent=label;
    b.addEventListener('click',callback);return b;
  }
  function renderList(){
    const list=$('waypoints');
    list.replaceChildren();
    $('count').textContent=points.length+' / 500';
    points.forEach((point,index)=>{
      const item=document.createElement('div');
      item.className='waypoint';item.setAttribute('role','listitem');
      const title=document.createElement('strong');
      title.textContent='Wegpunkt '+(index+1);item.appendChild(title);
      const detail=document.createElement('small');
      detail.textContent=point.lat.toFixed(7)+'° N/S, '+point.lon.toFixed(7)+'° E/W';
      item.appendChild(detail);
      const photoLabel=document.createElement('label');photoLabel.className='photo';
      const checkbox=document.createElement('input');checkbox.type='checkbox';
      checkbox.checked=point.photo;checkbox.setAttribute('aria-label','Foto an Wegpunkt '+(index+1));
      checkbox.addEventListener('change',()=>{point.photo=checkbox.checked;renderMessage('Entwurf aktualisiert.');});
      photoLabel.append(checkbox,document.createTextNode('Einzelbild aufnehmen'));
      item.appendChild(photoLabel);
      const controls=document.createElement('div');controls.className='actions';
      const up=action('↑',()=>swap(index,index-1));up.disabled=index===0;up.title='Wegpunkt nach oben';
      const down=action('↓',()=>swap(index,index+1));down.disabled=index===points.length-1;down.title='Wegpunkt nach unten';
      const deleteButton=action('Entfernen',()=>{points.splice(index,1);render();});
      controls.append(up,down,deleteButton);
      item.appendChild(controls);
      list.appendChild(item);
    });
  }
  function renderMap(){
    if(!map)return;
    for(const marker of markers)marker.remove();
    markers=[];
    if(line){line.remove();line=null;}
    if(!points.length)return;
    for(let i=0;i<points.length;i++){
      const p=points[i];
      const marker=L.marker([p.lat,p.lon],{draggable:true})
        .bindTooltip('WP '+(i+1))
        .addTo(map);
      marker.on('dragend',()=>{
        const pos=marker.getLatLng();
        p.lat=normalizeCoordinate(pos.lat,-90,90);
        p.lon=normalizeCoordinate(pos.lng,-180,180);
        render();
      });
      markers.push(marker);
    }
    if(points.length>1){
      line=L.polyline(points.map(p=>[p.lat,p.lon]),{color:'#44c6e5',weight:4,opacity:.9}).addTo(map);
    }
    if(!hasFit){fitRoute();hasFit=true;}
  }
  function fitRoute(){
    if(!map||!points.length)return;
    if(points.length===1)map.setView([points[0].lat,points[0].lon],Math.max(map.getZoom(),15));
    else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.15),{maxZoom:17});
  }
  function render(){
    renderList();renderMap();
    $('export').disabled=points.length<2;
    if(points.length<2)renderMessage('Mindestens zwei unterschiedliche Wegpunkte setzen.');
    else renderMessage(points.length+' Wegpunkte vorgemerkt. Der KMZ-Export erfolgt lokal.');
  }
  $('add').addEventListener('click',()=>{
    const latRaw=$('latitude').value.trim(),lonRaw=$('longitude').value.trim();
    if(latRaw===''||lonRaw===''){renderMessage('Bitte beide Koordinaten eingeben.',true);return;}
    addPoint(Number(latRaw),Number(lonRaw));
  });
  $('clear').addEventListener('click',()=>{
    if(!points.length)return;
    if(!window.confirm('Alle Wegpunkte aus dem Entwurf entfernen?'))return;
    points.length=0;hasFit=false;render();
  });
  $('fit').addEventListener('click',fitRoute);
  $('mission-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!event.currentTarget.reportValidity())return;
    try{
      const height=Number($('height').value);
      const plan={
        name:$('name').value,model:$('model').value,speed:Number($('speed').value),
        takeoffHeight:Number($('takeoff').value),finishAction:$('finish').value,
        waypoints:points.map(p=>({...p,height}))
      };
      const output=core.build(plan);
      // ZIP construction and XML generation run only on this device.
      const bytes=output.kmz;
      const blob=new Blob([bytes],{type:'application/vnd.google-earth.kmz'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='skyhub-waypoint-'+Date.now()+'.kmz';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      renderMessage('Lokaler KMZ-Entwurf erzeugt: '+output.summary.waypointCount+
        ' Wegpunkte, '+output.summary.photoCount+
        ' Fotoaktionen. NICHT fluggeprüft. Vor Verwendung in DJI Pilot 2 prüfen.');
    }catch(error){
      renderMessage(error instanceof Error?error.message:'KMZ konnte nicht erzeugt werden.',true);
    }
  });
  render();
})();
