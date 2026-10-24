#!/usr/bin/env python3
"""Real Chromium acceptance with synthetic DJI fixtures. No real SkyHub/Internet I/O."""
from __future__ import annotations
import base64
import json
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
WEBROOT=ROOT/"frontend"/"public"
LEAFLET=Path(os.environ["SKYHUB_TEST_LEAFLET_DIST"]).resolve()
ARTIFACTS=ROOT/"artifacts"/"gfx-browser"
TILE=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3t8AAAAASUVORK5CYII=")
SOCKET_STUB="""(() => {
  window.__skyhubTestSockets=[];
  window.io=function(){
    const handlers={};
    const socket={
      on(key,handler){handlers[key]=handler;return this;},
      disconnect(){this.disconnected=true;},
      emitFixture(key,value){if(handlers[key])handlers[key](value);}
    };
    window.__skyhubTestSockets.push(socket);
    return socket;
  };
})();"""

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(WEBROOT),**kwargs)
    def log_message(self,*_args):
        pass

def check(value,message):
    if not value: raise AssertionError(message)

def fixtures(now):
    def sample(sn,model,battery,altitude,age):
        fields=["battery","altitude","horizontalSpeed","heading","verticalSpeed","linkQuality"]
        return {
          "sn":sn,"modelName":model,"deviceCategory":"aircraft","role":"aircraft",
          "aircraftConnected":True,"lastSeenAt":now,"lastTelemetryAt":now,
          "lastPositionAt":now,"positionTimeVerified":True,"telemetryTimeVerified":True,
          "telemetry":{"battery":battery,"altitude":altitude,"horizontalSpeed":0,
                       "heading":270,"verticalSpeed":-0.5,"linkQuality":4,
                       "latitude":49.1,"longitude":8.6},
          "telemetryFieldAt":{**{f:now-1000 for f in fields},"altitude":now-age},
          "telemetryFieldTimeVerified":{f:True for f in fields}
        }
    return [sample("SYN-A1","SYNTHETIC Mavic 3M",74,35.5,50000),
            sample("SYN-B2","SYNTHETIC Matrice 4T",53,0,1000)]

def guard(page,base,fixture,unexpected):
    def route_request(route):
        url=route.request.url
        if url.startswith(base+"/"):
            if route.request.method!="GET":
                unexpected.append("Non-GET to local fixture");route.abort()
            elif "/api/devices" in url:
                route.fulfill(status=200,content_type="application/json",body=json.dumps(fixture))
            elif "/api/health" in url:
                route.fulfill(status=200,content_type="application/json",body='{"mqtt":false,"subscribed":false}')
            elif "/api/events" in url or "/api/drone/" in url:
                route.fulfill(status=200,content_type="application/json",body="[]")
            elif url.endswith("/socket.io/socket.io.js"):
                route.fulfill(status=200,content_type="application/javascript",body=SOCKET_STUB)
            else: route.continue_()
            return
        if url=="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js":
            route.fulfill(path=str(LEAFLET/"leaflet.js"),content_type="application/javascript")
        elif url=="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css":
            route.fulfill(path=str(LEAFLET/"leaflet.css"),content_type="text/css")
        elif url.endswith("marker-icon.png") or url.endswith("marker-shadow.png"):
            route.fulfill(path=str(LEAFLET/"images"/url.split("/")[-1]),content_type="image/png")
        elif url.startswith("https://") and ".tile.openstreetmap.org/" in url:
            route.fulfill(status=200,body=TILE,content_type="image/png")
        else:
            unexpected.append("Unexpected outbound request blocked");route.abort()
    page.route("**/*",route_request)

def watermark(page):
    page.evaluate("""() => {
      const n=document.createElement('div');
      n.textContent='SYNTHETIC / OFFLINE BROWSER TEST';
      n.setAttribute('aria-hidden','true');
      Object.assign(n.style,{position:'fixed',zIndex:'2000',left:'12px',bottom:'10px',
        font:'700 10px Consolas,monospace',padding:'6px 8px',
        color:'#fff',background:'#9a2143',pointerEvents:'none'});
      document.body.appendChild(n);
    }""")

