'use strict';
const crypto=require('crypto');

// Pilot 2 device pairing: the RC shows a short code, an operator holding the
// SkyHub view token approves it once, and the RC receives its own revocable
// device token. Only SHA-256 hashes of device tokens are stored.
const TOKEN=/^[0-9a-f]{64}$/;
const PAIRING_ID=/^[0-9a-f]{32}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hash(token){return crypto.createHash('sha256').update(token).digest('hex');}

// Device model from the Pilot 2 WebView user agent, e.g. "DJI RC Pro Enterprise".
function deviceModel(userAgent){
  const match=/\b(DJI [A-Za-z0-9 ]{1,40}?) Build\//.exec(String(userAgent||''));
  return match?match[1]:'Unbekanntes Gerät';
}

function createPilotPairing({store,workspaceId=null,ttlMs=300000,maxPending=5,randomBytes=crypto.randomBytes,
  randomInt=crypto.randomInt}={}){
  if(!store)throw new Error('Pairing store required');
  const pending=new Map();
  function prune(now){
    for(const [id,item] of pending)if(item.expiresAt<=now)pending.delete(id);
  }
  // Pilot 2 loads the page twice per open and reloads it: reuse the open code of
  // the same client, and displace the oldest unapproved code instead of locking out.
  function start(userAgent,now=Date.now(),clientKey=null){
    prune(now);
    if(clientKey){
      for(const [id,item] of pending){
        if(item.clientKey===clientKey && !item.approved)
          return {pairingId:id,code:item.code,expiresAt:item.expiresAt};
      }
    }
    if(pending.size>=maxPending){
      const oldest=[...pending].find(([,item])=>!item.approved);
      if(!oldest)return null;
      pending.delete(oldest[0]);
    }
    const codes=new Set([...pending.values()].map(item=>item.code));
    let code;
    do{code=String(randomInt(0,1000000)).padStart(6,'0');}while(codes.has(code));
    const id=randomBytes(16).toString('hex');
    const item={code,model:deviceModel(userAgent),clientKey,createdAt:now,expiresAt:now+ttlMs,approved:false};
    pending.set(id,item);
    return {pairingId:id,code,expiresAt:item.expiresAt};
  }
  function approve(code,now=Date.now()){
    prune(now);
    if(typeof code!=='string' || !/^\d{6}$/.test(code))return false;
    for(const item of pending.values()){
      if(item.code===code && !item.approved){item.approved=true;return true;}
    }
    return false;
  }
  // The device token is handed out exactly once, to the holder of the pairing ID.
  async function poll(id,now=Date.now()){
    prune(now);
    if(typeof id!=='string' || !PAIRING_ID.test(id))return {status:'unknown'};
    const item=pending.get(id);
    if(!item)return {status:'expired'};
    if(!item.approved)return {status:'pending',code:item.code,expiresAt:item.expiresAt};
    pending.delete(id);
    const deviceToken=randomBytes(32).toString('hex');
    const key=hash(deviceToken);
    // Bind new paired devices to the server-configured workspace, never to
    // client input. Legacy unscoped devices remain valid for bootstrap but
    // cannot access DJI map groups until paired again.
    const device={id:key.slice(0,12),model:item.model,createdAt:now,lastUsedAt:null};
    if(typeof workspaceId==='string'&&UUID.test(workspaceId))device.workspaceId=workspaceId;
    await store.set(key,JSON.stringify(device));
    return {status:'approved',deviceToken};
  }
  async function verify(token,now=Date.now()){
    if(typeof token!=='string' || !TOKEN.test(token))return null;
    const key=hash(token);
    const raw=await store.get(key);
    if(!raw)return null;
    let device;
    try{device=JSON.parse(raw);}catch{return null;}
    device.lastUsedAt=now;
    await store.set(key,JSON.stringify(device));
    return device;
  }
  async function devices(){
    const all=await store.all();
    return Object.values(all||{}).map(raw=>{try{return JSON.parse(raw);}catch{return null;}})
      .filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt);
  }
  async function revoke(deviceId){
    if(typeof deviceId!=='string' || !/^[0-9a-f]{12}$/.test(deviceId))return false;
    const all=await store.all();
    const key=Object.keys(all||{}).find(k=>k.startsWith(deviceId));
    if(!key)return false;
    await store.del(key);
    return true;
  }
  function pendingList(now=Date.now()){
    prune(now);
    return [...pending.values()].map(({code,model,createdAt,expiresAt,approved})=>
      ({code,model,createdAt,expiresAt,approved}));
  }
  return {start,approve,poll,verify,devices,revoke,pending:pendingList};
}

// Redis-backed store: one hash, field = token hash, value = device metadata JSON.
function redisStore(redis,key='skyhub:pilot:devices'){
  return {
    get:field=>redis.hget(key,field),
    set:(field,value)=>redis.hset(key,field,value),
    del:field=>redis.hdel(key,field),
    all:()=>redis.hgetall(key)
  };
}

module.exports={createPilotPairing,redisStore,deviceModel};
