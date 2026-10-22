'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const {createWpmlInspectRouter,MAX_KMZ_BYTES}=require('../wpml-api');
const {packageKmz}=require('../wpml-kmz');

const OPEN='<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2"><Document>';
const CLOSE='</Document></kml>';
const MISSION='<wpml:missionConfig><wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>'+
  '<wpml:finishAction>goHome</wpml:finishAction><wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>'+
  '<wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>'+
  '<wpml:globalTransitionalSpeed>8</wpml:globalTransitionalSpeed>'+
  '<wpml:droneInfo><wpml:droneEnumValue>67</wpml:droneEnumValue>'+
  '<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue></wpml:droneInfo>'+
  '<wpml:payloadInfo><wpml:payloadEnumValue>52</wpml:payloadEnumValue>'+
  '<wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo></wpml:missionConfig>';
const POINT='<Point><coordinates>12.34,48.56</coordinates></Point>';
const template=OPEN+MISSION+
  '<Folder><wpml:templateType>waypoint</wpml:templateType><wpml:templateId>0</wpml:templateId>'+
  '<wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>'+
  '<wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode>'+
  '<wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>'+
  '<Placemark>'+POINT+'<wpml:index>0</wpml:index>'+
  '<wpml:useGlobalHeight>1</wpml:useGlobalHeight>'+
  '<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed></Placemark></Folder>'+CLOSE;
const waylines=OPEN+MISSION+
  '<Folder><wpml:templateId>0</wpml:templateId><wpml:waylineId>0</wpml:waylineId>'+
  '<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'+
  '<wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>'+
  '<Placemark>'+POINT+'<wpml:index>0</wpml:index>'+
  '<wpml:executeHeight>40</wpml:executeHeight>'+
  '<wpml:waypointTurnParam><wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>'+
  '</wpml:waypointTurnParam></Placemark></Folder>'+CLOSE;

test('WPML inspector only returns bounded metadata, never GPS, names or executable flight state',async()=>{
  const app=express();app.use('/wpml',createWpmlInspectRouter());
  app.use((_req,res)=>res.sendStatus(404));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const endpoint='http://127.0.0.1:'+server.address().port+'/wpml/inspect';
  const post=(body,type='application/vnd.google-earth.kmz',extra={})=>
    fetch(endpoint,{method:'POST',headers:{'Content-Type':type,...extra},body});
  try{
    const kmz=packageKmz(template,waylines);
    const valid=await post(kmz);
    assert.equal(valid.status,200);
    const report=await valid.json();
    assert.deepEqual(report,{
      schema:'skyhub-wpml-inspection-v1',
      valid:true,flightReady:false,validationScope:'offline-partial',
      templateCount:1,waylineCount:1,waypointCount:1,
      resourceCount:0,errorCount:0,warningCount:1
    });
    const str=JSON.stringify(report);
    for(const sensitive of ['12.34','48.56','takeOffSecurityHeight','template.kml',
                            'waylines.wpml','goHome','Matrice','TOKEN','<kml']){
      assert.equal(str.includes(sensitive),false,sensitive);
    }
    const damaged=Buffer.from(kmz);
    damaged[damaged.indexOf(Buffer.from('48.56'))]=49;
    const invalid=await post(damaged);
    assert.equal(invalid.status,422);
    assert.deepEqual(await invalid.json(),{
      schema:'skyhub-wpml-inspection-v1',valid:false,flightReady:false,
      validationScope:'offline-partial',error:'INVALID_KMZ'
    });
    assert.equal((await post(kmz,'application/json')).status,415);
    assert.equal((await post(kmz,'application/xml')).status,415);
    assert.equal((await post(kmz,'application/zip',{'Content-Encoding':'gzip'})).status,415);
    assert.equal((await post(Buffer.from('x'))).status,422);
    assert.equal((await fetch(endpoint)).status,404);
    // More than the exact ZIP upper bound must fail without processing input.
    const large=await post(Buffer.alloc(MAX_KMZ_BYTES+1));
    assert.equal(large.status,413);
    assert.equal((await large.json()).error,'KMZ_TOO_LARGE');
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
