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
from .dji.config_contract import DjiConfigContractError, build_product_config, validate_config_request
from .dji.normalizer import normalize_dji_payload, telemetry_point_fields
from .dji.protocol import (
    DJI_INBOUND_SUBSCRIPTIONS,
    classify_topic,
    ensure_allowed_service_method,
    events_reply_topic,
    requests_reply_topic,
    service_topic,
    status_reply_topic,
)
from .dji.rtk import RtkFixMonitor
from .dji.storage_contract import (
    DjiStorageContractError,
    STS_DURATION_SECONDS,
    build_sts_response,
    validate_storage_config_request,
)
from .dji.topology import parse_dji_topology_update
from .models import Device, HmsEvent, TelemetryPoint, utcnow
from .s3util import assume_role
from .state import hub

log = logging.getLogger("skyhub.mqtt")

SUBSCRIPTIONS = DJI_INBOUND_SUBSCRIPTIONS


def envelope(method: str, data: dict, tid: str | None = None, bid: str | None = None) -> dict:
    return {"tid": tid or str(uuid.uuid4()), "bid": bid or str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000), "method": method, "data": data}


class MqttBridge:
    def __init__(self) -> None:
        self.client: aiomqtt.Client | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self._last_tel: dict[str, float] = {}
        self.rtk_monitor = RtkFixMonitor()

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
        ensure_allowed_service_method(method)
        msg = envelope(method, data)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[msg["tid"]] = fut
        try:
            await self.publish(service_topic(gateway_sn), msg)
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(msg["tid"], None)

    # ------------------------------------------------------------ dispatch
    async def dispatch(self, topic: str, raw: bytes) -> None:
        classified = classify_topic(topic)
        if classified is None:
            log.warning("Unbekanntes/ungueltiges DJI MQTT-Topic verworfen: %s", topic)
            return
        kind, sn = classified

        p = json.loads(raw)
        if not isinstance(p, dict):
            return
        if kind == "status":
            await self.on_status(sn, p)
        elif kind == "osd":
            await self.on_osd(sn, p)
        elif kind == "state":
            state_data = p.get("data") or {}
            if isinstance(state_data, dict):
                hub.state.setdefault(sn, {}).update(state_data)
        elif kind == "events":
            await self.on_event(sn, p)
        elif kind == "requests":
            await self.on_request(sn, p)
        elif kind == "services_reply":
            fut = self.pending.get(p.get("tid"))
            if fut and not fut.done():
                fut.set_result(p)

    async def _upsert(self, sn: str, d: dict, gateway_sn: str | None) -> str:
        domain = d.get("domain", -1)
        if isinstance(domain, str) and domain.isdigit():
            domain = int(domain)
        if isinstance(domain, bool) or not isinstance(domain, int):
            domain = -1
        type_ = d["type"]
        sub_type = d["sub_type"]
        key = model_key(domain, type_, sub_type)
        name, kind = describe(key)
        hub.kind[sn] = kind
        async with SessionLocal() as s:
            dev = await s.get(Device, sn)
            if dev is None:
                dev = Device(sn=sn, domain=domain, type=type_,
                             sub_type=sub_type, callsign=name)
                s.add(dev)
                log.info("Neues Geraet %s (%s, %s)", sn, name, key)
            else:
                if domain >= 0:
                    dev.domain = domain
                dev.type = type_
                dev.sub_type = sub_type
                dev.callsign = name
            dev.gateway_sn = gateway_sn
            if isinstance(d.get("thing_version"), str):
                dev.thing_version = d["thing_version"]
            dev.last_seen = utcnow()
            await s.commit()
        return key

    async def on_status(self, gw: str, p: dict) -> None:
        topology = parse_dji_topology_update(gw, p)
        if topology is None:
            if p.get("method") == "update_topo":
                log.warning("Ungueltige update_topo-Identitaet von %s verworfen", gw)
            return

        await self._upsert(gw, topology["product"], None)
        new_subs = []
        for sub in topology["sub_devices"]:
            await self._upsert(sub["sn"], sub["product"], gw)
            new_subs.append(sub["sn"])
        for old in set(hub.topo.get(gw, [])) - set(new_subs):
            hub.online.discard(old)
            await hub.broadcast("device_offline", {"sn": old, "gateway_sn": gw})
        hub.topo[gw] = new_subs
        for sn in [gw, *new_subs]:
            hub.online.add(sn)
            hub.last_seen[sn] = time.time()
            await hub.broadcast("device_online", {"sn": sn, "gateway_sn": gw})
        await self.publish(status_reply_topic(gw),
                           envelope("update_topo", {"result": 0}, p.get("tid"), p.get("bid")))

    async def on_osd(self, sn: str, p: dict) -> None:
        data = p.get("data") or {}
        if not isinstance(data, dict):
            log.warning("Nicht-objektfoermige OSD-Daten von %s verworfen", sn)
            return

        normalized = normalize_dji_payload(p)
        hub.osd[sn] = data
        hub.normalized[sn] = normalized
        hub.last_seen[sn] = time.time()
        if sn not in hub.online:
            hub.online.add(sn)
            await hub.broadcast("device_online", {"sn": sn})

        navigation = normalized.get("navigation") or {}
        rtk = navigation.get("rtk") if isinstance(navigation, dict) else None
        if isinstance(rtk, dict):
            transition = self.rtk_monitor.observe(sn, rtk)
            if transition:
                await hub.broadcast(f"rtk_fix_{transition['type']}", transition)

        is_aircraft = hub.kind.get(sn) == "aircraft"
        await hub.broadcast("device_osd" if is_aircraft else "gateway_osd",
                            {"sn": sn, "host": data, "normalized": normalized})
        if is_aircraft:
            await self._store_telemetry(sn, normalized)

    async def _store_telemetry(self, sn: str, normalized: dict) -> None:
        fields = telemetry_point_fields(normalized)
        if fields is None:
            return
        now = time.time()
        if now - self._last_tel.get(sn, 0) < settings.telemetry_interval_s:
            return
        self._last_tel[sn] = now
        async with SessionLocal() as s:
            s.add(TelemetryPoint(sn=sn, **fields))
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
            await self.publish(events_reply_topic(gw),
                               envelope(method, {"result": 0}, p.get("tid"), p.get("bid")))

    async def on_request(self, gw: str, p: dict) -> None:
        method = p.get("method", "")
        data = p.get("data")

        if method == "config":
            try:
                validate_config_request(data)
                reply_data = build_product_config(
                    ntp_server_host="pool.ntp.org",
                    ntp_server_port=123,
                    app_id=settings.dji_app_id,
                    app_key=settings.dji_app_key,
                    app_license=settings.dji_app_license,
                )
            except DjiConfigContractError as exc:
                log.warning("Ungueltiger config-Request von %s: %s", gw, exc)
                reply_data = {"result": -1, "output": "invalid config request"}

        elif method == "storage_config_get":
            try:
                validate_storage_config_request(data)
                credentials = await asyncio.to_thread(assume_role, STS_DURATION_SECONDS)
                storage = build_sts_response(
                    credentials,
                    bucket=settings.minio_bucket,
                    endpoint=settings.minio_public_endpoint,
                    object_key_prefix=settings.workspace_id,
                    provider="minio",
                    region="us-east-1",
                )
                reply_data = {"result": 0, "output": storage}
            except DjiStorageContractError as exc:
                log.warning("Ungueltiger storage_config_get von %s: %s", gw, exc)
                reply_data = {"result": -1, "output": "invalid storage request"}
            except Exception:
                log.exception("STS fuer storage_config_get von %s fehlgeschlagen", gw)
                reply_data = {"result": -1, "output": "storage credentials unavailable"}

        else:
            log.warning("Unbehandelte Request-Methode %s von %s", method, gw)
            reply_data = {"result": -1, "output": "unsupported request method"}

        await self.publish(
            requests_reply_topic(gw),
            envelope(method, reply_data, p.get("tid"), p.get("bid")),
        )

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
