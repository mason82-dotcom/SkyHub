#!/usr/bin/env node
'use strict';
// Read-only, serial-free local diagnostic for SkyHub Next 0.1.0.
// Does not connect to MQTT or print raw DJI messages.
const http=require('node:http');

const arg=process.argv[2] || '4001';
const port=Number(arg);
if(!/^\d{1,5}$/.test(arg) || !Number.isSafeInteger(port) || port<1 || port>65535){
  console.error('Verwendung: node scripts/pi-mqtt-osd-check.js [lokaler HTTP-Port]');
  process.exitCode=2;
}else{
  const req=http.get({hostname:'127.0.0.1',port,path:'/api/health',timeout:5000},res=>{
    if(res.statusCode!==200){
      console.error('Health-API: HTTP '+res.statusCode);
      res.resume();
      process.exitCode=1;
      return;
    }
    let body='';
    res.setEncoding('utf8');
    res.on('data',chunk=>{
      body+=chunk;
      if(body.length>65536)res.destroy(new Error('Health-Antwort zu groß'));
    });
    res.on('end',()=>{
      try{
        const d=JSON.parse(body);
        if(!Object.hasOwn(d,'mqttObservedOsdPackets')){
          console.error('Dieses Backend hat noch keine OSD-Transportdiagnose.');
          process.exitCode=2;return;
        }
        const count=(value)=>Number.isSafeInteger(value)&&value>=0?value:'n/v';
        const time=(value)=>Number.isFinite(value)?new Date(value).toISOString():'nie';
        console.log('=== SkyHub Next 0.1.0 – MQTT/OSD Diagnose ===');
        console.log('EMQX-Verbindung: '+(d.mqtt===true?'ja':'nein'));
        console.log('MQTT-Subscriptions: '+(d.subscribed===true?'bestätigt':'nicht bestätigt'));
        console.log('OSD-Topic empfangen: '+count(d.mqttObservedOsdPackets));
        console.log('OSD gültig übernommen: '+count(d.mqttOsdMessages));
        console.log('Verwertbare Telemetrie: '+count(d.mqttValidTelemetryUpdates));
        console.log('Status-Topic empfangen: '+count(d.mqttObservedChannelCounts?.status));
        console.log('State-Topic empfangen: '+count(d.mqttObservedChannelCounts?.state));
        console.log('Letztes rohes OSD: '+time(d.mqttLastObservedOsdAt));
        console.log('Letzte valide Telemetrie: '+time(d.mqttLastTelemetryAt));
        console.log('Topologie-Bestätigung aktiviert: '+(d.topologyReplyEnabled===true?'ja':'nein'));
        if(d.topologyReplyEnabled===true){
          console.log('Topologie-Antworten gesendet: '+count(d.topologyReplySent)+
            ' / übersprungen: '+count(d.topologyReplySkipped)+' / Fehler: '+count(d.topologyReplyErrors));
          console.log('Letzte Topologie-Antwort: '+time(d.topologyReplyLastAt));
        }
        if(d.mqtt!==true || d.subscribed!==true){
          console.log('Hinweis: Zuerst SkyHub-Subscriber-Verbindung und ACL prüfen.');
        }else if(d.mqttObservedOsdPackets===0 && d.mqttObservedChannelCounts?.status>0 &&
            d.topologyReplyEnabled!==true){
          console.log('Hinweis: update_topo kommt an, aber SkyHub sendet kein status_reply. '+
            'Pilot 2 wiederholt update_topo dann und sendet kein OSD (SKYHUB_TOPOLOGY_ACK_ENABLED).');
        }else if(d.mqttObservedOsdPackets===0 && d.topologyReplyEnabled===true &&
            !(d.topologyReplySent>0)){
          console.log('Hinweis: Topologie-Antwort aktiviert, aber noch keine gesendet. Backend-Log prüfen.');
        }else if(d.mqttObservedOsdPackets===0){
          console.log('Hinweis: Bisher kein passendes OSD-Topic zugestellt. Pilot-Publish/ACL prüfen.');
        }else if(d.mqttOsdMessages===0){
          console.log('Hinweis: OSD trifft ein, wird aber nicht übernommen. Payload-/Zeitprüfung ansehen.');
        }else if(d.mqttValidTelemetryUpdates===0){
          console.log('Hinweis: OSD akzeptiert, aber keine verwertbaren Messfelder.');
        }else{
          console.log('Hinweis: OSD wurde verarbeitet; letzte Zeitstempel auf Aktualität prüfen.');
        }
      }catch(_){
        console.error('Health-API lieferte kein gültiges erwartetes JSON.');
        process.exitCode=1;
      }
    });
  });
  req.on('timeout',()=>req.destroy(new Error('Zeitüberschreitung')));
  req.on('error',()=>{console.error('Health-API auf 127.0.0.1:'+port+' nicht erreichbar.');process.exitCode=1;});
}
