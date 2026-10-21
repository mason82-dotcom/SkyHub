'use strict';
// Bounded, value-free DJI field inventory grouped by device type. "Typical"
// means supported by the corresponding DJI message family, NOT required in
// every packet or proof of a sensor/fix being currently available.
const GATEWAY_FIELDS=Object.freeze([
  'latitude','longitude','heightEllipsoid','battery','linkQuality'
]);
const AIRCRAFT_FIELDS=Object.freeze([
  'latitude','longitude','altitude','heightEllipsoid','battery','heading',
  'horizontalSpeed','verticalSpeed','attitudePitch','attitudeRoll',
  'homeDistance','remainingFlightTime','gpsSatellites','rtkSatellites',
  'rtkFixState','positionQuality'
]);
const GATEWAY_OPTIONAL=Object.freeze(['sdrLinkState','fourGLinkState','fourGLinkQuality']);
const AIRCRAFT_OPTIONAL=Object.freeze([
  'windSpeed','windDirectionCode','totalFlightTime','totalFlightDistance'
]);
const ALL_FIELDS=Object.freeze([...new Set([
  ...GATEWAY_FIELDS,...AIRCRAFT_FIELDS,...GATEWAY_OPTIONAL,...AIRCRAFT_OPTIONAL
])]);

function isPresent(t,key){return Number.isFinite(t[key]);}
function summarizeTelemetryFields(devices){
  if(!Array.isArray(devices))return [];
  return devices.slice(0,200).map((device,index)=>{
    const d=device&&typeof device==='object'?device:{};
    const t=d.telemetry&&typeof d.telemetry==='object'?d.telemetry:{};
    const role=d.role==='gateway'?'gateway':d.deviceCategory==='aircraft'||
      (d.role==='subdevice'&&d.model?.domain==='0')?'aircraft':'unknown';
    const typical=role==='gateway'?GATEWAY_FIELDS:role==='aircraft'?AIRCRAFT_FIELDS:[];
    const extra=role==='gateway'?GATEWAY_OPTIONAL:
      role==='aircraft'?AIRCRAFT_OPTIONAL:ALL_FIELDS;
    const applicable=new Set([...typical,...extra]);
    const observed=typical.filter(key=>isPresent(t,key));
    const notObserved=typical.filter(key=>!isPresent(t,key));
    const extraObserved=extra.filter(key=>isPresent(t,key));
    const extraNotObserved=extra.filter(key=>!isPresent(t,key));
    const notApplicable=ALL_FIELDS.filter(key=>!applicable.has(key));
    // Only fixed known model labels; do not reflect raw DJI fields/identifiers.
    const model=['DJI RC Pro Enterprise','Mavic 3M'].includes(d.modelName)?
      d.modelName:'anderes Gerät';
    return {
      index:index+1,model,role,
      osdFresh:d.fresh===true,positionFresh:d.positionFresh===true,
      positionUnavailable:d.positionUnavailable===true,
      typicalTotal:typical.length,observed,notObserved,
      extraObserved,extraNotObserved,notApplicable
    };
  });
}
module.exports={ALL_FIELDS,GATEWAY_FIELDS,AIRCRAFT_FIELDS,
  GATEWAY_OPTIONAL,AIRCRAFT_OPTIONAL,summarizeTelemetryFields};
