'use strict';
// Optional, authenticated, in-memory KMZ inspection. No filesystem, DJI, MQTT or S3 access.
// This router must be mounted AFTER the SkyHub /api view-token middleware.
const express=require('express');
const {inspectKmz}=require('./wpml-kmz');
const MAX_KMZ_BYTES=12*1024*1024;
const TYPES=new Set(['application/vnd.google-earth.kmz','application/zip','application/octet-stream']);
const SCOPE='offline-partial';
function error(res,status,code){
  return res.status(status).json({
    schema:'skyhub-wpml-inspection-v1',valid:false,flightReady:false,
    validationScope:SCOPE,error:code
  });
}
function createWpmlInspectRouter(){
  const router=express.Router();
  router.post('/inspect',(req,res,next)=>{
    const rawType=req.headers['content-type'];
    const type=typeof rawType==='string'?rawType.split(';',1)[0].trim().toLowerCase():'';
    if(!TYPES.has(type))return error(res,415,'UNSUPPORTED_MEDIA_TYPE');
    const encoding=req.headers['content-encoding'];
    if(encoding&&encoding!=='identity')return error(res,415,'UNSUPPORTED_CONTENT_ENCODING');
    const length=req.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_KMZ_BYTES))
      return error(res,413,'KMZ_TOO_LARGE');
    next();
  },express.raw({type:()=>true,limit:MAX_KMZ_BYTES,inflate:false}),(req,res)=>{
    if(!Buffer.isBuffer(req.body)||req.body.length<22)
      return error(res,422,'INVALID_KMZ');
    try{
      const report=inspectKmz(req.body);
      const count=items=>Array.isArray(items)?items.length:0;
      const waypoints=Array.isArray(report.waylines)?
        report.waylines.reduce((sum,line)=>sum+
          (Number.isSafeInteger(line.waypointCount)&&line.waypointCount>=0?
            line.waypointCount:0),0):0;
      // Never return original XML, geographic coordinates, filenames, ZIP members,
      // arbitrary parser errors, pilot tokens or other user-provided strings.
      return res.status(report.valid===true?200:422).json({
        schema:'skyhub-wpml-inspection-v1',
        valid:report.valid===true,flightReady:false,validationScope:SCOPE,
        templateCount:count(report.templates),waylineCount:count(report.waylines),
        waypointCount:waypoints,
        resourceCount:Number.isSafeInteger(report.resourceCount)?report.resourceCount:0,
        errorCount:count(report.errors),warningCount:count(report.warnings)
      });
    }catch(_err){return error(res,422,'INVALID_KMZ');}
  });
  router.use((err,req,res,next)=>{
    if(err?.status===413||err?.type==='entity.too.large')
      return error(res,413,'KMZ_TOO_LARGE');
    if(err?.status===415||err?.type==='encoding.unsupported')
      return error(res,415,'UNSUPPORTED_CONTENT_ENCODING');
    if(err)return error(res,400,'INVALID_REQUEST');
    next();
  });
  return router;
}
module.exports={createWpmlInspectRouter,MAX_KMZ_BYTES};
