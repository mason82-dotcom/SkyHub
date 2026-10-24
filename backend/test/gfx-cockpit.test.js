'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cockpit=require('../../frontend/public/gfx-cockpit.js');
const fresh=require('../../frontend/public/telemetry-freshness.js');
const now=1_800_000_000_000;
function device(overrides={}){
  return Object.assign({
    aircraftConnected:true,
    telemetry:{battery:0,altitude:22.25,horizontalSpeed:0,heading:270,verticalSpeed:-1.5,linkQuality:4},
    telemetryFieldAt:{battery:now-2000,altitude:now-2000,horizontalSpeed:now-2000,
      heading:now-2000,verticalSpeed:now-2000,linkQuality:now-2000},
    telemetryFieldTimeVerified:{battery:true,altitude:true,horizontalSpeed:true,
      heading:true,verticalSpeed:true,linkQuality:true}
  },overrides);
}
test('cockpit presents recorded zero values rather than missing values',()=>{
  const record=device();
  assert.deepEqual(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now),{
    value:'0 %',age:'Aktuell · vor 2 s',kind:'current',meter:0
  });
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[2],fresh,now).value,'0,0 m/s');
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[4],fresh,now).value,'-1,5 m/s');
});
test('field state is independently validated even if an aggregate OSD packet is fresh',()=>{
  const record=device({lastTelemetryAt:now});
  record.telemetryFieldAt.altitude=now-22000;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'stale');
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).kind,'current');
});
test('unverified and disconnected values are never labelled current',()=>{
  const record=device();
  record.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[3],fresh,now).kind,'unverified');
  record.aircraftConnected=false;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).kind,'stale');
});
test('missing, invalid, implausible and future-timestamp fields fail closed',()=>{
  const record=device();
  record.telemetry.battery=101;
  assert.deepEqual(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now),{
    value:'—',age:'Nicht empfangen',kind:'missing',meter:null
  });
  record.telemetry.battery=Number.NaN;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[0],fresh,now).value,'—');
  delete record.telemetryFieldAt.altitude;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'unknown');
  record.telemetryFieldAt.altitude=now+1000;
  assert.equal(cockpit.valueFor(record,cockpit.SPECS[1],fresh,now).kind,'unknown');
  assert.equal(cockpit.valueFor(null,cockpit.SPECS[0],fresh,now).value,'—');
});
test('cockpit markup preserves canonical device and map interactions',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  for(const id of ['gfxCockpit','gfxCockpitDevice','gfxCockpitStatus','gfxCockpitLocate',
    ...cockpit.SPECS.flatMap(s=>['gfxCockpit'+s.id,'gfxCockpit'+s.id+'Age',
       'gfxCockpit'+s.id+'Meter'])]){
    if(id.endsWith('Meter')&&!['Battery','Link'].some(s=>id==='gfxCockpit'+s+'Meter'))continue;
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.ok(html.indexOf('<script src="/telemetry-freshness.js"></script>')<
    html.indexOf('<script src="/gfx-cockpit.js"></script>'));
  assert.ok(html.indexOf('<script src="/gfx-cockpit.js"></script>')<
    html.indexOf('<script>'));
  assert.match(html,/SkyHubGfxCockpit\?\.mount/);
  assert.match(html,/cockpit\.render\(data,selectedSn,listState\)/);
  assert.match(html,/id="gfxCockpit"[^>]+aria-labelledby="gfxCockpitHeading"/);
});
test('cockpit module never creates secondary telemetry/auth transports',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/gfx-cockpit.js'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|\bEventSource\b|\blocalStorage\b|\bsessionStorage\b/);
});

test('compass bearing only uses current, verified, bounded DJI headings',()=>{
  const freshRecord=device();
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),270);
  freshRecord.telemetry.heading=-90;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),270,'negative signed yaw normalized to 270 degrees');
  freshRecord.telemetry.heading=360;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),0);
  freshRecord.telemetry.heading=361;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null,'unbounded heading must not draw a needle');
  assert.equal(cockpit.valueFor(freshRecord,cockpit.SPECS[3],fresh,now).kind,'missing');
  freshRecord.telemetry.heading=90;
  freshRecord.telemetryFieldTimeVerified.heading=false;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  freshRecord.telemetryFieldTimeVerified.heading=true;
  freshRecord.telemetryFieldAt.heading=now-17000;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  freshRecord.telemetryFieldAt.heading=now-2000;
  freshRecord.aircraftConnected=false;
  assert.equal(cockpit.bearingFor(freshRecord,fresh,now),null);
  assert.equal(cockpit.bearingFor(null,fresh,now),null);
});
test('decorative compass is hidden and driven by provenance, not fake animation',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/index.html'),'utf8');
  const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/hyperframes-gfx.css'),'utf8');
  assert.match(html,/id="gfxCockpitCompass"[^>]+aria-hidden="true" hidden/);
  assert.match(html,/id="gfxCockpitNeedle" class="gfx-heading-needle"/);
  assert.match(css,/gfx-heading-compass\[hidden\]/);
  assert.doesNotMatch(css, /gfx-heading-needle[^{}]*\{[^}]*animation\s*:/);
});
