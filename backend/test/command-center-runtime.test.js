'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../../frontend/public/command-center-core');
const base=path.resolve(__dirname,'../../frontend/public');
const html=fs.readFileSync(path.join(base,'command-center.html'),'utf8');
const script=fs.readFileSync(path.join(base,'command-center.js'),'utf8');

function harness(responses){
  const nodes=new Map();
  let activeElement=null;
  class Element{
    constructor(tag='div'){
      this.tagName=tag;
      this.children=[];
      this.listeners=Object.create(null);
      this.dataset={};
      this.value='';
      this.disabled=false;
      this.hidden=false;
      this.scrollTop=0;
      this._text='';
    }
    get textContent(){return this._text+this.children.map(x=>x.textContent||'').join('');}
    set textContent(v){this._text=String(v);this.children=[];}
    replaceChildren(...items){this._text='';this.children=items;}
    append(...items){this.children.push(...items);}
    setAttribute(name,value){this[name]=String(value);}
    addEventListener(name,callback){this.listeners[name]=callback;}
    click(){if(typeof this.listeners.click!=='function')throw new Error('No click listener');this.listeners.click();}
    change(type='change'){if(typeof this.listeners[type]!=='function')throw new Error('No event listener');this.listeners[type]();}
    focus(){activeElement=this;}
  }
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Element());
  const document={
    getElementById:id=>nodes.get(id),
    createElement:tag=>new Element(tag),
    querySelectorAll:()=>[],
    get activeElement(){return activeElement;}
  };
  const pendingTimers=[];
  const requests=[];
  const eventHandlers=Object.create(null);
  const fakeSocket={
    on(event,callback){eventHandlers[event]=callback;},
    disconnect(){},
    receive(event,data){assert.equal(typeof eventHandlers[event],'function');eventHandlers[event](data);}
  };
  const fetch=async(url,opts={})=>{
    requests.push({url,opts});
    const handler=typeof responses==='function'?responses:responses[url];
    if(typeof handler!=='function')throw new Error('Unexpected URL '+url);
    return handler(url,opts);
  };
  const context={
    window:{SkyHubCommandCenterCore:core,L:undefined},
    document,fetch,io:()=>fakeSocket,
    setInterval:()=>0,
    setTimeout:fn=>{pendingTimers.push(fn);return pendingTimers.length;},
    console
  };
  vm.runInNewContext(script,context,{filename:'command-center.js'});
  return {nodes,requests,fakeSocket,pendingTimers};
}
function ok(value){return {ok:true,json:async()=>value};}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}

test('MinIO read-only pagination navigates two different real metadata pages',async()=>{
  const pages=[];
  const h=harness((url)=>{
    if(url==='/api/devices')return ok([]);
    if(url==='/api/health')return ok({status:'online',mqtt:true,redis:true,subscribed:true});
    if(url==='/api/media/buckets')return ok({buckets:['dji-cloud']});
    if(url.startsWith('/api/media/objects?')){
      pages.push(url);
      if(url.includes('cursor=next-page'))return ok({
        bucket:'dji-cloud',prefix:'M3M/',truncated:false,nextCursor:null,
        objects:[{key:'M3M/second_MS_NIR.TIF',size:2048,lastModified:null}]
      });
      return ok({
        bucket:'dji-cloud',prefix:'M3M/',truncated:true,nextCursor:'next-page',
        objects:[{key:'M3M/first_D.JPG',size:100,lastModified:'2026-10-22T10:00:00Z'}]
      });
    }
    throw new Error('Unknown request '+url);
  });
  await flush();
  assert.equal(h.nodes.get('load-buckets').disabled,false);
  h.nodes.get('load-buckets').click();await flush();
  h.nodes.get('bucket').value='dji-cloud';
  h.nodes.get('prefix').value='M3M/';
  h.nodes.get('prefix').change('input');
  h.nodes.get('load-objects').click();await flush();
  assert.equal(h.nodes.get('media-page').textContent,'Seite 1');
  assert.equal(h.nodes.get('media-next').disabled,false);
  assert.equal(h.nodes.get('objects').children.length,1);
  assert.match(h.nodes.get('objects').textContent,/first_D.JPG/);
  h.nodes.get('media-next').click();await flush();
  assert.equal(h.nodes.get('media-page').textContent,'Seite 2');
  assert.equal(h.nodes.get('media-next').disabled,true);
  assert.equal(h.nodes.get('media-prev').disabled,false);
  assert.match(h.nodes.get('objects').textContent,/second_MS_NIR.TIF/);
  h.nodes.get('media-prev').click();await flush();
  assert.equal(h.nodes.get('media-page').textContent,'Seite 1');
  assert.equal(pages.length,3);
  assert.match(pages[1],/cursor=next-page/);
  for(const req of h.requests)assert.equal((req.opts.method||'GET').toUpperCase(),'GET');
});

