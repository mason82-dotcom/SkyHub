'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../../frontend/public/next/live-model.js');

const NOW=1792528000000;
const aircraft=(over={})=>({
  sn:'AIR01',role:'subdevice',deviceCategory:'aircraft',modelName:'Matrice 4T',firmwareVersion:'17.02.0501',
  aircraftConnected:true,topologyOnline:true,telemetryTimeVerified:true,modeCode:0,
  lastTelemetryAt:NOW-2000,lastPositionAt:NOW-2000,positionUnavailable:false,
  telemetry:{battery:33,latitude:49.1,longitude:8.4,heightEllipsoid:167.1,altitude:0,gpsSatellites:18,
    rtkSatellites:20,rtkFixState:2,positionQuality:4,horizontalSpeed:0,verticalSpeed:0,heading:-90.1,
    homeDistance:0.86,remainingFlightTime:600,windSpeed:0},
  hms:[],lastHmsAt:null,...over
});
const rc=(over={})=>aircraft({sn:'RC01',role:'gateway',deviceCategory:'controller',modelName:'DJI RC Plus 2 Enterprise',
  firmwareVersion:null,modeCode:null,aircraftConnected:null,
  telemetry:{battery:74,latitude:49.1,longitude:8.4,heightEllipsoid:0,linkQuality:5,sdrLinkState:1,fourGLinkState:0},...over});

test('device status follows OSD freshness and an explicit aircraft disconnect',()=>{
  assert.deepEqual(m.deviceStatus(aircraft(),NOW),{kind:'live',text:'OSD frisch'});
  assert.equal(m.deviceStatus(aircraft({telemetryTimeVerified:false}),NOW).text,'OSD empfangen · Zeit ungeprüft');
  assert.deepEqual(m.deviceStatus(aircraft({lastTelemetryAt:NOW-20000}),NOW),{kind:'stale',text:'OSD veraltet · vor 20 s'});
  assert.equal(m.deviceStatus(aircraft({aircraftConnected:false}),NOW).kind,'disconnected');
  assert.equal(m.deviceStatus(aircraft({lastTelemetryAt:null}),NOW).text,'Topologie gemeldet · kein OSD');
  assert.equal(m.deviceStatus(aircraft({lastTelemetryAt:null,topologyOnline:null}),NOW).kind,'unknown');
  assert.equal(m.deviceStatus(aircraft({lastTelemetryAt:NOW+60000}),NOW).kind,'stale','future time is not fresh');
});

test('a position needs a fresh, valid, non-placeholder fix',()=>{
  assert.equal(m.hasPosition(aircraft(),NOW),true);
  assert.equal(m.hasPosition(aircraft({telemetry:{latitude:0,longitude:0}}),NOW),false);
  assert.equal(m.hasPosition(aircraft({positionUnavailable:true}),NOW),false);
  assert.equal(m.hasPosition(aircraft({lastPositionAt:NOW-16000}),NOW),false);
  assert.equal(m.hasPosition(aircraft({telemetry:{latitude:95,longitude:8}}),NOW),false);
  assert.deepEqual(m.positions([aircraft(),rc(),aircraft({sn:'OLD',lastPositionAt:NOW-60000})],NOW).map(p=>[p.sn,p.gateway]),
    [['AIR01',false],['RC01',true]]);
});

test('aircraft rows use the documented DJI meanings and never invent missing values',()=>{
  const rows=Object.fromEntries(m.telemetryRows(aircraft(),NOW).map(([k,v])=>[k,v]));
  assert.equal(rows['Akku'],'33 %');
  assert.equal(rows['GNSS'],'18 Sat. · Stufe 4');
  assert.equal(rows['RTK'],'Fix erfolgreich · 20 Sat.');
  assert.equal(rows['Position'],'49,1 / 8,4');
  assert.equal(rows['Restflugzeit'],'10 min');
  assert.equal(rows['Firmware'],'17.02.0501');
  const empty=Object.fromEntries(m.telemetryRows(aircraft({telemetry:{},firmwareVersion:null,modeCode:null}),NOW)
    .map(([k,v])=>[k,v]));
  for(const key of ['Akku','GNSS','RTK','Kurs','Distanz Home','Restflugzeit','Firmware','Modus-Code'])
    assert.equal(empty[key],'—',key);
  assert.equal(empty['Position'],'keine gültige Position');
  assert.equal(m.gnssLabel({gpsSatellites:20,positionQuality:10}),'20 Sat. · RTK fixiert');
  assert.equal(m.rtkLabel({rtkFixState:7}),'Code 7');
});

