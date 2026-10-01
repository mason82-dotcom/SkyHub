import re
import zipfile
from io import BytesIO

from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..config import settings
from ..db import get_session
from ..models import Wayline, utcnow
from ..s3util import internal_s3, presign_get
from .auth import require_user

router = APIRouter()
P = "/wayline/api/v1/workspaces/{workspace_id}"
TEMPLATE_TYPES = {"waypoint": 0, "mapping2d": 1, "mapping3d": 2, "mappingStrip": 4}


def wl_dict(w: Wayline) -> dict:
    return {"id": w.id, "name": w.name, "drone_model_key": w.drone_model_key,
            "payload_model_keys": w.payload_model_keys, "template_types": w.template_types,
            "favorited": w.favorited, "user_name": w.user_name, "object_key": w.object_key,
            "update_time": int(w.updated.timestamp() * 1000)}


@router.get(P + "/waylines")
async def list_waylines(workspace_id: str, page: int = 1, page_size: int = 10,
                        favorited: bool | None = None, user: str = Depends(require_user),
                        s: AsyncSession = Depends(get_session)):
    q = select(Wayline)
    if favorited is not None:
        q = q.where(Wayline.favorited == favorited)
    total = await s.scalar(select(func.count()).select_from(q.subquery()))
    rows = (await s.scalars(q.order_by(Wayline.updated.desc())
                            .offset((page - 1) * page_size).limit(page_size))).all()
    return ok({"list": [wl_dict(w) for w in rows],
               "pagination": {"page": page, "page_size": page_size, "total": total}})


@router.get(P + "/waylines/duplicate-names")
async def duplicate_names(workspace_id: str, name: list[str] = Query(default=[]),
                          user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    rows = await s.scalars(select(Wayline.name).where(Wayline.name.in_(name)))
    return ok(list(rows))


@router.get(P + "/waylines/{wayline_id}/url")
async def wayline_url(workspace_id: str, wayline_id: str, user: str = Depends(require_user),
                      s: AsyncSession = Depends(get_session)):
    w = await s.get(Wayline, wayline_id)
    if w is None:
        return fail(404, "Route nicht gefunden")
    return RedirectResponse(await run_in_threadpool(presign_get, w.object_key), status_code=302)


@router.post(P + "/upload-callback")
async def upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                          user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    meta = body.get("metadata") or {}
    w = Wayline(name=body.get("name", "Route"), object_key=body.get("object_key", ""),
                drone_model_key=meta.get("drone_model_key", ""),
                payload_model_keys=meta.get("payload_model_keys") or [],
                template_types=meta.get("template_types") or [], user_name=user)
    s.add(w)
    await s.commit()
    return ok()


@router.post(P + "/favorites")
async def add_fav(workspace_id: str, id: list[str] = Query(default=[]),
                  user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    await s.execute(update(Wayline).where(Wayline.id.in_(id)).values(favorited=True))
    await s.commit()
    return ok()


@router.delete(P + "/favorites")
async def del_fav(workspace_id: str, id: list[str] = Query(default=[]),
                  user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    await s.execute(update(Wayline).where(Wayline.id.in_(id)).values(favorited=False))
    await s.commit()
    return ok()


@router.delete(P + "/waylines/{wayline_id}")
async def delete_wayline(workspace_id: str, wayline_id: str, user: str = Depends(require_user),
                         s: AsyncSession = Depends(get_session)):
    await s.execute(delete(Wayline).where(Wayline.id == wayline_id))
    await s.commit()
    return ok()


# ---------------- Web-UI: KMZ hochladen ----------------
def parse_kmz(data: bytes) -> dict:
    """Liest droneInfo/payloadInfo/templateType aus wpmz/template.kml."""
    with zipfile.ZipFile(BytesIO(data)) as z:
        name = next((n for n in z.namelist() if n.endswith("template.kml")), None)
        kml = z.read(name).decode("utf-8", "replace") if name else ""

    def tag(t: str) -> str | None:
        m = re.search(rf"<wpml:{t}>\s*([^<]+?)\s*</wpml:{t}>", kml)
        return m.group(1) if m else None

    drone, sub = tag("droneEnumValue"), tag("droneSubEnumValue") or "0"
    payload, psub = tag("payloadEnumValue"), tag("payloadSubEnumValue") or "0"
    ttype = tag("templateType")
    return {"drone_model_key": f"0-{drone}-{sub}" if drone else "",
            "payload_model_keys": [f"1-{payload}-{psub}"] if payload else [],
            "template_types": [TEMPLATE_TYPES.get(ttype, 0)] if ttype else [0]}


@router.post("/api/v1/waylines/upload")
async def upload_kmz(file: UploadFile = File(...), user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    data = await file.read()
    try:
        meta = parse_kmz(data)
    except zipfile.BadZipFile:
        return fail(400, "Keine gueltige KMZ-Datei")
    name = (file.filename or "Route").removesuffix(".kmz")
    key = f"{settings.workspace_id}/wayline/{name}.kmz"
    await run_in_threadpool(internal_s3().put_object, Bucket=settings.minio_bucket,
                            Key=key, Body=data, ContentType="application/vnd.google-earth.kmz")
    w = Wayline(name=name, object_key=key, user_name=user, updated=utcnow(), **meta)
    s.add(w)
    await s.commit()
    return ok(wl_dict(w))
