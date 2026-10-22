#!/usr/bin/env node
'use strict';
// Isolated, loopback-only UI staging. No DJI/MQTT/S3 clients or Docker operations.
// API requests are forwarded only to an existing SkyHub Next backend.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');

const PUBLIC_ROOT=path.resolve(__dirname,'../frontend/public');
const DEFAULT_PORT=4015;
const DEFAULT_UPSTREAM=4001;
const STATIC=new Map(Object.entries({
  '/':'index.html',
  '/index.html':'index.html',
  '/command-center.html':'command-center.html',
  '/command-center.js':'command-center.js',
  '/command-center-core.js':'command-center-core.js',
  '/telemetry-freshness.js':'telemetry-freshness.js',
  '/wpml-editor.html':'wpml-editor.html',
  '/wpml-editor.js':'wpml-editor.js',
  '/wpml-editor-core.js':'wpml-editor-core.js',
  '/wpml-interval-actions.js':'wpml-interval-actions.js',
  '/wpml-survey-preview.html':'wpml-survey-preview.html',
  '/wpml-survey-preview.js':'wpml-survey-preview.js',
  '/wpml-survey-preview-core.js':'wpml-survey-preview-core.js',
  '/wpml-photogrammetry-core.js':'wpml-photogrammetry-core.js'
}));
const API_READ=new Set([
  '/api/health','/api/devices','/api/topology','/api/events',
  '/api/media/status','/api/media/buckets','/api/media/objects',
  '/api/media/m3m/inventory'
]);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};