def main():
    for file in ("index.html","gfx-cockpit.js","telemetry-freshness.js","hyperframes-gfx.css"):
        check((WEBROOT/file).is_file(),"Frontend asset missing: "+file)
    check((LEAFLET/"leaflet.js").is_file(),"Local pinned Leaflet missing")
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    fixture=fixtures(int(time()*1000))
    with ThreadingHTTPServer(("127.0.0.1",0),Handler) as httpd:
        Thread(target=httpd.serve_forever,daemon=True).start()
        base=f"http://127.0.0.1:{httpd.server_port}"
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=["--no-sandbox"])
            try:
                context=browser.new_context(viewport={"width":1365,"height":850})
                page=context.new_page()
                errors=[];unexpected=[]
                page.on("pageerror",lambda error:errors.append(str(error)))
                guard(page,base,fixture,unexpected)
                page.goto(base+"/",wait_until="load")
                page.wait_for_function("() => document.querySelector('#gfxCockpitDevice').options.length===2")
                check(page.locator(".leaflet-container").count()==1,"Leaflet map missing")
                check(page.locator("#gfxCockpitBattery").inner_text()=="74 %","Battery fixture missing")
                check("Veraltet" in page.locator("#gfxCockpitAltitudeAge").inner_text(),
                      "Old altitude should be marked stale")
                check(page.locator("#gfxCockpitAltitude").inner_text()=="35,5 m",
                      "Stale value must remain visible with warning")
                check(page.locator("#gfxCockpitBatteryMeter").evaluate(
                    "el=>parseFloat(el.style.width)")>0,"Fresh verified battery meter missing")
                check(page.locator("#gfxCockpitLocate").is_enabled(),"Map location button disabled")
                check(page.locator('a[href="/wpml-editor.html"]').count()==1,"Duplicate module link")
                page.locator("#gfxCockpitDevice").select_option("SYN-B2")
                check(page.locator("#gfxCockpitAltitude").inner_text()=="0,0 m","Real zero missing")
                page.evaluate("""() => window.__skyhubTestSockets.at(-1).emitFixture('device_update',{
                    sn:'SYN-B2',modelName:'SYNTHETIC Matrice 4T',aircraftConnected:true,
                    lastSeenAt:Date.now(),lastTelemetryAt:Date.now(),
                    telemetry:{battery:52,altitude:0,horizontalSpeed:0,heading:270,
                      verticalSpeed:0,linkQuality:4,latitude:49.1,longitude:8.6},
                    lastPositionAt:Date.now(),positionTimeVerified:true,
                    telemetryFieldAt:{battery:Date.now(),altitude:Date.now(),
                      horizontalSpeed:Date.now(),heading:Date.now(),verticalSpeed:Date.now(),
                      linkQuality:Date.now()},
                    telemetryFieldTimeVerified:{battery:true,altitude:true,horizontalSpeed:true,
                      heading:true,verticalSpeed:true,linkQuality:true}
                  })""")
                check(page.locator("#gfxCockpitDevice").input_value()=="SYN-B2",
                      "Device selection lost on incremental OSD")
                check(page.locator("#gfxCockpitBattery").inner_text()=="52 %",
                      "New OSD field not rendered")
                page.locator("#gfxMapFocus").click()
                check(page.locator("#gfxMapFocus").get_attribute("aria-pressed")=="true",
                      "Map focus toggle failed")
                page.locator("#gfxMapFocus").click()
                page.locator("#tabTak").click()
                check(page.locator("#gfxCockpit").is_hidden(),"TAK overlays cockpit")
                page.locator("#tabOperations").click()
                page.keyboard.press("/")
                check(page.locator("#deviceSearch").evaluate("el=>document.activeElement===el"),
                      "Keyboard slash shortcut broken")
                watermark(page)
                page.screenshot(path=str(ARTIFACTS/"gfx-1365-synthetic.png"),full_page=True)
                for width,height in ((375,812),(320,640)):
                    page.set_viewport_size({"width":width,"height":height})
                    check(page.locator("#gfxCockpit").is_visible(),"Cockpit absent on mobile")
                    check(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 2"),
                          "Horizontal document overflow at "+str(width))
                    page.screenshot(path=str(ARTIFACTS/f"gfx-{width}-synthetic.png"),full_page=True)
                check(not errors,"Browser JS errors: "+repr(errors))
                check(not unexpected,"Unexpected traffic: "+repr(unexpected))
                context.close()
                ctx=browser.new_context(viewport={"width":390,"height":780},reduced_motion="reduce")
                reduced=ctx.new_page();errors=[];unexpected=[]
                reduced.on("pageerror",lambda error:errors.append(str(error)))
                guard(reduced,base,fixture,unexpected)
                reduced.goto(base+"/",wait_until="load")
                reduced.locator("#gfxMotionToggle").wait_for(state="visible")
                check(reduced.locator("#gfxMotionToggle").is_disabled(),
                      "Reduced motion override must be blocked")
                check(reduced.locator("body").get_attribute("data-gfx-motion")=="off",
                      "Reduced motion not respected")
                check(not errors and not unexpected,"Reduced-motion browser errors/traffic")
                ctx.close()
                print("GFX isolated Chromium: PASS (desktop, 375px, 320px, reduced motion)")
            finally: browser.close()

if __name__=="__main__":
    main()
