from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..common import fail, ok
from ..db import get_session
from ..models import MediaFile, new_id
from ..s3util import presign_get
from ..state import hub
from .auth import require_user

router = APIRouter()
P = "/media/api/v1/workspaces/{workspace_id}"


@router.post(P + "/fast-upload")
async def fast_upload(workspace_id: str, body: dict = Body(default_factory=dict),
                      user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    exists = await s.scalar(select(MediaFile.id).where(MediaFile.fingerprint == body.get("fingerprint")))
    # code != 0 -> Pilot laedt die Datei hoch
    return ok() if exists else fail(-1, "Datei nicht vorhanden")


@router.post(P + "/files/tiny-fingerprints")
async def tiny_fingerprints(workspace_id: str, body: dict = Body(default_factory=dict),
                            user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    tfs = body.get("tiny_fingerprints") or []
    rows = await s.scalars(select(MediaFile.tiny_fingerprint).where(MediaFile.tiny_fingerprint.in_(tfs)))
    return ok({"tiny_fingerprints": [r for r in rows if r]})


@router.post(P + "/upload-callback")
async def upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                          user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    ext = body.get("ext") or {}
    fp = body.get("fingerprint") or new_id()
    if not await s.scalar(select(MediaFile.id).where(MediaFile.fingerprint == fp)):
        mf = MediaFile(fingerprint=fp,
                       tiny_fingerprint=ext.get("tinny_fingerprint") or ext.get("tiny_fingerprint"),
                       name=body.get("name", ""), path=body.get("path"),
                       object_key=body.get("object_key", ""), drone_sn=ext.get("sn"),
                       drone_model_key=ext.get("drone_model_key"),
                       payload_model_key=ext.get("payload_model_key"),
                       is_original=bool(ext.get("is_original", True)))
        s.add(mf)
        await s.commit()
        await hub.broadcast("file_uploaded", {"name": mf.name, "sn": mf.drone_sn})
    return ok(body.get("object_key"))


@router.post(P + "/group-upload-callback")
async def group_upload_callback(workspace_id: str, body: dict = Body(default_factory=dict),
                                user: str = Depends(require_user)):
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
