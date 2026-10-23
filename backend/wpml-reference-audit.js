'use strict';
// Read-only source-compatibility audit for DJI WPML KMZ. No writes, network,
// dispatch, raw mission values, route points or personal metadata in output.
// This is NOT a DJI Pilot 2 acceptance/certification or upstream Go execution.
const {readKmz}=require('./wpml-kmz');
const {parseXml,validateDocuments}=require('./wpml');
const {FIXED}=require('./wpml-product-support');

const SCHEMA='skyhub-wpml-reference-risk-audit-v1';
const SUPPORTED='http://www.dji.com/wpmz/1.0.2';
const ALT='http://www.dji.com/wpmz/1.0.6';
function rejected(){throw Error('WPML reference audit rejected: invalid or unsupported KMZ');}
function one(node,key){return node?.children?.find(child=>child.name===key)||null;}
function children(node,key){return node?.children?.filter(child=>child.name===key)||[];}
function field(node,key){return one(node,'wpml:'+key)?.text.trim()??'';}
function numeric(raw){
  if(!/^(?:0|[1-9]\d*)$/.test(raw))return null;
  const n=Number(raw);
  return Number.isSafeInteger(n)?n:null;
}
function namespace(xml){
  const match=/<kml\s+[^>]*xmlns:wpml\s*=\s*["']([^"']+)["']/i.exec(xml.slice(0,2048));
  return match?.[1]??null;
}
function base(){
  return {schema:SCHEMA,sourceReference:{
    repository:'motecshine/dji-waylines-sdk',
    commit:'dd9b12d26c4c200220165e8e6d409d6dafdbfa23'
  },flightReady:false,pilot2HardwareVerified:false,
  sdkOutputVerified:false,missionDispatchEnabled:false,
  privacy:'fixed diagnostic codes and boolean/aggregate properties only',
  scope:'offline-reference-risk-screen-not-flight-approval'};
}
function auditReferenceKmz(buffer){
  let archive;
  try{archive=readKmz(buffer);}catch{rejected();}
  const a=namespace(archive.template),b=namespace(archive.waylines);
  if(a!==SUPPORTED||b!==SUPPORTED){
    return {...base(),offlineValid:null,namespaceCheck:
      a===ALT&&b===ALT?'upstream-alternate-unverified':'unsupported-or-mixed',
      reviewStatus:'blocked',
      findings:['WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB'],
      findingCount:1};
  }
  let template,waylines,validation;
  try {
    template=parseXml(archive.template);
    waylines=parseXml(archive.waylines);
    validation=validateDocuments(archive.template,archive.waylines);
  } catch {rejected();}
  const codes=new Set();
  if(!validation.valid)codes.add('WPML_OFFLINE_VALIDATION_FAILED');
  const docs=[template,waylines];
  for(const root of docs){
    const doc=one(root,'Document');
    const config=one(doc,'wpml:missionConfig');
    if(!config){codes.add('WPML_MISSION_CONFIG_MISSING');continue;}
    if(field(config,'exitOnRCLost')!=='executeLostAction'||
       field(config,'executeRCLostAction')!=='goBack')
      codes.add('RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR');
    const info=one(config,'wpml:droneInfo'),payload=one(config,'wpml:payloadInfo');
    const type=numeric(field(info,'droneEnumValue'));
    const subtype=numeric(field(info,'droneSubEnumValue'));
    const camera=numeric(field(payload,'payloadEnumValue'));
    if(type!==null && subtype!==null && camera!==null){
      const profile=Object.hasOwn(FIXED,type+':'+subtype)?FIXED[type+':'+subtype]:null;
      if(profile && profile.payload!==camera)
        codes.add('AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT');
      else if(!profile && [67,77,91,99,100].includes(type))
        codes.add('AIRCRAFT_SUBTYPE_UNRECOGNIZED');
    }
    if(field(config,'takeOffRefPoint'))
      codes.add('TAKEOFF_REFERENCE_REQUIRES_INDEPENDENT_PROVENANCE');
    if(field(config,'takeOffRefPoint') &&
       field(config,'takeOffRefPointAGLHeight')==='0')
      codes.add('TAKEOFF_AGL_ZERO_REQUIRES_REVIEW');
  }
  let ellipsoidFound=false,identicalHeightPairs=0;
  const doc=one(template,'Document');
  for(const folder of children(doc,'Folder')){
    for(const point of children(folder,'Placemark')){
      const ell=field(point,'ellipsoidHeight'),height=field(point,'height');
      if(ell==='')continue;
      ellipsoidFound=true;
      // Only a warning: equal values can be physically possible and do not
      // prove an error. The upstream converter copies relative height.
      if(height!=='' && Number.isFinite(Number(ell))&&Number.isFinite(Number(height))&&
         Number(ell)===Number(height))identicalHeightPairs++;
    }
  }
  if(ellipsoidFound)codes.add('ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED');
  if(identicalHeightPairs>0)codes.add('ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW');
  for(const folder of children(one(waylines,'Document'),'Folder')){
    if(field(folder,'distance')!==''||field(folder,'duration')!=='')
      codes.add('WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED');
  }
  return {...base(),offlineValid:validation.valid,
    namespaceCheck:'skyhub-recognized-1.0.2',
    reviewStatus:!validation.valid?'blocked':codes.size?'review-required':'no-listed-divergence-observed',
    findings:[...codes].sort(),findingCount:codes.size};
}
module.exports={auditReferenceKmz};
