"""MQTT-Bruecke zwischen Pilot 2 (Cloud API Thing-Modell) und Backend.

Topics (Gateway = Fernsteuerung, Sub-Device = Fluggeraet):
  sys/product/{gw}/status            update_topo       -> status_reply
  thing/product/{sn}/osd             Telemetrie (RC + Fluggeraet)
  thing/product/{sn}/state           Zustandsaenderungen
  thing/product/{gw}/events          Ereignisse (hms, ...) -> events_reply
  thing/product/{gw}/requests        Anfragen (config)     -> requests_reply
  thing/product/{gw}/services        Befehle vom Server    <- services_reply
"""
import asyncio
import json
import logging
import time
import uuid

import aiomqtt

from .config import settings
from .db import SessionLocal
from .device_dict import describe, model_key
from .models import Device, HmsEvent, TelemetryPoint, utcnow
from .state import hub

log = logging.getLogger("skyhub.mqtt")

SUBSCRIPTIONS = (
    "sys/product/+/status",
    "thing/product/+/osd",
    "thing/product/+/state",
    "thing/product/+/events",
    "thing/product/+/requests",
    "thing/product/+/services_reply",
)


def envelope(method: str, data: dict, tid: str | None = None, bid: str | None = None) -> dict:
    return {"tid": tid or str(uuid.uuid4()), "bid": bid or str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000), "method": method, "data": data}