test('changed prefix invalidates the old in-flight MinIO listing',async()=>{
  let deliver;
  const h=harness(url=>{
    if(url==='/api/devices')return ok([]);
    if(url==='/api/health')return ok({});
    if(url==='/api/media/buckets')return ok({buckets:['dji-cloud']});
    if(url.startsWith('/api/media/objects?'))return new Promise(resolve=>{deliver=resolve;});
    throw new Error('Unexpected URL '+url);
  });
  await flush();
  h.nodes.get('load-buckets').click();await flush();
  h.nodes.get('bucket').value='dji-cloud';
  h.nodes.get('prefix').value='old/';
  h.nodes.get('load-objects').click();await flush();
  assert.equal(typeof deliver,'function');
  h.nodes.get('prefix').value='new/';
  h.nodes.get('prefix').change('input');
  deliver(ok({
    bucket:'dji-cloud',prefix:'old/',truncated:false,nextCursor:null,
    objects:[{key:'old/private.JPG',size:8,lastModified:null}]
  }));
  await flush();
  assert.equal(h.nodes.get('objects').children.length,0);
  assert.equal(h.nodes.get('media-next').disabled,true);
  assert.equal(h.nodes.get('media-page').textContent,'Seite —');
});

test('malformed pagination cursor fails closed in the browser',async()=>{
  const h=harness(url=>{
    if(url==='/api/devices')return ok([]);
    if(url==='/api/health')return ok({});
    if(url==='/api/media/buckets')return ok({buckets:['dji-cloud']});
    if(url.startsWith('/api/media/objects?'))return ok({
      bucket:'dji-cloud',prefix:'M3M/',truncated:true,nextCursor:null,
      objects:[{key:'M3M/a.JPG',size:1,lastModified:null}]
    });
    throw new Error('Unexpected URL '+url);
  });
  await flush();
  h.nodes.get('load-buckets').click();await flush();
  h.nodes.get('bucket').value='dji-cloud';
  h.nodes.get('prefix').value='M3M/';
  h.nodes.get('load-objects').click();await flush();
  assert.equal(h.nodes.get('objects').children.length,0);
  assert.match(h.nodes.get('media-message').textContent,/Ungültige MinIO/);
  assert.equal(h.nodes.get('media-next').disabled,true);
});

test('socket device updates coalesce into one scheduled render',async()=>{
  const h=harness(url=>{
    if(url==='/api/devices')return ok([]);
    if(url==='/api/health')return ok({});
    throw new Error('Unexpected URL '+url);
  });
  await flush();
  const now=Date.now();
  for(let i=0;i<50;i++)h.fakeSocket.receive('device_update',{
    sn:'safe-device',role:'aircraft',modelName:'Mavic 3M',
    lastTelemetryAt:now,aircraftConnected:true,telemetry:{battery:75}
  });
  assert.equal(h.pendingTimers.length,1,'renders should not run for each OSD packet');
  h.pendingTimers.shift()();
  assert.equal(h.nodes.get('count').textContent,'1');
  assert.equal(h.nodes.get('devices').children.length,1);
});
