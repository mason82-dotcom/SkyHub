'use strict';

// Privacy-preserving values extracted from a *bounded* DJI XMP packet.
// Never return source XML, CaptureUUID, GPS, serials, private identifiers
// or user-supplied unknown keys. Extracted values are metadata claims only.
const {classifyDJIXmp,extractEnumValue}=require('./m3m-xmp-markers');
const {captureUuidFromXmp}=require('./m3m-xmp-capture-groups');

const NS=/xmlns:drone-dji\s*=\s*["']http:\/\/www\.dji\.com\/drone-dji\/1\.0\/["']/;
const SPECS=Object.freeze({
  BlackCurrent:[0,65535],
  SensorGain:[0.000001,10000],
  SensorGainAdjustment:[0.000001,10000],
  Irradiance:[0,100000000],
  IrradianceExposureTime:[0.000001,3600],
  IrradianceGain:[0.000001,1000000],
  ExposureTime:[0.000001,3600],
  CentralWavelength:[350,1100],
  SensorIndex:[1,4]
});
const NUM=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/;
function numberField(xml,name,[min,max]){
  const attr=new RegExp('(?:\\s)drone-dji:'+name+'\\s*=\\s*["\\x27]([^"\\x27]{1,64})["\\x27]','g');
  const tag=new RegExp('<drone-dji:'+name+'\\s*>\\s*([^<>]{1,64})\\s*<\\/drone-dji:'+name+'\\s*>','g');
  const found=[...xml.matchAll(attr),...xml.matchAll(tag)];
  // Presence of duplicate or malformed values is not evidence.
  if(found.length!==1)return null;
  const raw=found[0][1].trim();
  if(!NUM.test(raw))return null;
  const value=Number(raw);
  if(!Number.isFinite(value)||value<min||value>max||
    name==='SensorIndex'&&!Number.isInteger(value))return null;
  return value;
}
function extractSafeDjiMetadata(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>32768)
    return {status:'unavailable'};
  const cls=classifyDJIXmp(bytes);
  if(cls.status!=='ok')return {status:cls.status};
  const xml=bytes.toString('utf8');
  if(!NS.test(xml))return {status:'xmpNotRecognized'};
  const metrics={};
  for(const [name,bounds] of Object.entries(SPECS)){
    const value=numberField(xml,name,bounds);
    if(value!==null)metrics[name]=value;
  }
  const gps=extractEnumValue(xml,'GpsStatus');
  const rtkHint=['Normal','RTK','Invalid'].includes(gps)?gps:'unknown';
  return {
    status:'ok',bandHint:cls.bandHint,
    rtkHint,rtkStatusSource:'unverified-dji-xmp',
    metrics,
    captureUuidPresent:captureUuidFromXmp(bytes)!==null,
    source:'bounded-tiff-xmp-metadata',
    radiometricCalibrationVerified:false,
    bandCoregistrationVerified:false,
    reflectanceReady:false,ndviReady:false,ndreReady:false
  };
}

module.exports={extractSafeDjiMetadata,numberField,SPECS};
