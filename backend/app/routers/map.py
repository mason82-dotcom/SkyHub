import time

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common import fail, ok
from ..db import get_session
from ..models import MapElement, utcnow
from ..state import hub
from .auth import require_user

router = APIRouter()
P = "/map/api/v1/workspaces/{workspace_id}"
SHARED_GROUP = "shared-layer"


def el_dict(e: MapElement) -> dict:
    return {"id": e.id, "name": e.name, "resource": e.resource,
            "create_time": int(e.created.timestamp() * 1000),
            "update_time": int(e.updated.timestamp() * 1000)}


@router.get(P + "/element-groups")
async def element_groups(workspace_id: str, user: str = Depends(require_user),
                         s: AsyncSession = Depends(get_session)):
    rows = (await s.scalars(select(MapElement).where(MapElement.group_id == SHARED_GROUP))).all()
    # type 2 = mit App geteilte Ebene (gegen Doku v1.14 pruefen)
    return ok([{"id": SHARED_GROUP, "name": "Gemeinsame Ebene", "type": 2, "is_lock": False,
                "create_time": int(time.time() * 1000), "elements": [el_dict(e) for e in rows]}])


@router.post(P + "/element-groups/{group_id}/elements")
async def create_element(workspace_id: str, group_id: str, body: dict = Body(default_factory=dict),
                         user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    e = MapElement(id=body.get("id"), group_id=group_id, name=body.get("name", ""),
                   resource=body.get("resource") or {})
    s.add(e)
    await s.commit()
    await hub.broadcast("map_element_create", {**el_dict(e), "group_id": group_id})
    return ok({"id": e.id})


@router.put(P + "/elements/{element_id}")
async def update_element(workspace_id: str, element_id: str, body: dict = Body(default_factory=dict),
                         user: str = Depends(require_user), s: AsyncSession = Depends(get_session)):
    e = await s.get(MapElement, element_id)
    if e is None:
        return fail(404, "Element nicht gefunden")
    e.name = body.get("name", e.name)
    if "content" in body:
        e.resource = {**e.resource, "content": body["content"]}
    e.updated = utcnow()
    await s.commit()
    await hub.broadcast("map_element_update", {**el_dict(e), "group_id": e.group_id})
    return ok()


@router.delete(P + "/elements/{element_id}")
async def delete_element(workspace_id: str, element_id: str, user: str = Depends(require_user),
                         s: AsyncSession = Depends(get_session)):
    e = await s.get(MapElement, element_id)
    if e:
        await s.delete(e)
        await s.commit()
        await hub.broadcast("map_element_delete", {"id": element_id, "group_id": e.group_id})
    return ok()
