'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws');
const {createStageServer,classify,parseUrl,expectedLocalRequest,options,preflight,STATIC}=
  require('../../scripts/command-center-stage');

async function listen(server){
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server.address().port;
}
async function close(server){
  await new Promise((resolve,reject)=>{
    server.close(err=>err?reject(err):resolve());
    server.closeAllConnections?.();
  });
}
async function request(port,url,{method='GET',body='',headers={}}={}){
  return new Promise((resolve,reject)=>{
    const r=http.request({hostname:'127.0.0.1',port,path:url,method,headers},res=>{
      const data=[];
      res.on('data',chunk=>data.push(chunk));
      res.on('end',()=>resolve({
        status:res.statusCode,headers:res.headers,body:Buffer.concat(data).toString('utf8')
      }));
    });
    r.on('error',reject);
    if(body)r.write(body);
    r.end();
  });
}

test('gateway routing is strictly allowlisted and blocks DJI/S3 writes and pilot identity endpoints',()=>{
  assert.deepEqual(classify('GET','/command-center.html'),{kind:'static',filename:'command-center.html'});
  assert.deepEqual(classify('GET','/api/media/objects?bucket=dji-cloud'),{kind:'proxy'});
  assert.deepEqual(classify('GET','/api/devices'),{kind:'proxy'});
  assert.equal(classify('POST','/api/media/objects'),null);
  assert.equal(classify('DELETE','/api/media/objects'),null);
  assert.equal(classify('POST','/storage/api/v1/workspaces/example/sts'),null);
  assert.equal(classify('GET','/api/pilot-admin'),null);
  assert.equal(classify('GET','/pilot-login.html'),null);
  assert.equal(classify('GET','/.env'),null);
  assert.equal(classify('GET','/../.env'),null);
  assert.equal(classify('GET','/%2e%2e/.env'),null);
  assert.equal(classify('GET','/api/media/objects//../pilot-admin'),null);
  assert.equal(classify('GET','/socket.io/?EIO=4&transport=polling')?.kind,'proxy');
  assert.equal(classify('POST','/socket.io/?EIO=4&transport=polling')?.kind,'socket-poll');
  assert.equal(classify('POST','/socket.io/?EIO=4&transport=websocket'),null);
  assert.equal(classify('GET','/socket.io/?EIO=4&EIO=4&transport=polling'),null);
  assert.equal(parseUrl('/api/devices?abc=%0A').pathname,'/api/devices');
});

test('staging origin and Host must match exact local loopback port',()=>{
  const good={headers:{host:'127.0.0.1:4015',origin:'http://localhost:4015'}};
  assert.equal(expectedLocalRequest(good,4015),true);
  assert.equal(expectedLocalRequest({headers:{host:'localhost:4015'}},4015),true);
  assert.equal(expectedLocalRequest({headers:{host:'example.org:4015'}},4015),false);
  assert.equal(expectedLocalRequest({headers:{host:'127.0.0.1:4015',origin:'https://bad.site'}},4015),false);
  assert.equal(expectedLocalRequest({headers:{host:'127.0.0.1:4015',origin:'null'}},4015),false);
  assert.equal(expectedLocalRequest({headers:{host:'127.0.0.1:4015','sec-fetch-site':'cross-site'}},4015),false);
});

test('port guard never takes existing Pi service ports',()=>{
  assert.deepEqual(options(['--check']),{mode:'--check',port:4015,upstreamPort:4001});
  assert.throws(()=>options(['--serve','--port','4001']),/Unsafe/);
  assert.throws(()=>options(['--serve','--port','1884']),/Unsafe/);
  assert.throws(()=>options(['--serve','--port','9000']),/Unsafe/);
  assert.throws(()=>options(['--serve','--port','5555','--upstream','5555']),/Unsafe/);
  assert.throws(()=>options(['--serve','--port','bad']),/Invalid/);
  assert.throws(()=>options(['--apply']),/Usage/);
});

test('existing read-only static assets have exact allowlist and no symlinks',async()=>{
  const files=[...new Set(STATIC.values())];
  assert.ok(files.includes('command-center.html'));
  assert.ok(files.includes('wpml-editor.html'));
  assert.equal(files.some(x=>x.endsWith('.env')||x.includes('pilot-login')),false);
  const upstream=http.createServer((req,res)=>{
    if(req.url==='/api/health'){
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({status:'degraded',readOnly:true,mqtt:false,subscribed:false}));
    }else res.writeHead(404).end();
  });
  const port=await listen(upstream);
  try{
    const state=await preflight({upstreamPort:port});
    assert.deepEqual(state,{status:'degraded',mqtt:false,subscribed:false});
  }finally{await close(upstream);}
});

test('staging serves allowlisted HTML, forwards authorized GET and blocks all DJI HTTP writes',async()=>{
  const upstreamRequests=[];
  const upstream=http.createServer((req,res)=>{
    upstreamRequests.push({method:req.method,url:req.url,
      authorization:req.headers.authorization,
      customHeader:req.headers['x-forwarded-for']});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,method:req.method,url:req.url}));
  });
  const remote=await listen(upstream);
  const stage=createStageServer({upstreamPort:remote});
  const port=await listen(stage);
  try{
    const page=await request(port,'/command-center.html');
    assert.equal(page.status,200);
    assert.match(page.body,/SkyHub Next/);
    assert.match(page.headers['cache-control'],/no-store/);
    const script=await request(port,'/command-center.js');
    assert.equal(script.status,200);
    assert.match(script.headers['content-type'],/javascript/);
    const forbidden=await request(port,'/api/pilot-admin');
    assert.equal(forbidden.status,403);
    const rebound=await request(port,'/api/devices',{headers:{Host:'evil.example:'+port}});
    assert.equal(rebound.status,403);
    const crossOrigin=await request(port,'/api/devices',{headers:{Origin:'https://evil.example'}});
    assert.equal(crossOrigin.status,403);
    const pilot=await request(port,'/pilot-login.html');
    assert.equal(pilot.status,403);
    const post=await request(port,'/api/media/objects',{method:'POST',body:'{}'});
    assert.equal(post.status,403);
    const ok=await request(port,'/api/devices',{headers:{
      Authorization:'Bearer test-secret','X-Forwarded-For':'203.0.113.50'
    }});
    assert.equal(ok.status,200);
    assert.deepEqual(upstreamRequests,[{
      method:'GET',url:'/api/devices',authorization:'Bearer test-secret',customHeader:undefined
    }]);
    assert.equal(ok.body.includes('test-secret'),false);
  }finally{await close(stage);await close(upstream);}
});

test('upgrade tunnel permits only Socket.IO WebSocket transport and preserves message bytes',async()=>{
  const upstream=http.createServer((_req,res)=>res.writeHead(404).end());
  const wss=new WebSocketServer({noServer:true});
  upstream.on('upgrade',(req,socket,head)=>{
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.on('message',msg=>ws.send(msg.toString()));
    });
  });
  const remote=await listen(upstream);
  const stage=createStageServer({upstreamPort:remote});
  const port=await listen(stage);
  const client=new WebSocket('ws://127.0.0.1:'+port+'/socket.io/?EIO=4&transport=websocket');
  try{
    await once(client,'open');
    client.send('40{"token":"test"}');
    const [message]=await once(client,'message');
    assert.equal(message.toString(),'40{"token":"test"}');
  }finally{
    client.terminate();
    for(const ws of wss.clients)ws.terminate();
    await close(stage);await close(upstream);
    wss.close();
  }
});
