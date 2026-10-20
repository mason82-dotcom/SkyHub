#!/usr/bin/env node
'use strict';
// EMQX hardening for the existing skyhub_emqx (5.3) on the Raspberry Pi.
//   node scripts/pi-emqx-harden.js plan       show users (names only) and ACL rules
//   node scripts/pi-emqx-harden.js apply      authentication + ACL, verified, auto-rollback
//   node scripts/pi-emqx-harden.js verify     re-run the ACL probes
//   node scripts/pi-emqx-harden.js rollback   back to anonymous access and allow-all
// Uses a temporary EMQX dashboard admin created via `emqx ctl` and deleted afterwards.
// Credentials come from ./.env and are never printed.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const CONTAINER='skyhub_emqx';
const API='http://127.0.0.1:18084/api/v5';
const AUTHN_ID=encodeURIComponent('password_based:built_in_database');
const HEALTH='http://127.0.0.1:'+(readEnv().SKYHUB_HTTP_PORT||'4001')+'/api/health';

function readEnv(){
  const env={};
  for(const line of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split('\n')){
    const m=/^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if(m)env[m[1]]=m[2];
  }
  return env;
}
function accounts(){
  const env=readEnv();
  const list={
    reader:{username:env.MQTT_USER,password:env.MQTT_PASSWORD},
    ack:{username:env.SKYHUB_TOPOLOGY_ACK_MQTT_USER,password:env.SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD},
    pilot:{username:env.SKYHUB_PILOT_MQTT_USER,password:env.SKYHUB_PILOT_MQTT_PASSWORD}
  };
  for(const [role,a] of Object.entries(list)){
    if(!a.username || !/^[A-Za-z0-9_.-]{1,64}$/.test(a.username))throw new Error(role+': ungültiger MQTT-Benutzername in .env');
    if(!a.password || a.password.length<16)throw new Error(role+': MQTT-Passwort fehlt oder zu kurz');
  }
  const names=new Set(Object.values(list).map(a=>a.username));
  if(names.size!==3)throw new Error('Reader, Topologie-Publisher und Pilot brauchen verschiedene Benutzer');
  return list;
}
const q=topics=>'['+topics.map(t=>JSON.stringify(t)).join(', ')+']';
function rules(a){
  return [
    '%% SkyHub Next - managed by scripts/pi-emqx-harden.js. Last rule denies everything else.',
    '',
    '%% SkyHub Next read-only subscriber',
    '{allow, {username, '+JSON.stringify(a.reader.username)+'}, subscribe, '+q([
      'sys/product/+/status','thing/product/+/osd','thing/product/+/state',
      'thing/product/+/events','thing/product/+/services_reply'])+'}.',
    '',
    '%% DJI topology acknowledgement publisher (status_reply only)',
    '{allow, {username, '+JSON.stringify(a.ack.username)+'}, publish, '+q(['sys/product/+/status_reply'])+'}.',
    '',
    '%% DJI Pilot 2 gateway: device reports up, cloud replies/services down.',
    '%% "+" instead of the RC serial: the RC also publishes for its aircraft.',
    '{allow, {username, '+JSON.stringify(a.pilot.username)+'}, publish, '+q([
      'sys/product/+/status','thing/product/+/osd','thing/product/+/state',
      'thing/product/+/events','thing/product/+/services_reply','thing/product/+/requests',
      'thing/product/+/property/set_reply','thing/product/+/drc/up'])+'}.',
    '{allow, {username, '+JSON.stringify(a.pilot.username)+'}, subscribe, '+q([
      'sys/product/+/status_reply','sys/product/+/network/probe','thing/product/+/services',
      'thing/product/+/property/set','thing/product/+/events_reply','thing/product/+/requests_reply',
      'thing/product/+/state_reply','thing/product/+/drc/down'])+'}.',
    '',
    '{deny, all}.',
    ''
  ].join('\n');
}
// Original rules of the emqx/emqx:5.3.0 image, used for rollback.
function originalRules(){
  return fs.readFileSync(path.join(ROOT,'stacks/legacy-skyhub/running-emqx/acl.conf'),'utf8');
}
function ctl(...args){
  return execFileSync('docker',['exec',CONTAINER,'emqx','ctl',...args],{encoding:'utf8'});
}
async function withAdmin(fn){
  const user='skyhub_harden_'+crypto.randomBytes(3).toString('hex');
  const password=crypto.randomBytes(24).toString('base64url');
  ctl('admins','add',user,password,'temporary hardening admin');
  try{
    const res=await fetch(API+'/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:user,password})});
    if(!res.ok)throw new Error('EMQX-Login fehlgeschlagen (HTTP '+res.status+')');
    const {token}=await res.json();
    const api=async(method,urlPath,body)=>{
      const r=await fetch(API+urlPath,{method,headers:{'Authorization':'Bearer '+token,
        ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      const text=await r.text();
      let json=null;try{json=JSON.parse(text);}catch(_){}
      return {status:r.status,json};
    };
    return await fn(api);
  }finally{
    try{ctl('admins','del',user);}catch(_){console.error('WARNUNG: temporären Admin '+user+' bitte manuell löschen');}
  }
}
const authenticator=enable=>({mechanism:'password_based',backend:'built_in_database',
  user_id_type:'username',password_hash_algorithm:{name:'sha256',salt_position:'suffix'},enable});

async function setAuthn(api,a){
  const existing=await api('GET','/authentication/'+AUTHN_ID);
  if(existing.status===404){
    const created=await api('POST','/authentication',authenticator(false));
    if(created.status!==200)throw new Error('Authenticator anlegen fehlgeschlagen (HTTP '+created.status+')');
  }
  for(const account of Object.values(a)){
    let r=await api('POST','/authentication/'+AUTHN_ID+'/users',
      {user_id:account.username,password:account.password,is_superuser:false});
    if(r.status===409)r=await api('PUT','/authentication/'+AUTHN_ID+'/users/'+encodeURIComponent(account.username),
      {password:account.password,is_superuser:false});
    if(r.status!==200 && r.status!==201)throw new Error('Benutzer anlegen fehlgeschlagen (HTTP '+r.status+')');
  }
  const enabled=await api('PUT','/authentication/'+AUTHN_ID,authenticator(true));
  if(enabled.status!==200)throw new Error('Authenticator aktivieren fehlgeschlagen (HTTP '+enabled.status+')');
}
async function setAuthz(api,ruleText,noMatch){
  const src=await api('PUT','/authorization/sources/file',{type:'file',enable:true,rules:ruleText});
  if(src.status!==204 && src.status!==200)throw new Error('ACL setzen fehlgeschlagen (HTTP '+src.status+')');
  const set=await api('PUT','/authorization/settings',{no_match:noMatch,deny_action:'ignore',
    cache:{enable:true,max_size:32,ttl:'1m'}});
  if(set.status!==200)throw new Error('ACL-Grundeinstellung fehlgeschlagen (HTTP '+set.status+')');
  ctl('authz','cache-clean','all');
}
async function rollback(api){
  await setAuthz(api,originalRules(),'allow');
  const del=await api('DELETE','/authentication/'+AUTHN_ID);
  if(del.status!==204 && del.status!==404)throw new Error('Authenticator entfernen fehlgeschlagen (HTTP '+del.status+')');
}

// Probes run inside the SkyHub Next backend container (MQTT.js, same network path).
// Credentials go through stdin, never through argv.
function probe(cases){
  const program=`
const mqtt=require('/app/backend/node_modules/mqtt');
const cases=${JSON.stringify(cases)};
function run(c){return new Promise(resolve=>{
  const opts={clientId:'skyhub_acl_probe_'+Math.random().toString(16).slice(2,8),protocolVersion:5,
    reconnectPeriod:0,connectTimeout:5000};
  if(c.username)opts.username=c.username;
  if(c.password)opts.password=c.password;
  const cl=mqtt.connect('mqtt://host.docker.internal:1884',opts);
  const done=r=>{cl.end(true);resolve(r);};
  const timer=setTimeout(()=>done('timeout'),8000);
  cl.on('error',err=>{clearTimeout(timer);done('refused:'+(err.code??'?'));});
  cl.on('connect',()=>{
    if(c.action==='connect'){clearTimeout(timer);return done('connected');}
    if(c.action==='subscribe')return cl.subscribe(c.topic,{qos:1},(err,granted)=>{
      // MQTT.js reports a refused subscription as an error message, not a reason code.
      clearTimeout(timer);
      done(err?(/not authorized/i.test(err.message)?'denied':'error'):granted?.[0]?.qos>=128?'denied':'granted');});
    cl.publish(c.topic,'{}',{qos:1},(err)=>{clearTimeout(timer);
      done(err?(err.code===135||/not authorized/i.test(err.message)?'denied':'error:'+err.code):'allowed');});
  });
});}
(async()=>{const out=[];for(const c of cases)out.push(await run(c));console.log(JSON.stringify(out));})();`;
  const out=execFileSync('docker',['compose','exec','-T','backend','node','-'],
    {cwd:ROOT,input:program,encoding:'utf8',timeout:120000});
  return JSON.parse(out.trim().split('\n').pop());
}
function connectCases(a){
  return [
    {name:'anonym verbinden',action:'connect',expect:/^refused/},
    {name:'falsches Passwort',action:'connect',username:a.reader.username,password:'x'.repeat(20),expect:/^refused/},
    {name:'Reader verbinden',action:'connect',...a.reader,expect:/^connected$/},
    {name:'Topologie-Publisher verbinden',action:'connect',...a.ack,expect:/^connected$/},
    {name:'Pilot-Konto verbinden',action:'connect',...a.pilot,expect:/^connected$/}
  ];
}
// SKYHUBPROBE never exists; probes publish nothing SkyHub would ingest.
function aclCases(a){
  return [
    {name:'Reader abonniert OSD',action:'subscribe',topic:'thing/product/+/osd',...a.reader,expect:/^granted$/},
    {name:'Reader abonniert alles (#)',action:'subscribe',topic:'#',...a.reader,expect:/^denied$/},
    {name:'Reader sendet services',action:'publish',topic:'thing/product/SKYHUBPROBE/services',...a.reader,expect:/^denied$/},
    {name:'Publisher sendet status_reply',action:'publish',topic:'sys/product/SKYHUBPROBE/status_reply',...a.ack,expect:/^allowed$/},
    {name:'Publisher sendet services',action:'publish',topic:'thing/product/SKYHUBPROBE/services',...a.ack,expect:/^denied$/},
    {name:'Publisher liest status',action:'subscribe',topic:'sys/product/+/status',...a.ack,expect:/^denied$/},
    {name:'Pilot abonniert services',action:'subscribe',topic:'thing/product/SKYHUBPROBE/services',...a.pilot,expect:/^granted$/},
    {name:'Pilot liest fremdes OSD',action:'subscribe',topic:'thing/product/+/osd',...a.pilot,expect:/^denied$/},
    {name:'Pilot fälscht status_reply',action:'publish',topic:'sys/product/SKYHUBPROBE/status_reply',...a.pilot,expect:/^denied$/}
  ];
}
function report(cases){
  const results=probe(cases.map(({expect,name,...c})=>c));
  let ok=true;
  cases.forEach((c,i)=>{
    const pass=c.expect.test(results[i]);
    if(!pass)ok=false;
    console.log((pass?'  ok   ':'  FEHL ')+c.name.padEnd(32)+results[i]);
  });
  return ok;
}
async function osdCount(){
  const r=await fetch(HEALTH);
  return (await r.json()).mqttObservedOsdPackets;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const cmd=process.argv[2];
  if(cmd==='plan'){
    const a=accounts();
    console.log('Benutzer: reader, topology-ack, pilot (Namen aus .env, Passwörter werden nicht angezeigt)');
    console.log(rules(Object.fromEntries(Object.entries(a).map(([k,v])=>[k,{username:'<'+k+'>'}]))));
    return;
  }
  if(cmd==='verify'){
    const a=accounts();
    console.log('Anmeldung:');const c=report(connectCases(a));
    console.log('Berechtigungen:');const z=report(aclCases(a));
    process.exitCode=c&&z?0:1;return;
  }
  if(cmd==='rollback'){
    await withAdmin(rollback);
    console.log('Zurückgesetzt: anonymer Zugang und allow-all wie vorher.');
    return;
  }
  if(cmd!=='apply'){console.error('Verwendung: node scripts/pi-emqx-harden.js plan|apply|verify|rollback');process.exitCode=2;return;}

  const a=accounts();
  console.log('1/5 EMQX-Datensicherung');
  console.log('    '+ctl('data','export').trim().split('\n').pop());
  const osdBefore=await osdCount();
  await withAdmin(async api=>{
    try{
      console.log('2/5 Authentifizierung (built_in_database, 3 Benutzer)');
      await setAuthn(api,a);
      console.log('3/5 Anmeldung prüfen');
      if(!report(connectCases(a)))throw new Error('Anmeldeprüfung fehlgeschlagen');
      console.log('4/5 ACL mit {deny, all} setzen und prüfen');
      await setAuthz(api,rules(a),'deny');
      if(!report(aclCases(a)))throw new Error('ACL-Prüfung fehlgeschlagen');
      console.log('5/5 Laufende RC: OSD muss weiter ankommen (30 s)');
      await sleep(30000);
      const osdAfter=await osdCount();
      if(osdBefore>0 && !(osdAfter>osdBefore))throw new Error('OSD der RC kommt nicht mehr an');
      console.log('    OSD-Pakete: '+osdBefore+' -> '+osdAfter);
    }catch(err){
      console.error('FEHLER: '+err.message+' - setze zurück ...');
      await rollback(api);
      console.error('Zurückgesetzt auf den vorherigen Zustand.');
      process.exitCode=1;
    }
  });
  if(!process.exitCode)console.log('Fertig: EMQX verlangt Anmeldung, ACL endet mit {deny, all}.');
}
main().catch(err=>{console.error('Abbruch: '+err.message);process.exitCode=1;});
