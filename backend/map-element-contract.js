'use strict';

// Read-only DJI Cloud API 1.18 map-element response adapter. No database or network access.
const MAX_GROUPS=100;
const MAX_ELEMENTS=5000;
const MAX_VERTICES=2000;

function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function text(value,max){return typeof value==='string'&&value.length>0&&value.length<=max?value:null;}
function timestamp(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
function coordinate(value){
  if(!Array.isArray(value)||value.length<2||value.length>3)return null;
  const [lon,lat,alt]=value;
  if(!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(lat)||Math.abs(lat)>90||
    (value.length===3&&!Number.isFinite(alt)))return null;
  return value.slice();
}
function samePosition(a,b){return a.length===b.length&&a.every((n,i)=>n===b[i]);}
function distinctPositions(points){return new Set(points.map(p=>p[0]+','+p[1])).size;}
function geometry(input){
  if(!object(input))return null;
  if(input.type==='Point'){
    const point=coordinate(input.coordinates);
    return point?{type:'Point',coordinates:point}:null;
  }
  if(input.type==='LineString'){
    const raw=input.coordinates;
    if(!Array.isArray(raw)||raw.length<2||raw.length>MAX_VERTICES)return null;
    const points=raw.map(coordinate);
    return points.every(Boolean)&&distinctPositions(points)>=2?{type:'LineString',coordinates:points}:null;
  }
  if(input.type==='Polygon'){
    const raw=input.coordinates;
    if(!Array.isArray(raw)||!raw.length||raw.length>100)return null;
    let vertices=0;
    const rings=[];
    for(const ring of raw){
      if(!Array.isArray(ring)||ring.length<3)return null;
      vertices+=ring.length;
      if(vertices>MAX_VERTICES)return null;
      const points=ring.map(coordinate);
      if(!points.every(Boolean)||distinctPositions(points)<3)return null;
      if(!samePosition(points[0],points.at(-1)))points.push(points[0].slice());
      if(points.length<4)return null;
      rings.push(points);
    }
    return {type:'Polygon',coordinates:rings};
  }
  return null;
}
function element(input){
  if(!object(input)||!object(input.resource)||!object(input.resource.content))return null;
  const id=text(input.id,128),name=text(input.name,255)||id;
  const content=input.resource.content;
  const shape=(content.type===undefined||content.type==='Feature')?geometry(content.geometry):null;
  if(!id||!name||!shape)return null;
  const properties=object(content.properties)?content.properties:{};
  const color=typeof properties.color==='string'&&/^#[0-9a-f]{6}$/i.test(properties.color)?
    properties.color:null;
  return {
    id,name,kind:shape.type,geometry:shape,
    // DJI examples mark LineString/Polygon with resource.type=0; keep it for diagnostics.
    resourceType:[0,1,2].includes(input.resource.type)?input.resource.type:null,
    color,clampToGround:typeof properties.clampToGround==='boolean'?properties.clampToGround:null,
    is3d:typeof properties.is3d==='boolean'?properties.is3d:null,
    createTime:timestamp(input.create_time),updateTime:timestamp(input.update_time)
  };
}
function parseMapElementGroups(response){
  if(!object(response)||response.code!==0||!Array.isArray(response.data)){
    throw new TypeError('Invalid DJI map-element response');
  }
  if(response.data.length>MAX_GROUPS)throw new RangeError('Too many DJI map-element groups');
  const groups=[];
  let rejectedElements=0,totalElements=0;
  const groupIds=new Set();
  for(const raw of response.data){
    if(!object(raw)||!text(raw.id,128)||!Array.isArray(raw.elements)||
      groupIds.has(raw.id))throw new TypeError('Invalid DJI map-element group');
    groupIds.add(raw.id);
    totalElements+=raw.elements.length;
    if(totalElements>MAX_ELEMENTS)throw new RangeError('Too many DJI map elements');
    const elements=[];
    const elementIds=new Set();
    for(const rawElement of raw.elements){
      const item=element(rawElement);
      if(!item||elementIds.has(item.id)){rejectedElements++;continue;}
      elementIds.add(item.id);
      elements.push(item);
    }
    groups.push({id:raw.id,name:text(raw.name,255)||raw.id,
      type:[0,1,2].includes(raw.type)?raw.type:null,
      isLocked:typeof raw.is_lock==='boolean'?raw.is_lock:null,
      createTime:timestamp(raw.create_time),elements});
  }
  return {groups,rejectedElements};
}

module.exports={parseMapElementGroups};
