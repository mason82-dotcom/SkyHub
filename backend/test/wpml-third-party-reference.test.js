'use strict';
// Independent, offline regression tests derived from a documented review of
// wsadexq/refactored-system at b942812e7aac9968ba1cce612a16769b1de9a8c2.
// No upstream code, downloaded examples, device/network access or real positions.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {assessAircraft} = require('../wpml-product-support');
const {validateDocuments} = require('../wpml');
const {packageKmz,readKmz,inspectKmz} = require('../wpml-kmz');

const XML_START = '<kml xmlns="http://www.opengis.net/kml/2.2" '+
  'xmlns:wpml="http://www.dji.com/wpmz/1.0.2"><Document>';
const XML_END = '</Document></kml>';
const SYNTHETIC_POINT = '<Point><coordinates>12.34,48.56</coordinates></Point>';
const PHOTO_ACTION = '<wpml:actionGroup><wpml:actionGroupId>0</wpml:actionGroupId>'+
  '<wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>'+
  '<wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>'+
  '<wpml:actionGroupMode>sequence</wpml:actionGroupMode>'+
  '<wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>'+
  '</wpml:actionTrigger><wpml:action><wpml:actionId>0</wpml:actionId>'+
  '<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>'+
  '<wpml:actionActuatorFuncParam><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>'+
  '</wpml:actionActuatorFuncParam></wpml:action></wpml:actionGroup>';

function syntheticDocuments(droneType,droneSubtype,payloadType){
  const mission = '<wpml:missionConfig>'+
    '<wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>'+
    '<wpml:finishAction>goHome</wpml:finishAction>'+
    '<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>'+
    '<wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>'+
    '<wpml:globalTransitionalSpeed>8</wpml:globalTransitionalSpeed>'+
    '<wpml:droneInfo><wpml:droneEnumValue>'+droneType+'</wpml:droneEnumValue>'+
    '<wpml:droneSubEnumValue>'+droneSubtype+'</wpml:droneSubEnumValue>'+
    '</wpml:droneInfo><wpml:payloadInfo><wpml:payloadEnumValue>'+payloadType+
    '</wpml:payloadEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>'+
    '</wpml:payloadInfo></wpml:missionConfig>';
  const template = XML_START+mission+
    '<Folder><wpml:templateType>waypoint</wpml:templateType>'+
    '<wpml:templateId>0</wpml:templateId>'+
    '<wpml:autoFlightSpeed>7</wpml:autoFlightSpeed>'+
    '<wpml:waylineCoordinateSysParam>'+
    '<wpml:coordinateMode>WGS84</wpml:coordinateMode>'+
    '<wpml:heightMode>relativeToStartPoint</wpml:heightMode>'+
    '</wpml:waylineCoordinateSysParam><Placemark>'+SYNTHETIC_POINT+
    '<wpml:index>0</wpml:index>'+
    '<wpml:useGlobalHeight>1</wpml:useGlobalHeight>'+
    '<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed></Placemark></Folder>'+XML_END;
  const waylines = XML_START+mission+
    '<Folder><wpml:templateId>0</wpml:templateId>'+
    '<wpml:waylineId>0</wpml:waylineId>'+
    '<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'+
    '<wpml:autoFlightSpeed>7</wpml:autoFlightSpeed><Placemark>'+
    SYNTHETIC_POINT+'<wpml:index>0</wpml:index>'+
    '<wpml:executeHeight>40</wpml:executeHeight>'+
    '<wpml:waypointTurnParam><wpml:waypointTurnMode>'+
    'toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>'+
    '</wpml:waypointTurnParam>'+PHOTO_ACTION+'</Placemark></Folder>'+XML_END;
  return {template,waylines};
}

test('third-party 2024 allowlist gap: SkyHub recognizes Matrice 4T and Matrice 4D/4TD',()=>{
  for(const [type,subtype,payload,model] of [
    [99,1,89,'Matrice 4T'],
    [99,0,88,'Matrice 4E'],
    [100,0,98,'Matrice 4D'],
    [100,1,99,'Matrice 4TD']
  ]){
    const result=assessAircraft(type,subtype,payload,0);
    assert.equal(result.model,model);
    assert.deepEqual(result.errors,[]);
  }
});

test('Matrice 4T has a model-specific, fail-closed payload profile',()=>{
  assert.deepEqual(assessAircraft(99,1,89,0).errors,[]);
  assert.ok(assessAircraft(99,1,88,0).errors.length>0);
  assert.ok(assessAircraft(99,0,89,0).errors.length>0);
  assert.ok(assessAircraft(99,1,89,1).errors.length>0);
  assert.ok(assessAircraft(99,8,89,0).errors.length>0);
});

test('Mavic 3M WPML profile exists but does not certify Cloud API hardware IDs',()=>{
  const result=assessAircraft(77,2,68,0);
  assert.equal(result.model,'Mavic 3M');
  assert.deepEqual(result.errors,[]);
});

test('Matrice 4T synthetic KMZ exports DJI wpmz/ structure and is never flight ready',()=>{
  const {template,waylines}=syntheticDocuments(99,1,89);
  const validated=validateDocuments(template,waylines);
  assert.equal(validated.valid,true,JSON.stringify(validated.errors));
  assert.equal(validated.flightReady,false);
  assert.equal(validated.validationScope,'offline-partial');
  const archive=packageKmz(template,waylines);
  assert.ok(archive.includes(Buffer.from('wpmz/template.kml')));
  assert.ok(archive.includes(Buffer.from('wpmz/waylines.wpml')));
  const unpacked=readKmz(archive);
  assert.equal(unpacked.template,template);
  assert.equal(unpacked.waylines,waylines);
  const inspected=inspectKmz(archive);
  assert.equal(inspected.valid,true,JSON.stringify(inspected.errors));
  assert.equal(inspected.flightReady,false);
});

test('Matrice 4T wrong payload and non-finite coordinates fail offline validation',()=>{
  const good=syntheticDocuments(99,1,89);
  const wrong=syntheticDocuments(99,1,88);
  assert.equal(validateDocuments(wrong.template,wrong.waylines).valid,false);
  const badCoords=good.waylines.replace('12.34,48.56','NaN,48.56');
  assert.equal(validateDocuments(good.template,badCoords).valid,false);
});
