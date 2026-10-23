'use strict';

// Preview-only contract for a future explicit, authenticated media review flow.
// No media access, model execution, inference API, or Pilot 2 mutation here.
const SCHEMA='skyhub-vision-yolo11-preview-v1';
const MAX_BYTES=65536;
const MAX_DETECTIONS=100;
const MAX_PIXELS=24000000;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

class InvalidVisionReport extends TypeError {
  constructor(){super('Invalid offline vision report');}
}
function assert(condition){
  if(!condition)throw new InvalidVisionReport();
}
function plain(v){
  return v!==null && typeof v==='object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v)===Object.prototype;
}
function exactly(value,keys){
  assert(plain(value));
  const actual=Object.keys(value);
  assert(actual.length===keys.length &&
    keys.every(key=>Object.prototype.hasOwnProperty.call(value,key)));
}
function validNumber(n,lo,hi){
  return typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;
}
function parseVisionPreviewReport(payload){
  assert(plain(payload));
  let bytes;
  try{bytes=Buffer.byteLength(JSON.stringify(payload),'utf8');}
  catch(_err){throw new InvalidVisionReport();}
  assert(bytes<=MAX_BYTES);
  exactly(payload,[
    'schema','status','source','image','modelFormat','detections',
    'detectionCount','defectVerified','geolocationVerified',
    'multispectralReady','flightControlReady'
  ]);
  assert(payload.schema===SCHEMA && payload.status==='ok' &&
    payload.source==='offline-explicit-local-rgb');
  assert(payload.modelFormat==='onnx'||payload.modelFormat==='pt');
  for(const key of ['defectVerified','geolocationVerified',
    'multispectralReady','flightControlReady'])
    assert(payload[key]===false);
  exactly(payload.image,['width','height']);
  const {width,height}=payload.image;
  assert(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&
    width>0&&height>0&&width*height<=MAX_PIXELS);
  assert(Array.isArray(payload.detections)&&
    payload.detections.length<=MAX_DETECTIONS);
  assert(Number.isInteger(payload.detectionCount)&&
    payload.detectionCount===payload.detections.length);

  const detections=payload.detections.map(value=>{
    exactly(value,['classId','className','confidence','bboxXYXY']);
    assert(Number.isInteger(value.classId)&&
      value.classId>=0&&value.classId<=9999);
    assert(typeof value.className==='string'&&IDENT.test(value.className));
    assert(validNumber(value.confidence,0.05,1));
    assert(Array.isArray(value.bboxXYXY)&&value.bboxXYXY.length===4);
    const [x1,y1,x2,y2]=value.bboxXYXY;
    assert(validNumber(x1,0,width)&&validNumber(x2,0,width)&&
      validNumber(y1,0,height)&&validNumber(y2,0,height)&&
      x1<x2&&y1<y2);
    return Object.freeze({
      classId:value.classId,
      className:value.className,
      confidence:value.confidence,
      bboxXYXY:Object.freeze([x1,y1,x2,y2])
    });
  });
  return Object.freeze({
    schema:SCHEMA,
    status:'ok',
    source:'offline-explicit-local-rgb',
    image:Object.freeze({width,height}),
    modelFormat:payload.modelFormat,
    detections:Object.freeze(detections),
    detectionCount:detections.length,
    defectVerified:false,
    geolocationVerified:false,
    multispectralReady:false,
    flightControlReady:false
  });
}

module.exports={parseVisionPreviewReport,InvalidVisionReport,SCHEMA,
  MAX_DETECTIONS,MAX_BYTES};