function validPort(n){
  return Number.isSafeInteger(n)&&n>=1024&&n<=65535;
}
function parseUrl(raw){
  if(typeof raw!=='string'||raw.length>4096||
    /[\x00-\x1f\x7f\\]/.test(raw)||!raw.startsWith('/'))return null;
  const pathname=raw.split('?',1)[0];
  if(pathname.includes('%')||pathname.includes('//')||
    pathname.split('/').some(s=>s==='.'||s==='..'))return null;
  return {pathname,search:raw.slice(pathname.length)};
}
function isSocketTransport(parsed,transport){
  if(!parsed||parsed.pathname!=='/socket.io/')return false;
  try{
    const p=new URLSearchParams(parsed.search.slice(1));
    return p.get('EIO')==='4'&&p.get('transport')===transport&&
      p.getAll('EIO').length===1&&p.getAll('transport').length===1;
  }catch(_err){return false;}
}
function classify(method,raw){
  const p=parseUrl(raw);
  if(!p)return null;
  if((method==='GET'||method==='HEAD')&&STATIC.has(p.pathname)&&!p.search)
    return {kind:'static',filename:STATIC.get(p.pathname)};
  if(method==='GET'&&(API_READ.has(p.pathname)||
    /^\/api\/drone\/[A-Za-z0-9_-]{1,100}\/(track|telemetry)$/.test(p.pathname)))
    return {kind:'proxy'};
  if(method==='GET'&&p.pathname==='/socket.io/socket.io.js'&&!p.search)
    return {kind:'proxy'};
  if(method==='GET'&&isSocketTransport(p,'polling'))return {kind:'proxy'};
  // Socket.IO POST is used ONLY for Engine.IO's authentication/connect handshake,
  // never for a DJI/media HTTP endpoint. No application write API is forwarded.
  if(method==='POST'&&isSocketTransport(p,'polling'))return {kind:'socket-poll'};
  return null;
}
function commonHeaders(res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
}
function rejection(res,code){
  commonHeaders(res);
  res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8'});
  res.end(code===403?'Forbidden':code===502?'Upstream unavailable':'Not found');
}
function proxyHeaders(req){
  const h={Host:'127.0.0.1','Accept-Encoding':'identity'};
  if(typeof req.headers.authorization==='string')h.Authorization=req.headers.authorization;
  if(typeof req.headers.accept==='string')h.Accept=req.headers.accept;
  if(typeof req.headers['content-type']==='string')h['Content-Type']=req.headers['content-type'];
  return h;
}
function serveFile(req,res,root,filename){
  const file=path.join(root,filename);
  fs.lstat(file,(err,stat)=>{
    if(err||!stat.isFile()||stat.isSymbolicLink())return rejection(res,404);
    commonHeaders(res);
    res.setHeader('Content-Type',MIME[path.extname(filename)]||'application/octet-stream');
    res.setHeader('Content-Length',stat.size);
    if(req.method==='HEAD'){res.writeHead(200);res.end();return;}
    const stream=fs.createReadStream(file);
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  });
}
function forwardHttp(req,res,upstreamPort,kind){
  const headers=proxyHeaders(req);
  if(kind==='socket-poll'){
    const declared=Number(req.headers['content-length']);
    if(!Number.isSafeInteger(declared)||declared<0||declared>16384){
      return rejection(res,403);
    }
    headers['Content-Length']=declared;
  }
  const upstream=http.request({
    hostname:'127.0.0.1',port:upstreamPort,path:req.url,
    method:req.method,headers,timeout:5000
  },up=>{
    commonHeaders(res);
    if(typeof up.headers['content-type']==='string')
      res.setHeader('Content-Type',up.headers['content-type']);
    if(typeof up.headers['content-encoding']==='string')
      res.setHeader('Content-Encoding',up.headers['content-encoding']);
    res.writeHead(up.statusCode||502);
    up.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error',()=>{
    if(!res.headersSent)rejection(res,502);
    else res.destroy();
  });
  if(kind==='socket-poll'){
    let consumed=0;
    req.on('data',chunk=>{
      consumed+=chunk.length;
      if(consumed>16384){upstream.destroy();req.destroy();return;}
      upstream.write(chunk);
    });
    req.on('end',()=>upstream.end());
    req.on('error',()=>upstream.destroy());
  }else upstream.end();
}
function denyUpgrade(socket,code=403){
  if(socket.destroyed)return;
  socket.end('HTTP/1.1 '+code+' Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}
function forwardUpgrade(req,clientSocket,head,upstreamPort){
  const parsed=parseUrl(req.url);
  if(!isSocketTransport(parsed,'websocket')||
    req.headers.upgrade?.toLowerCase()!=='websocket'||
    typeof req.headers['sec-websocket-key']!=='string'||
    req.headers['sec-websocket-version']!=='13'){
    return denyUpgrade(clientSocket);
  }
  const headers={
    Host:'127.0.0.1',Connection:'Upgrade',Upgrade:'websocket',
    'Sec-WebSocket-Key':req.headers['sec-websocket-key'],
    'Sec-WebSocket-Version':'13'
  };
  for(const key of ['sec-websocket-protocol','sec-websocket-extensions']){
    if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
  }
  const upstream=http.request({
    hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:'GET',
    headers,timeout:5000
  });
  upstream.on('upgrade',(response,remote,fromUpstream)=>{
    let reply='HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n';
    for(const key of ['sec-websocket-accept','sec-websocket-protocol','sec-websocket-extensions']){
      if(typeof response.headers[key]==='string')reply+=key+': '+response.headers[key]+'\r\n';
    }
    clientSocket.write(reply+'\r\n');
    if(head.length)remote.write(head);
    if(fromUpstream.length)clientSocket.write(fromUpstream);
    remote.on('error',()=>clientSocket.destroy());
    clientSocket.on('error',()=>remote.destroy());
    remote.pipe(clientSocket);
    clientSocket.pipe(remote);
  });
  upstream.on('response',response=>{
    response.resume();
    denyUpgrade(clientSocket,response.statusCode===401?401:502);
  });
  upstream.on('timeout',()=>upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error',()=>denyUpgrade(clientSocket,502));
  upstream.end();
}
function createStageServer({upstreamPort=DEFAULT_UPSTREAM,publicRoot=PUBLIC_ROOT}={}){
  if(!validPort(upstreamPort))throw new Error('Invalid upstream port');
  const server=http.createServer((req,res)=>{
    const route=classify(req.method,req.url);
    if(!route)return rejection(res,403);
    if(route.kind==='static')return serveFile(req,res,publicRoot,route.filename);
    forwardHttp(req,res,upstreamPort,route.kind);
  });
  server.on('upgrade',(req,socket,head)=>forwardUpgrade(req,socket,head,upstreamPort));
  return server;
}
async function preflight({upstreamPort=DEFAULT_UPSTREAM,publicRoot=PUBLIC_ROOT}={}){
  for(const filename of STATIC.values()){
    const st=fs.lstatSync(path.join(publicRoot,filename),{throwIfNoEntry:false});
    if(!st||!st.isFile()||st.isSymbolicLink())throw new Error('Missing static asset: '+filename);
  }
  const health=await new Promise((resolve,reject)=>{
    const r=http.get({hostname:'127.0.0.1',port:upstreamPort,path:'/api/health',timeout:3500},res=>{
      let body='';
      res.on('data',chunk=>{body+=chunk.toString();if(body.length>16384)r.destroy(new Error('Health size limit'));});
      res.on('end',()=>{
        if(res.statusCode!==200)return reject(new Error('Backend health not available'));
        try{
          const parsed=JSON.parse(body);
          if(parsed.readOnly!==true||!['online','degraded'].includes(parsed.status))
            throw new Error('Unexpected backend health contract');
          resolve({status:parsed.status,mqtt:parsed.mqtt===true,subscribed:parsed.subscribed===true});
        }catch(e){reject(e);}
      });
    });
    r.on('error',reject);
    r.on('timeout',()=>r.destroy(new Error('Backend health timeout')));
  });
  return health;
}
function options(argv){
  if(!['--check','--serve'].includes(argv[0])||argv.length>5)
    throw new Error('Usage: node scripts/command-center-stage.js --check|--serve [--port 4015] [--upstream 4001]');
  const result={mode:argv[0],port:DEFAULT_PORT,upstreamPort:DEFAULT_UPSTREAM};
  const used=new Set();
  for(let i=1;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(used.has(key)||!['--port','--upstream'].includes(key)||
      typeof value!=='string'||!/^[0-9]{4,5}$/.test(value))
      throw new Error('Invalid staging arguments');
    used.add(key);
    result[key==='--port'?'port':'upstreamPort']=Number(value);
  }
  if(!validPort(result.port)||!validPort(result.upstreamPort)||
    result.port===result.upstreamPort||[1883,1884,4000,4001,9000,9001,4443].includes(result.port))
    throw new Error('Unsafe staging port');
  return result;
}
async function main(){
  let settings;
  try{settings=options(process.argv.slice(2));}
  catch(err){console.error(err.message);process.exitCode=2;return;}
  try{
    const report=await preflight({upstreamPort:settings.upstreamPort});
    console.log('Existing SkyHub Next backend: '+report.status+
      '; MQTT connected: '+report.mqtt+'; subscribed: '+report.subscribed+'.');
    if(settings.mode==='--check'){
      console.log('CHECK OK: no services started or changed; no DJI identifiers or secrets read.');
      return;
    }
    const server=createStageServer({upstreamPort:settings.upstreamPort});
    server.on('error',err=>{console.error('Loopback staging failed: '+err.code);process.exitCode=1;});
    server.listen(settings.port,'127.0.0.1',()=>{
      console.log('STAGING only on http://127.0.0.1:'+settings.port+'/command-center.html');
      console.log('Ctrl+C to stop. No MQTT/DJI/S3 connections started.');
    });
  }catch(err){console.error('STAGING REFUSED: '+err.message);process.exitCode=1;}
}
if(require.main===module)main();
module.exports={createStageServer,classify,parseUrl,isSocketTransport,options,preflight,STATIC};
