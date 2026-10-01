from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common import fail, ok
from ..config import settings
from ..db import get_session
from ..device_dict import DEFAULT_CAMERA, MODE_CODES, describe
from ..models import Device, TelemetryPoint, utcnow
from ..mqtt_bridge import bridge
from ..state import hub
from .auth import require_user

router = APIRouter()


def dev_dict(d: Device) -> dict:
    name, kind = describe(d.model_key)
    osd = hub.osd.get(d.sn, {})
    normalized = hub.normalized.get(d.sn, {})
    flight = normalized.get("flight") or {}
    mode = flight.get("mode") or {} if isinstance(flight, dict) else {}
    mode_code = mode.get("code") if isinstance(mode, dict) else None
    if mode_code is None:
        mode_code = osd.get("mode_code")
    return {"sn": d.sn, "model_key": d.model_key, "model": name, "kind": kind,
            "callsign": d.callsign, "gateway_sn": d.gateway_sn,
            "online": d.sn in hub.online, "last_seen": d.last_seen.isoformat(),
            "mode": MODE_CODES.get(mode_code, None), "osd": osd,
            "normalized": normalized}


@router.get("/api/v1/devices")
async def list_devices(user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    rows = (await s.scalars(select(Device).order_by(Device.domain, Device.sn))).all()
    return ok([dev_dict(d) for d in rows])


@router.get("/api/v1/devices/{sn}/rtk")
async def rtk_status(sn: str, user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    dev = await s.get(Device, sn)
    if dev is None:
        return fail(404, "Geraet nicht gefunden")
    normalized = hub.normalized.get(sn, {})
    navigation = normalized.get("navigation") or {}
    rtk = navigation.get("rtk") if isinstance(navigation, dict) else None
    return ok({"sn": sn, "rtk": rtk, "online": sn in hub.online})


@router.get("/api/v1/devices/{sn}/track")
async def track(sn: str, minutes: int = 60, user: str = Depends(require_user),
                s: AsyncSession = Depends(get_session)):
    since = utcnow() - timedelta(minutes=minutes)
    rows = (await s.scalars(select(TelemetryPoint).where(TelemetryPoint.sn == sn,
            TelemetryPoint.ts >= since).order_by(TelemetryPoint.ts))).all()
    return ok([[p.lat, p.lon, p.height, int(p.ts.timestamp())] for p in rows])


@router.get("/manage/api/v1/workspaces/{workspace_id}/devices/topologies")
async def topologies(workspace_id: str, user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    """Fuer das TSA-Modul in Pilot 2 (andere Teilnehmer auf der Karte)."""
    rows = {d.sn: d for d in (await s.scalars(select(Device))).all()}

    def node(d: Device) -> dict:
        return {"sn": d.sn, "device_callsign": d.callsign, "online_status": d.sn in hub.online,
                "device_model": {"domain": str(d.domain), "type": d.type,
                                 "sub_type": d.sub_type, "key": d.model_key},
                "icon_urls": {"normal_icon_url": "", "selected_icon_url": ""},
                "user_callsign": "", "user_id": "", "bound_status": True,
                "model": describe(d.model_key)[0]}

    out = []
    for gw, subs in hub.topo.items():
        if gw in rows:
            out.append({"hosts": [node(rows[x]) for x in subs if x in rows],
                        "parents": [node(rows[gw])]})
    return ok({"list": out})


class LiveReq(BaseModel):
    sn: str                    # Fluggeraet-SN
    camera: str | None = None  # payload_index, z.B. 89-0-0
    quality: int = 0           # 0 auto, 1 fluessig, 2 SD, 3 HD, 4 UHD


def _video_id(sn: str, camera: str) -> str:
    return f"{sn}/{camera}/normal-0"


async def _resolve(req: LiveReq, s: AsyncSession):
    dev = await s.get(Device, req.sn)
    gw = hub.gateway_of(req.sn) or (dev.gateway_sn if dev else None)
    cam = req.camera or (DEFAULT_CAMERA.get(dev.model_key) if dev else None)
    return gw, cam


@router.post("/api/v1/live/start")
async def live_start(req: LiveReq, user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    gw, cam = await _resolve(req, s)
    if not gw or not cam:
        return fail(404, "Fluggeraet nicht verbunden oder Kamera unbekannt")
    url = f"rtmp://{settings.public_host}:{settings.rtmp_port}/live/{req.sn}"
    try:
        r = await bridge.call_service(gw, "live_start_push", {
            "url_type": 1, "url": url, "video_id": _video_id(req.sn, cam),
            "video_quality": req.quality})
    except TimeoutError:
        return fail(504, "Keine Antwort von der Fernsteuerung")
    result = (r.get("data") or {}).get("result", -1)
    if result != 0:
        return fail(result, f"Pilot 2 meldet Fehler {result}")
    return ok({"player_url": f"http://{settings.public_host}:{settings.webrtc_port}/live/{req.sn}/"})


@router.post("/api/v1/live/stop")
async def live_stop(req: LiveReq, user: str = Depends(require_user),
                    s: AsyncSession = Depends(get_session)):
    gw, cam = await _resolve(req, s)
    if not gw or not cam:
        return fail(404, "Fluggeraet nicht verbunden")
    try:
        r = await bridge.call_service(gw, "live_stop_push", {"video_id": _video_id(req.sn, cam)})
    except TimeoutError:
        return fail(504, "Keine Antwort von der Fernsteuerung")
    return ok((r.get("data") or {}))
