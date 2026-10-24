'use strict';
// SKY//PULSE in-container one-shot audit: no commands, writes or raw telemetry output.
// Passed to "docker compose exec -T backend node -" over stdin; never installed.
(async()=>{
  const clock=Date.now();
  const permitted=['current','stale','unverified','unknown','missing'];
  const allowedKeys=['battery','altitude','horizontalSpeed','heading','verticalSpeed',
    'attitudePitch','attitudeRoll','linkQuality'];
  const modelName=device=>{
    const m=device?.model||{};
    const key=[m.domain,m.type,m.subType].map(String).join(':');
    if(key==='0:99:1')return 'Matrice 4T';
    if(key==='2:174:0')return 'RC Plus 2 Enterprise';
    return 'Anderes/unklares Modell';
  };
  const roleName=d=>d?.role==='gateway'?'Gateway':
    d?.role==='subdevice'&&d?.deviceCategory==='aircraft'?'Fluggerät':
    d?.deviceCategory==='aircraft'?'Fluggerät':'Andere Rolle';
  try{
    const token=process.env.SKYHUB_VIEW_TOKEN;
    if(!token){console.error('GFX-Abnahme unvollständig: View-Token im Backend fehlt.');process.exitCode=3;return;}
    const cockpit=require('../frontend/public/gfx-cockpit.js');
    const freshness=require('../frontend/public/telemetry-freshness.js');
    if(typeof cockpit.qualityFor!=='function'||typeof cockpit.valueFor!=='function'||
       typeof cockpit.attitudeFor!=='function'||typeof cockpit.bearingFor!=='function'||
       typeof freshness.evaluateField!=='function'||freshness.CURRENT_MS!==15000||
       !Array.isArray(cockpit.SPECS)||cockpit.SPECS.length!==8||
       cockpit.SPECS.some((s,i)=>s.key!==allowedKeys[i])){
      console.error('GFX-Abnahme unvollständig: laufendes Backend-Image ohne passende Cockpit-Version.');
      process.exitCode=3;return;
    }
    const response=await fetch('http://127.0.0.1:4000/api/devices',{
      method:'GET',headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(6000),cache:'no-store'
    });
    if(!response.ok)throw Error('api');
    const raw=await response.text();
    if(raw.length>3000000)throw Error('bound');
    const all=JSON.parse(raw);
    if(!Array.isArray(all))throw Error('shape');
    const limited=all.slice(0,16);
    const results=limited.map((device,i)=>{
      const d=device&&typeof device==='object'&&!Array.isArray(device)?device:{};
      const q=cockpit.qualityFor(d,freshness,clock);
      const kinds=Object.fromEntries(cockpit.SPECS.map(spec=>{
        const kind=cockpit.valueFor(d,spec,freshness,clock).kind;
        return [spec.key,permitted.includes(kind)?kind:'unknown'];
      }));
      return {
        slot:i+1,model:modelName(d),role:roleName(d),
        quality:{current:q.current,stale:q.stale,unverified:q.unverified,
          unknown:q.unknown,missing:q.missing},
        fieldKinds:kinds,
        compassDrawable:cockpit.bearingFor(d,freshness,clock)!==null,
        horizonDrawable:cockpit.attitudeFor(d,freshness,clock)!==null
      };
    });
    console.log(JSON.stringify({
      schema:'skyhub-gfx-readonly-hardware-audit-v1',
      classification:'field-status-only-no-flight-authority',
      examined:results.length,truncated:all.length>16,
      results
    }));
    if(!results.some(x=>x.role==='Fluggerät'))process.exitCode=3;
  }catch(_){
    console.error('GFX-Abnahme fehlgeschlagen: geschützte GET-API oder Backend-Image nicht auswertbar.');
    process.exitCode=1;
  }
})();
