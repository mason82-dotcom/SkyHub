from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..config import settings
from ..db import get_session
from ..dji.storage_contract import DjiStorageContractError, validate_workspace_object_key
from ..dji.wayline_contract import (
    DjiWaylineContractError,
    fallback_wayline_name,
    filter_wayline_items,
    validate_list_query,
    validate_upload_callback,
)
from ..dji.wpml import MAX_KMZ_INPUT_BYTES, WpmlError, read_wpml_kmz
from ..models import Wayline, new_id, utcnow
from ..s3util import internal_s3, presign_get
from .auth import require_user, require_workspace_user

router = APIRouter()
P = "/wayline/api/v1/workspaces/{workspace_id}"

def wl_dict(w: Wayline) -> dict:
    return {
        "id": w.id,
        "name": w.name,
        "drone_model_key": w.drone_model_key,
        "payload_model_keys": w.payload_model_keys,
        "template_types": w.template_types,
        "favorited": w.favorited,
        "user_name": w.user_name,
        "action_type": 0,
        "update_time": int(w.updated.timestamp() * 1000),
    }


@router.get(P + "/waylines")
async def list_waylines(
    workspace_id: str,
    page: int = 1,
    page_size: int = 10,
    favorited: bool | None = None,
    order_by: str | None = None,
    template_type: list[int] = Query(default=[]),
    action_type: int | None = None,
    drone_model_keys: list[str] = Query(default=[]),
    payload_model_key: list[str] = Query(default=[]),
    user: str = Depends(require_workspace_user),
    s: AsyncSession = Depends(get_session),
):
    try:
        order = validate_list_query(
            page=page,
            page_size=page_size,
            order_by=order_by,
            template_type=template_type,
            action_type=action_type,
            drone_model_keys=drone_model_keys,
            payload_model_key=payload_model_key,
        )
    except DjiWaylineContractError as exc:
        return fail(400, f"Ungueltige Wayline-Anfrage: {exc}")

    rows = (await s.scalars(select(Wayline))).all()
    items = filter_wayline_items(
        [wl_dict(w) for w in rows],
        favorited=favorited,
        template_type=template_type,
        action_type=action_type,
        drone_model_keys=drone_model_keys,
        payload_model_key=payload_model_key,
        order_by=order,
    )
    total = len(items)
    start = (page - 1) * page_size
    return ok({
        "list": items[start:start + page_size],
        "pagination": {"page": page, "page_size": page_size, "total": total},
    })


@router.get(P + "/waylines/duplicate-names")
async def duplicate_names(workspace_id: str, name: list[str] = Query(default=[]),
                          user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    if len(name) > 100 or any(len(value) > 256 for value in name):
        return fail(400, "Zu viele oder zu lange Routennamen")
    rows = await s.scalars(select(Wayline.name).where(Wayline.name.in_(name)))
    return ok(list(rows))


@router.get(P + "/waylines/{wayline_id}/url")
async def wayline_url(workspace_id: str, wayline_id: str, user: str = Depends(require_workspace_user),
                      s: AsyncSession = Depends(get_session)):
    w = await s.get(Wayline, wayline_id)
    if w is None:
        return fail(404, "Route nicht gefunden")
    try:
        validate_workspace_object_key(w.object_key, workspace_id)
    except DjiStorageContractError:
        return fail(404, "Route nicht gefunden")
    return RedirectResponse(await run_in_threadpool(presign_get, w.object_key), status_code=302)


@router.post(P + "/upload-callback")
async def upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                          user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        parsed = validate_upload_callback(body)
        validate_workspace_object_key(parsed["object_key"], workspace_id)
    except (DjiWaylineContractError, DjiStorageContractError) as exc:
        return fail(400, f"Ungueltiger Wayline-Upload-Callback: {exc}")

    meta = parsed["metadata"]
    name = parsed["name"] or fallback_wayline_name(parsed["object_key"])
    w = Wayline(
        name=name,
        object_key=parsed["object_key"],
        drone_model_key=meta["drone_model_key"],
        payload_model_keys=meta["payload_model_keys"],
        template_types=meta["template_types"],
        user_name=user,
    )
    s.add(w)
    await s.commit()
    return ok()


@router.post(P + "/favorites")
async def add_fav(workspace_id: str, id: list[str] = Query(default=[]),
                  user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    if len(id) > 100 or any(len(value) > 64 for value in id):
        return fail(400, "Zu viele oder ungueltige Routen-IDs")
    await s.execute(update(Wayline).where(Wayline.id.in_(id)).values(favorited=True))
    await s.commit()
    return ok({"id": id})


@router.delete(P + "/favorites")
async def del_fav(workspace_id: str, id: list[str] = Query(default=[]),
                  user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    if len(id) > 100 or any(len(value) > 64 for value in id):
        return fail(400, "Zu viele oder ungueltige Routen-IDs")
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
    raw_name = (file.filename or "Route.kmz").replace("\\", "/").rsplit("/", 1)[-1]
    name = raw_name.removesuffix(".kmz").strip() or "Route"
    if len(name) > 256 or any(ord(ch) < 32 for ch in name):
        return fail(400, "Ungueltiger Routenname")
    key = f"{settings.workspace_id}/wayline/{new_id()}.kmz"
    await run_in_threadpool(internal_s3().put_object, Bucket=settings.minio_bucket,
                            Key=key, Body=data, ContentType="application/vnd.google-earth.kmz")
    w = Wayline(name=name, object_key=key, user_name=user, updated=utcnow(), **meta)
    s.add(w)
    await s.commit()
    return ok(wl_dict(w))
