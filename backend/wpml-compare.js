'use strict';
// Offline, privacy-preserving structural comparison of two DJI WPML KMZ files.
// No flight commands, network, camera media extraction, or raw coordinate output.
const {readKmz}=require('./wpml-kmz');
const {parseXml,validateDocuments}=require('./wpml');

const LIMIT=200;
const OMIT_NAMES=new Set([
  'name','description','wpml:author','wpml:createTime','wpml:updateTime',
  'wpml:missionName','wpml:fileSuffix','wpml:directoryName'
]);
const PRIVATE_NAMES=new Set([
  'coordinates','wpml:waypointPoiPoint',
  'wpml:ellipsoidHeight','wpml:executeHeight','wpml:height','wpml:globalHeight',
  'wpml:globalRTHHeight','wpml:takeOffSecurityHeight'
]);
const IDENTIFIER_NAMES=new Set([
  'wpml:templateId','wpml:waylineId','wpml:index','wpml:actionGroupId','wpml:actionId'
]);
function safeError(message){
  // Only static diagnostic words are allowed in CLI output; never raw XML/file content.
  throw Error('WPML comparison rejected: '+message);
}
function classify(path){
  if(path.includes('actionGroup')||path.includes('actionTrigger')||
     path.includes('actionActuator'))return 'actions';
  if(path.includes('missionConfig'))return 'mission';
  if(path.includes('payload')||path.includes('imageFormat'))return 'payload';
  if(path.includes('coordinates')||path.includes('Point')||
     path.includes('Polygon')||path.includes('LineString'))return 'geometry';
  if(path.includes('Placemark'))return 'waypoints';
  if(path.includes('Folder'))return 'folders';
  return 'other';
}
function values(tree){
  const nodes=new Map();
  function walk(node,prefix,depth){
    if(depth>48||nodes.size>20000)safeError('XML complexity limit');
    const path=prefix+'/'+node.name;
    const ignored=OMIT_NAMES.has(node.name);
    if(!ignored){
      const value=node.text.trim().replace(/\s+/g,' ');
      // Store actual strings only transiently in RAM to compare. Never return them.
      if(value)nodes.set(path,value);
      for(const [key,val] of Object.entries(node.attributes)){
        if(!key.startsWith('xmlns'))nodes.set(path+'/@'+key,val);
      }
    }
    const seen=new Map();
    for(const child of node.children){
      const count=seen.get(child.name)||0;
      seen.set(child.name,count+1);
      // Identical ordering of repeated elements is relevant to waypoint and action execution.
      walk(child,path+'['+count+']',depth+1);
    }
  }
  walk(tree,'',0);
  return nodes;
}
function aggregate(map,flag){
  return [...map.entries()].reduce((acc,[path])=>{
    const category=classify(path);
    acc[category]=(acc[category]||0)+1;
    return acc;
  },{});
}
function compareDocuments(a,b,file){
  const left=values(parseXml(a)),right=values(parseXml(b));
  const union=new Set([...left.keys(),...right.keys()]);
  if(union.size>40000)safeError('XML comparison complexity limit');
  const groups={},changes=[];
  let total=0,same=0,ignoredVolatile=0;
  for(const path of [...union].sort()){
    if(left.has(path)&&right.has(path)&&left.get(path)===right.get(path)){
      same++;continue;
    }
    const category=classify(path);
    const kind=!left.has(path)?'added':!right.has(path)?'removed':'changed';
    groups[category]=(groups[category]||0)+1;
    total++;
    if(changes.length<LIMIT)changes.push({
      path:file+path,
      category,kind,
      // NO mission field values, serials, GPS coordinates, author or timestamps emitted.
      valuesRedacted:true
    });
  }
  return {
    file,comparable:true,equal:total===0,totalChanges:total,
    displayedChanges:changes.length,truncated:total>LIMIT,
    unchangedFields:same,
    changedByCategory:groups,changes
  };
}
function inspection(template,waylines,resourceCount){
  const v=validateDocuments(template,waylines);
  return {
    valid:v.valid,
    // Parser/validator errors are known paths and diagnostic strings only.
    errorCount:v.errors.length,
    warningCount:v.warnings.length,
    templateTypes:v.templates.map(t=>t.templateType),
    templateCount:v.templates.length,
    waylineCount:v.waylines.length,
    waypointCounts:v.waylines.map(w=>w.waypointCount),
    aircraftModel:v.aircraft?.model??null,
    undocumentedFieldCount:v.fieldCoverage?.undocumentedFields?.length??null,
    resourceCount,
    flightReady:false
  };
}
function compareKmz(leftBytes,rightBytes){
  let left,right;
  try{
    left=readKmz(leftBytes);right=readKmz(rightBytes);
  }catch{
    safeError('invalid, encrypted, unsupported, oversized or corrupt KMZ archive');
  }
  let docs;
  try{
    docs=[compareDocuments(left.template,right.template,'template.kml'),
      compareDocuments(left.waylines,right.waylines,'waylines.wpml')];
  }catch{
    safeError('unsupported or malformed WPML XML');
  }
  // validateDocuments normally catches XML errors, and never reads from the filesystem.
  const l=inspection(left.template,left.waylines,left.resourceCount);
  const r=inspection(right.template,right.waylines,right.resourceCount);
  const differences=docs.reduce((n,d)=>n+d.totalChanges,0);
  return {
    comparisonSchema:'skyhub-wpml-compat-v1',
    left:l,right:r,
    summary:{
      structuralDifferences:differences,
      structurallyEqualExcludingVolatileMetadata:differences===0,
      resourceCountMatches:left.resourceCount===right.resourceCount,
      bothOfflineValid:l.valid&&r.valid,
      pilot2HardwareVerified:false,
      flightReady:false
    },
    documents:docs,
    // Differences are path/kind only; no mission names, numerical telemetry or waypoints.
    privacy:'field paths and aggregate counts only; values and GPS coordinates redacted',
    scope:'offline-structural-comparison-not-pilot2-compatibility-certification'
  };
}
module.exports={compareKmz};
