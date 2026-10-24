'use strict';
// Pure 2D coverage visualization: NOT DJI WPML/waylines generation.
// Fixed local tangent/equirectangular approximation for short survey polygons.
// No elevation, camera optics, geofence, collision or aircraft performance inputs.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubSurveyPreview=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const DEG=Math.PI/180;
  function invalid(message){throw new TypeError('Survey preview invalid: '+message);}
  function num(input,label,min,max){
    if((typeof input!=='number'&&typeof input!=='string')||
       (typeof input==='string'&&!/^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(input)))
      invalid(label+' must be numeric');
    const x=Number(input);
    if(!Number.isFinite(x)||x<min||x>max)invalid(label+' out of range');
    return x;
  }
  function cross(a,b,c){
    return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  }
  function onSegment(a,b,c){
    return Math.min(a.x,b.x)-1e-8<=c.x&&c.x<=Math.max(a.x,b.x)+1e-8&&
      Math.min(a.y,b.y)-1e-8<=c.y&&c.y<=Math.max(a.y,b.y)+1e-8;
  }
  function intersects(a,b,c,d){
    const c1=cross(a,b,c),c2=cross(a,b,d),c3=cross(c,d,a),c4=cross(c,d,b);
    if((c1>1e-8&&c2< -1e-8||c1< -1e-8&&c2>1e-8)&&
       (c3>1e-8&&c4< -1e-8||c3< -1e-8&&c4>1e-8))return true;
    return Math.abs(c1)<=1e-8&&onSegment(a,b,c)||
      Math.abs(c2)<=1e-8&&onSegment(a,b,d)||
      Math.abs(c3)<=1e-8&&onSegment(c,d,a)||
      Math.abs(c4)<=1e-8&&onSegment(c,d,b);
  }
  function validatePolygon(vertices){
    if(!Array.isArray(vertices)||vertices.length<3||vertices.length>80)
      invalid('polygon requires 3–80 vertices');
    const points=vertices.map((p,i)=>{
      if(!p||typeof p!=='object'||Array.isArray(p))invalid('vertex '+i);
      return {lat:num(p.lat,'latitude '+i,-85,85),
        lon:num(p.lon,'longitude '+i,-180,180)};
    });
    if(points.length>3&&points[0].lat===points[points.length-1].lat&&
       points[0].lon===points[points.length-1].lon)points.pop();
    if(points.length<3)invalid('too few distinct vertices');
    const lat0=points.reduce((a,p)=>a+p.lat,0)/points.length;
    const lon0=points.reduce((a,p)=>a+p.lon,0)/points.length;
    const sx=111320*Math.cos(lat0*DEG),sy=111132;
    const xy=points.map(p=>({x:(p.lon-lon0)*sx,y:(p.lat-lat0)*sy}));
    if(xy.some((p,i)=>i>0&&Math.hypot(p.x-xy[i-1].x,p.y-xy[i-1].y)<0.5)||
       Math.hypot(xy[0].x-xy[xy.length-1].x,xy[0].y-xy[xy.length-1].y)<0.5)
      invalid('nearly identical adjacent vertices');
    const xs=xy.map(p=>p.x),ys=xy.map(p=>p.y);
    if(Math.max(...xs)-Math.min(...xs)>2000||Math.max(...ys)-Math.min(...ys)>2000)
      invalid('survey extent exceeds 2 km local approximation');
    for(let i=0;i<xy.length;i++){
      const a=xy[i],b=xy[(i+1)%xy.length];
      for(let j=i+1;j<xy.length;j++){
        if(j===i+1||(i===0&&j===xy.length-1))continue;
        if(intersects(a,b,xy[j],xy[(j+1)%xy.length]))
          invalid('self-intersecting survey polygon');
      }
    }
    let twiceArea=0;
    for(let i=0;i<xy.length;i++){
      const a=xy[i],b=xy[(i+1)%xy.length];
      twiceArea+=a.x*b.y-a.y*b.x;
    }
    const area=Math.abs(twiceArea)/2;
    if(!Number.isFinite(area)||area<10)invalid('degenerate or tiny survey polygon');
    return {points,xy,lat0,lon0,sx,sy,area};
  }
  function preview(polygon,options={}){
    const g=validatePolygon(polygon);
    const spacing=num(options.spacing??20,'line spacing',2,200);
    const heading=num(options.heading??0,'heading',0,360)*DEG;
    const sin=Math.sin(heading),cos=Math.cos(heading);
    // u is along-track, v is cross-track. Heading is clockwise from north.
    const uv=g.xy.map(p=>({u:p.x*sin+p.y*cos,v:p.x*cos-p.y*sin}));
    const vs=uv.map(p=>p.v);
    const low=Math.min(...vs),high=Math.max(...vs),width=high-low;
    const stripes=[];
    if(width<=spacing)stripes.push((low+high)/2);
    else for(let v=low+spacing/2;v<high;v+=spacing){
      if(stripes.length>=200)invalid('more than 200 preview strips');
      stripes.push(v);
    }
    if(!stripes.length)stripes.push((low+high)/2);
    const lines=[];let total=0;
    function geo(u,v){
      const x=u*sin+v*cos,y=u*cos-v*sin;
      return {lat:g.lat0+y/g.sy,lon:g.lon0+x/g.sx};
    }
    for(const [index,v] of stripes.entries()){
      const hits=[];
      for(let i=0;i<uv.length;i++){
        const a=uv[i],b=uv[(i+1)%uv.length];
        if((a.v<=v&&b.v>v)||(b.v<=v&&a.v>v)){
          const factor=(v-a.v)/(b.v-a.v);
          hits.push(a.u+factor*(b.u-a.u));
        }
      }
      hits.sort((a,b)=>a-b);
      if(hits.length%2)invalid('unpaired polygon intersections');
      const spans=[];
      for(let i=0;i<hits.length;i+=2){
        const len=hits[i+1]-hits[i];
        if(len>=0.5)spans.push([hits[i],hits[i+1]]);
      }
      const forwards=index%2===0;
      const ordered=forwards?spans:spans.reverse();
      for(const span of ordered){
        const from=forwards?span[0]:span[1],to=forwards?span[1]:span[0];
        lines.push({start:geo(from,v),end:geo(to,v),lengthMeters:Math.abs(to-from),
          stripeIndex:index});
        total+=Math.abs(to-from);
        if(lines.length>400)invalid('more than 400 preview line segments');
      }
    }
    if(!lines.length)invalid('no usable coverage segments');
    return {
      polygon:g.points.map(p=>({...p})),
      segments:lines,
      areaSqMeters:g.area,
      previewSegmentLengthMeters:total,
      lineSpacingMeters:spacing,
      headingDegrees:heading/DEG,
      stripeCount:stripes.length,
      segmentCount:lines.length,
      flightReady:false,
      exportableAsWaylines:false,
      validationScope:'approximate-2d-geometry-preview',
      warning:'Approximate local geometry only. Not a DJI flight plan, terrain model, coverage guarantee or flight clearance.'
    };
  }
  return Object.freeze({preview,validatePolygon});
});
