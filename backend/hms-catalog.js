'use strict';

// German/English HMS texts derived from DJI's hms.json (see data/HMS-LICENSE.txt).
const texts=require('./data/hms-texts.json');

// DJI aircraft mode_code values that mean "in the air": manual/automatic flight,
// wayline, panorama, tracking, ADS-B avoidance, RTH, landing, APAS, virtual stick,
// live flight controls. 0-2 (standby/prep), 13 (upgrading), 14 (disconnected) are ground.
const IN_THE_SKY=new Set([3,4,5,6,7,8,9,10,11,12,15,16,17]);

function describeHms(alert,{domain=null,modeCode=null}={}){
  if(!alert || typeof alert.code!=='string')return null;
  const base=(domain==='3'?'dock_tip_':'fpv_tip_')+alert.code;
  const sky=IN_THE_SKY.has(modeCode) && texts[base+'_in_the_sky'];
  const entry=sky || texts[base];
  if(!entry)return null;
  // DJI placeholders count components from 1 for the operator.
  const index=Number.isInteger(alert.componentIndex)?String(alert.componentIndex+1):'?';
  const fill=text=>text && text
    .replace(/%component_index|%battery_index|%index/g,index)
    .replace(/%alarmid/g,alert.code);
  return {de:fill(entry.de)||null,en:fill(entry.en)||null};
}
module.exports={describeHms,IN_THE_SKY};
