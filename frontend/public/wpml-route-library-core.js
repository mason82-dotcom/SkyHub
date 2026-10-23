'use strict';
/* Local, opt-in route library; no backend API, telemetry, or flight dispatch. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-editor-core'));
  else root.SkyHubWpmlRouteLibrary=factory(root.SkyHubWpmlPlanner);
})(typeof globalThis==='object'?globalThis:this,function(planner){
  const SCHEMA='skyhub-local-waypoint-library-v1',MAX_ROUTES=32,MAX_REVISIONS=12;
  const MAX_BYTES=512*1024;
  function invalid(){throw new TypeError('Ungültige oder zu große lokale Routenbibliothek');}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function text(v,max=70){
    if(typeof v!=='string'||!v.trim()||v.length>max||
      /[\u0000-\u001f\u007f]/.test(v))invalid();
    return v.trim();
  }
  function blank(){return {schema:SCHEMA,nextId:1,routes:[]};}
  function check(db){
    if(!db||typeof db!=='object'||Array.isArray(db)||
       db.schema!==SCHEMA||!Number.isSafeInteger(db.nextId)||db.nextId<1||
       !Array.isArray(db.routes)||db.routes.length>MAX_ROUTES)invalid();
    const ids=new Set();
    for(const route of db.routes){
      if(!route||typeof route!=='object'||!Number.isSafeInteger(route.id)||
         route.id<1||route.id>=db.nextId||ids.has(route.id))invalid();
      ids.add(route.id);
      text(route.name);text(route.folder,40);
      if(!Array.isArray(route.revisions)||route.revisions.length<1||
         route.revisions.length>MAX_REVISIONS)invalid();
      for(let i=0;i<route.revisions.length;i++){
        const v=route.revisions[i];
        if(!v||v.revision!==i+1||!Number.isSafeInteger(v.savedAt)||
           v.savedAt<0||v.flightReady!==false)invalid();
        try{planner.normalize(v.plan);}catch{invalid();}
        if(v.plan.name!==route.revisions[i].plan.name)invalid();
      }
    }
    if(JSON.stringify(db).length>MAX_BYTES)invalid();
    return clone(db);
  }
  function save(db,options){
    const state=check(db);
    if(!options||typeof options!=='object')invalid();
    const name=text(options.name);
    const folder=text(options.folder||'Allgemein',40);
    let normalized;
    try{normalized=planner.normalize(options.plan);}catch{invalid();}
    // Only the editable subset is persisted. Never store external model objects,
    // KMZ bytes, unknown properties, or execution/flight-ready approval flags.
    const plan={
      name:normalized.name,model:normalized.modelKey,speed:normalized.speed,
      transitionSpeed:normalized.transitionSpeed,takeoffHeight:normalized.takeoffHeight,
      finishAction:normalized.finishAction,timestamp:normalized.timestamp,
      waypoints:normalized.waypoints.map(p=>({
        lat:p.lat,lon:p.lon,height:p.height,photo:p.photo,
        ...(p.ellipsoidHeight===null?{}:{ellipsoidHeight:p.ellipsoidHeight})
      })),
      ...(normalized.intervalPhotos?{intervalPhotos:{
        type:normalized.intervalPhotos.type,interval:normalized.intervalPhotos.interval,
        ...(normalized.intervalPhotos.cameraMinIntervalSeconds===null?{}:
          {cameraMinIntervalSeconds:normalized.intervalPhotos.cameraMinIntervalSeconds})
      }}:{}),
      ...(normalized.actionGroups.length?{actionGroups:normalized.actionGroups}: {})
    };
    const id=options.routeId;
    let route;
    if(id===undefined||id===null){
      if(state.routes.length===MAX_ROUTES)invalid();
      route={id:state.nextId++,name,folder,revisions:[]};
      state.routes.push(route);
    }else{
      if(!Number.isSafeInteger(id))invalid();
      route=state.routes.find(r=>r.id===id);
      if(!route||route.revisions.length>=MAX_REVISIONS)invalid();
      route.name=name;route.folder=folder;
    }
    const now=options.savedAt??Date.now();
    if(!Number.isSafeInteger(now)||now<0||now>9999999999999)invalid();
    route.revisions.push({revision:route.revisions.length+1,savedAt:now,
      plan,flightReady:false});
    const validated=check(state);
    return {library:validated,routeId:route.id,revision:route.revisions.length,flightReady:false};
  }
  function find(db,id,revision){
    const state=check(db);
    const r=state.routes.find(x=>x.id===id);
    if(!r)invalid();
    const v=revision==null?r.revisions[r.revisions.length-1]:
      r.revisions.find(x=>x.revision===revision);
    if(!v)invalid();
    return {id:r.id,name:r.name,folder:r.folder,revision:v.revision,
      savedAt:v.savedAt,plan:clone(v.plan),flightReady:false};
  }
  function list(db){
    return check(db).routes.map(r=>({id:r.id,name:r.name,folder:r.folder,
      revisionCount:r.revisions.length,latestRevision:r.revisions.length,
      latestSavedAt:r.revisions[r.revisions.length-1].savedAt,flightReady:false}));
  }
  function remove(db,id){
    const state=check(db),at=state.routes.findIndex(r=>r.id===id);
    if(at<0)invalid();
    state.routes.splice(at,1);return check(state);
  }
  function copy(db,id,options={}){
    const origin=find(db,id,options.revision);
    return save(db,{name:options.name||origin.name+' Kopie',
      folder:options.folder||origin.folder,plan:origin.plan,savedAt:options.savedAt});
  }
  function load(raw){
    if(typeof raw!=='string'||raw.length>MAX_BYTES)invalid();
    let obj;
    try{obj=JSON.parse(raw);}catch{invalid();}
    return check(obj);
  }
  function serialize(db){return JSON.stringify(check(db));}
  return Object.freeze({SCHEMA,blank,check,save,find,list,remove,copy,load,serialize,
    MAX_ROUTES,MAX_REVISIONS});
});
