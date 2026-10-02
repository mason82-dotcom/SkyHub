from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..db import get_session
from ..dji.media_contract import (
    DjiMediaContractError,
    validate_fast_upload_request,
    media_storage_identity,
    validate_group_upload_callback,
    validate_tiny_fingerprint_request,
    validate_upload_callback_request,
)
from ..dji.storage_contract import DjiStorageContractError, validate_workspace_object_key
from ..models import MediaFile
from ..s3util import presign_get
from ..state import hub
from .auth import require_user, require_workspace_user

router = APIRouter()
P = "/media/api/v1/workspaces/{workspace_id}"


@router.post(P + "/fast-upload")
async def fast_upload(workspace_id: str, body: dict = Body(default_factory=dict),
                      user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        validate_fast_upload_request(body)
    except DjiMediaContractError as exc:
        return fail(400, f"Ungueltiger Media-Fast-Upload: {exc}")
    exists = await s.scalar(select(MediaFile.id).where(MediaFile.fingerprint == body["fingerprint"]))
    # code != 0 -> Pilot laedt die Datei hoch
    return ok() if exists else fail(-1, "Datei nicht vorhanden")


@router.post(P + "/files/tiny-fingerprints")
async def tiny_fingerprints(workspace_id: str, body: Any = Body(default_factory=list),
                            user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        tfs = validate_tiny_fingerprint_request(body)
    except DjiMediaContractError as exc:
        return fail(400, f"Ungueltige Tiny-Fingerprint-Anfrage: {exc}")
    rows = await s.scalars(select(MediaFile.tiny_fingerprint).where(MediaFile.tiny_fingerprint.in_(tfs)))
    return ok({"tiny_fingerprints": [r for r in rows if r]})


@router.post(P + "/upload-callback")
async def upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                          user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        parsed = validate_upload_callback_request(body)
        validate_workspace_object_key(parsed["object_key"], workspace_id)
    except (DjiMediaContractError, DjiStorageContractError) as exc:
        return fail(400, f"Ungueltiger Media-Upload-Callback: {exc}")

    # result != 0 reports that Pilot failed to upload the file. Acknowledge the
    # callback, but do not create a database record for an object that is absent.
    if parsed["result"] != 0:
        return ok({"object_key": parsed["object_key"]})

    ext = parsed["ext"]
    storage_identity = media_storage_identity(parsed)
    if not await s.scalar(
        select(MediaFile.id).where(MediaFile.fingerprint == storage_identity)
    ):
        mf = MediaFile(
            fingerprint=storage_identity,
            tiny_fingerprint=ext.get("tinny_fingerprint") or ext.get("tiny_fingerprint"),
            name=parsed["name"],
            path=parsed.get("path"),
            object_key=parsed["object_key"],
            drone_sn=ext.get("sn"),
            drone_model_key=ext.get("drone_model_key"),
            payload_model_key=ext.get("payload_model_key"),
            is_original=ext.get("is_original", True),
        )
        s.add(mf)
        await s.commit()
        await hub.broadcast("file_uploaded", {"name": mf.name, "sn": mf.drone_sn})
    return ok({"object_key": parsed["object_key"]})


@router.post(P + "/group-upload-callback")
async def group_upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                                user: str = Depends(require_workspace_user)):
    try:
        validate_group_upload_callback(body)
    except DjiMediaContractError as exc:
        return fail(400, f"Ungueltiger Group-Upload-Callback: {exc}")
    return ok()


# ---------------- Web-UI ----------------
@router.get("/api/v1/media")
async def list_media(limit: int = 100, user: str = Depends(require_user),
                     s: AsyncSession = Depends(get_session)):
    if limit < 1 or limit > 500:
        return fail(400, "limit muss zwischen 1 und 500 liegen")
    rows = (await s.scalars(select(MediaFile).order_by(MediaFile.created.desc()).limit(limit))).all()
    out = []
    for m in rows:
        url = await run_in_threadpool(presign_get, m.object_key)
        out.append({"id": m.id, "name": m.name, "sn": m.drone_sn, "payload": m.payload_model_key,
                    "created": m.created.isoformat(), "url": url})
    return ok(out)
