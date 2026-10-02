from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..db import get_session
from ..dji.media_contract import (
    DjiMediaContractError,
    validate_fast_upload_request,
    validate_group_upload_callback,
    validate_tiny_fingerprint_request,
    validate_upload_callback_request,
)
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
async def tiny_fingerprints(workspace_id: str, body: dict = Body(default_factory=dict),
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
        validate_upload_callback_request(body)
    except DjiMediaContractError as exc:
        return fail(400, f"Ungueltiger Media-Upload-Callback: {exc}")

    ext = body["ext"]
    fp = body["fingerprint"]
    if not await s.scalar(select(MediaFile.id).where(MediaFile.fingerprint == fp)):
        mf = MediaFile(fingerprint=fp,
                       tiny_fingerprint=ext.get("tinny_fingerprint") or ext.get("tiny_fingerprint"),
                       name=body["name"], path=body.get("path"),
                       object_key=body["object_key"], drone_sn=ext["sn"],
                       drone_model_key=ext["drone_model_key"],
                       payload_model_key=ext["payload_model_key"],
                       is_original=ext["is_original"])
        s.add(mf)
        await s.commit()
        await hub.broadcast("file_uploaded", {"name": mf.name, "sn": mf.drone_sn})
    return ok(body["object_key"])


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
    rows = (await s.scalars(select(MediaFile).order_by(MediaFile.created.desc()).limit(limit))).all()
    out = []
    for m in rows:
        url = await run_in_threadpool(presign_get, m.object_key)
        out.append({"id": m.id, "name": m.name, "sn": m.drone_sn, "payload": m.payload_model_key,
                    "created": m.created.isoformat(), "url": url})
    return ok(out)
