'use strict';

// Decides which validated GPS points become persisted track history.
// Live display is unaffected: this only limits what is written to PostGIS.
const MIN_DISTANCE_M=2;
const MIN_ALTITUDE_M=2;
const HEARTBEAT_MS=60000;

// Equirectangular approximation: accurate to centimetres over a few metres.
function distanceMeters(a,b){
  const rad=Math.PI/180;
  const x=(b.longitude-a.longitude)*rad*Math.cos((a.latitude+b.latitude)/2*rad);
  const y=(b.latitude-a.latitude)*rad;
  return Math.sqrt(x*x+y*y)*6371000;
}

function createTrackPolicy({limit=200}={}){
  const last=new Map();
  return {
    // point: registry point {deviceSn, latitude, longitude, altitude}; at: sample time (ms)
    shouldStore(point,at){
      if(!point || !Number.isFinite(at))return false;
      // DJI reports 0/0 without a position fix; that is not a place the aircraft has been.
      if(point.latitude===0 && point.longitude===0)return false;
      const prev=last.get(point.deviceSn);
      const moved=!prev || distanceMeters(prev,point)>=MIN_DISTANCE_M ||
        (Number.isFinite(point.altitude) && Number.isFinite(prev.altitude) &&
          Math.abs(point.altitude-prev.altitude)>=MIN_ALTITUDE_M) ||
        (Number.isFinite(point.altitude)!==Number.isFinite(prev.altitude));
      if(!moved && at-prev.at<HEARTBEAT_MS)return false;
      if(!last.has(point.deviceSn) && last.size>=limit)last.delete(last.keys().next().value);
      last.set(point.deviceSn,{latitude:point.latitude,longitude:point.longitude,altitude:point.altitude,at});
      return true;
    },
    // A failed database write must not suppress the next stationary sample.
    // Keep a newer accepted point if another write was already dispatched.
    rollback(point,at){
      const current=last.get(point.deviceSn);
      if(current && current.at===at && current.latitude===point.latitude &&
          current.longitude===point.longitude && current.altitude===point.altitude){
        last.delete(point.deviceSn);
      }
    }
  };
}
module.exports={createTrackPolicy,distanceMeters,MIN_DISTANCE_M,HEARTBEAT_MS};