class MqttBridge:
    def __init__(self) -> None:
        self.client: aiomqtt.Client | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self._last_tel: dict[str, float] = {}

    # ---------------------------------------------------------------- loop
    async def run(self) -> None:
        while True:
            try:
                async with aiomqtt.Client(
                        settings.mqtt_host, settings.mqtt_port,
                        username=settings.mqtt_backend_user,
                        password=settings.mqtt_backend_password,
                        identifier=f"skyhub-backend-{uuid.uuid4().hex[:8]}",
                        keepalive=30) as client:
                    self.client = client
                    for t in SUBSCRIPTIONS:
                        await client.subscribe(t, qos=1)
                    log.info("MQTT verbunden, %d Subscriptions", len(SUBSCRIPTIONS))
                    async for msg in client.messages:
                        try:
                            await self.dispatch(str(msg.topic), msg.payload)
                        except Exception:
                            log.exception("Fehler bei %s", msg.topic)
            except aiomqtt.MqttError as e:
                self.client = None
                log.warning("MQTT getrennt (%s), neuer Versuch in 3 s", e)
                await asyncio.sleep(3)

    async def publish(self, topic: str, payload: dict) -> None:
        if self.client is None:
            raise RuntimeError("MQTT nicht verbunden")
        await self.client.publish(topic, json.dumps(payload), qos=1)

    async def call_service(self, gateway_sn: str, method: str, data: dict,
                           timeout: float = 10.0) -> dict:
        msg = envelope(method, data)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[msg["tid"]] = fut
        try:
            await self.publish(f"thing/product/{gateway_sn}/services", msg)
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(msg["tid"], None)

    # ------------------------------------------------------------ dispatch
    async def dispatch(self, topic: str, raw: bytes) -> None:
        parts = topic.split("/")
        if len(parts) != 4:
            return
        root, _, sn, kind = parts
        p = json.loads(raw)
        if root == "sys" and kind == "status":
            await self.on_status(sn, p)
        elif kind == "osd":
            await self.on_osd(sn, p)
        elif kind == "state":
            hub.state.setdefault(sn, {}).update(p.get("data") or {})
        elif kind == "events":
            await self.on_event(sn, p)
        elif kind == "requests":
            await self.on_request(sn, p)
        elif kind == "services_reply":
            fut = self.pending.get(p.get("tid"))
            if fut and not fut.done():
                fut.set_result(p)

    async def _upsert(self, sn: str, d: dict, gateway_sn: str | None) -> str:
        key = model_key(d.get("domain", -1), d.get("type", -1), d.get("sub_type", -1))
        name, kind = describe(key)
        hub.kind[sn] = kind
        async with SessionLocal() as s:
            dev = await s.get(Device, sn)
            if dev is None:
                dev = Device(sn=sn, domain=d.get("domain", -1), type=d.get("type", -1),
                             sub_type=d.get("sub_type", -1), callsign=name)
                s.add(dev)
                log.info("Neues Geraet %s (%s, %s)", sn, name, key)
            dev.gateway_sn = gateway_sn
            dev.thing_version = d.get("thing_version")
            dev.last_seen = utcnow()
            await s.commit()
        return key

    async def on_status(self, gw: str, p: dict) -> None:
        if p.get("method") != "update_topo":
            return
        d = p.get("data") or {}
        await self._upsert(gw, d, None)
        new_subs = []
        for sub in d.get("sub_devices") or []:
            await self._upsert(sub["sn"], sub, gw)
            new_subs.append(sub["sn"])
        for old in set(hub.topo.get(gw, [])) - set(new_subs):
            hub.online.discard(old)
            await hub.broadcast("device_offline", {"sn": old, "gateway_sn": gw})
        hub.topo[gw] = new_subs
        for sn in [gw, *new_subs]:
            hub.online.add(sn)
            hub.last_seen[sn] = time.time()
            await hub.broadcast("device_online", {"sn": sn, "gateway_sn": gw})
        await self.publish(f"sys/product/{gw}/status_reply",
                           envelope("update_topo", {"result": 0}, p.get("tid"), p.get("bid")))

    async def on_osd(self, sn: str, p: dict) -> None:
        data = p.get("data") or {}
        hub.osd[sn] = data
        hub.last_seen[sn] = time.time()
        if sn not in hub.online:
            hub.online.add(sn)
            await hub.broadcast("device_online", {"sn": sn})
        is_aircraft = hub.kind.get(sn) == "aircraft"
        await hub.broadcast("device_osd" if is_aircraft else "gateway_osd",
                            {"sn": sn, "host": data})
        if is_aircraft:
            await self._store_telemetry(sn, data)

    async def _store_telemetry(self, sn: str, d: dict) -> None:
        lat, lon = d.get("latitude"), d.get("longitude")
        if lat is None or lon is None:
            return
        now = time.time()
        if now - self._last_tel.get(sn, 0) < settings.telemetry_interval_s:
            return
        self._last_tel[sn] = now
        bat = (d.get("battery") or {}).get("capacity_percent")
        async with SessionLocal() as s:
            s.add(TelemetryPoint(sn=sn, lat=lat, lon=lon, height=d.get("height"),
                                 elevation=d.get("elevation"), heading=d.get("attitude_head"),
                                 h_speed=d.get("horizontal_speed"), v_speed=d.get("vertical_speed"),
                                 battery=bat, mode_code=d.get("mode_code")))
            await s.commit()

    async def on_event(self, gw: str, p: dict) -> None:
        method = p.get("method", "")
        data = p.get("data") or {}
        if method == "hms":
            async with SessionLocal() as s:
                s.add(HmsEvent(sn=gw, data=data))
                await s.commit()
            await hub.broadcast("device_hms", {"sn": gw, "list": data.get("list", [])})
        else:
            log.info("Event %s von %s", method, gw)
        if p.get("need_reply") == 1:
            await self.publish(f"thing/product/{gw}/events_reply",
                               envelope(method, {"result": 0}, p.get("tid"), p.get("bid")))

    async def on_request(self, gw: str, p: dict) -> None:
        method = p.get("method", "")
        output: dict = {}
        if method == "config":
            output = {"ntp_server_host": "pool.ntp.org", "app_id": settings.dji_app_id,
                      "app_key": settings.dji_app_key, "app_license": settings.dji_app_license}
        else:
            log.warning("Unbehandelte Request-Methode %s von %s", method, gw)
        await self.publish(f"thing/product/{gw}/requests_reply",
                           envelope(method, {"result": 0, "output": output},
                                    p.get("tid"), p.get("bid")))

    # ------------------------------------------------------------ watchdog
    async def watchdog(self) -> None:
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for sn in list(hub.online):
                if now - hub.last_seen.get(sn, 0) > settings.offline_timeout_s:
                    hub.online.discard(sn)
                    await hub.broadcast("device_offline", {"sn": sn})


bridge = MqttBridge()
