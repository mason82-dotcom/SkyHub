from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..config import settings
from ..db import get_session
from ..dji.wpml import MAX_KMZ_INPUT_BYTES, WpmlError, read_wpml_kmz
from ..models import Wayline, utcnow
from ..s3util import internal_s3, presign_get
from .auth import require_user, require_workspace_user

router = APIRouter()
P = "/wayline/api/v1/workspaces/{workspace_id}"

def wl_dict(w: Wayline) -> dict:
    return {"id": w.id, "name": w.name, "drone_model_key": w.drone_model_key,
            "payload_model_keys": w.payload_model_keys, "template_types": w.template_types,
            "favorited": w.favorited, "user_name": w.user_name, "object_key": w.object_key,
            "update_time": int(w.updated.timestamp() * 1000)}


@router.get(P + "/waylines")
async def list_waylines(workspace_id: str, page: int = 1, page_size: int = 10,
                        favorited: bool | None = None, user: str = Depends(require_workspace_user),
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
                          user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    rows = await s.scalars(select(Wayline.name).where(Wayline.name.in_(name)))
    return ok(list(rows))


@router.get(P + "/waylines/{wayline_id}/url")
async def wayline_url(workspace_id: str, wayline_id: str, user: str = Depends(require_workspace_user),
                      s: AsyncSession = Depends(get_session)):
    w = await s.get(Wayline, wayline_id)
    if w is None:
        return fail(404, "Route nicht gefunden")
    return RedirectResponse(await run_in_threadpool(presign_get, w.object_key), status_code=302)


@router.post(P + "/upload-callback")
async def upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                          user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
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
                  user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    await s.execute(update(Wayline).where(Wayline.id.in_(id)).values(favorited=True))
    await s.commit()
    return ok()


@router.delete(P + "/favorites")
async def del_fav(workspace_id: str, id: list[str] = Query(default=[]),
                  user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    await s.execute(update(Wayline).where(Wayline.id.in_(id)).values(favorited=False))
    await s.commit()
    return ok()


@router.delete(P + "/waylines/{wayline_id}")
async def delete_wayline(workspace_id: str, wayline_id: str, user: str = Depends(require_workspace_user),
                         s: AsyncSession = Depends(get_session)):
    await s.execute(delete(Wayline).where(Wayline.id == wayline_id))
    await s.commit()
    return ok()


# ---------------- Web-UI: KMZ hochladen ----------------
def parse_kmz(data: bytes) -> dict:
    """Parse and validate a DJI WPML KMZ using the FH-Clone-derived contract."""
    return read_wpml_kmz(data)["metadata"]


@router.post("/api/v1/waylines/upload")
async def upload_kmz(file: UploadFile = File(...), user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    data = await file.read(MAX_KMZ_INPUT_BYTES + 1)
    if len(data) > MAX_KMZ_INPUT_BYTES:
        return fail(413, "KMZ-Datei ist zu gross")
    try:
        meta = parse_kmz(data)
    except WpmlError as exc:
        return fail(400, f"Ungueltige WPML/KMZ-Datei: {exc}")
    name = (file.filename or "Route").removesuffix(".kmz")
    key = f"{settings.workspace_id}/wayline/{name}.kmz"
    await run_in_threadpool(internal_s3().put_object, Bucket=settings.minio_bucket,
                            Key=key, Body=data, ContentType="application/vnd.google-earth.kmz")
    w = Wayline(name=name, object_key=key, user_name=user, updated=utcnow(), **meta)
    s.add(w)
    await s.commit()
    return ok(wl_dict(w))