test('gateway rows show link data instead of flight values',()=>{
  const rows=m.telemetryRows(rc(),NOW).map(r=>r[0]);
  assert.ok(rows.includes('Funkqualität (SDR)'));
  assert.ok(!rows.includes('RTK'));
  const map=Object.fromEntries(m.telemetryRows(rc(),NOW).map(([k,v])=>[k,v]));
  assert.equal(map['SDR-Link'],'verbunden');
  assert.equal(map['4G-Link'],'getrennt');
});

test('HMS and AirSense summaries take only fresh data',()=>{
  const alarm={code:'0x16100066',level:2,text:{de:'RTK-Signal schwach',en:'RTK weak'}};
  assert.deepEqual(m.hmsSummary(aircraft({hms:[{code:'0x1',level:0},alarm],lastHmsAt:NOW-1000}),NOW),
    {level:2,label:'Warnung',text:'RTK-Signal schwach',more:1});
  assert.equal(m.hmsSummary(aircraft({hms:[alarm],lastHmsAt:NOW-40000}),NOW),null);
  assert.equal(m.hmsSummary(aircraft({hms:[{code:'0x9',level:1}],lastHmsAt:NOW}),NOW).text,'Unbekannter HMS-Code 0x9');
  assert.deepEqual(m.airsenseText({count:4,maxWarningLevel:1,nearestDistanceM:20100,fresh:true}),
    {level:1,text:'AirSense: 4 Luftfahrzeuge · Stufe 1 · nächstes 20,1 km'});
  assert.match(m.airsenseText({count:1,maxWarningLevel:3,nearestDistanceM:800,fresh:true}).text,
    /1 Luftfahrzeug · Stufe 3 · nächstes 800 m · Ausweichen empfohlen/);
  assert.equal(m.airsenseText({count:4,maxWarningLevel:1,fresh:false}),null);
  assert.equal(m.airsenseText({count:0,maxWarningLevel:null,fresh:true}),null);
});

test('fleet statistics come from real devices and health only',()=>{
  const health={mqtt:true,subscribed:true,mqttBrokerPort:1884};
  const s=m.fleetStats([aircraft(),rc(),aircraft({sn:'OLD',lastTelemetryAt:NOW-90000})],health,NOW);
  assert.deepEqual([s.live,s.total,s.liveNote],[2,3,'1 ohne frisches OSD']);
  assert.deepEqual(s.mqtt,{text:'ONLINE',ok:true,note:'abonniert · Port 1884'});
  assert.equal(s.lastText,'vor 2 s');
  assert.equal(m.fleetStats([],null,NOW).mqtt.text,'unbekannt');
  assert.equal(m.fleetStats([],{mqtt:true,subscribed:false},NOW).mqtt.note,'Abonnement nicht bestätigt');
  assert.deepEqual([m.fleetStats([],health,NOW).lastText,m.fleetStats([],health,NOW).liveNote],['—','keine Geräte gemeldet']);
});

test('event texts match the existing dashboard',()=>{
  assert.equal(m.eventText({channel:'events',method:'hms'}),'HMS-Meldungen geändert');
  assert.equal(m.eventText({channel:'events',method:'airsense_warning'}),'AirSense-Warnstufe geändert');
  assert.equal(m.eventText({channel:'status',method:'update_topo'}),'Topologie gemeldet');
  assert.equal(m.eventText({channel:'services_reply'}),'Dienstantwort empfangen');
  assert.equal(m.eventText(null),'Geräteereignis');
});
