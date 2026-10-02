from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common import fail, ok
from ..db import get_session
from ..dji.map_contract import (
    DjiMapContractError,
    SHARED_GROUP_TYPE,
    shared_group_id,
    validate_create_request,
    validate_identifier,
    validate_update_request,
)
from ..models import MapElement, utcnow
from ..state import hub
from .auth import require_workspace_user

router = APIRouter()
P = "/map/api/v1/workspaces/{workspace_id}"


def el_dict(e: MapElement) -> dict:
    return {"id": e.id, "name": e.name, "resource": e.resource,
            "create_time": int(e.created.timestamp() * 1000),
            "update_time": int(e.updated.timestamp() * 1000)}


@router.get(P + "/element-groups")
async def element_groups(workspace_id: str, group_id: str | None = None,
                         is_distributed: bool | None = None,
                         user: str = Depends(require_workspace_user),
                         s: AsyncSession = Depends(get_session)):
    try:
        shared = shared_group_id(workspace_id)
        if group_id is not None:
            validate_identifier(group_id, "group_id", 64)
    except DjiMapContractError as exc:
        return fail(400, f"Ungueltige Map-Anfrage: {exc}")

    if group_id is not None and group_id != shared:
        return ok([])

    rows = (await s.scalars(select(MapElement).where(MapElement.group_id == shared))).all()
    # DJI GroupType 2 = one APP shared element group per workspace.
    return ok([{"id": shared, "name": "Gemeinsame Ebene", "type": SHARED_GROUP_TYPE,
                "is_lock": False, "elements": [el_dict(e) for e in rows]}])


@router.post(P + "/element-groups/{group_id}/elements")
async def create_element(workspace_id: str, group_id: str, body: dict = Body(default_factory=dict),
                         user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        shared = shared_group_id(workspace_id)
        validate_identifier(group_id, "group_id", 64)
        validate_create_request(body)
    except DjiMapContractError as exc:
        return fail(400, f"Ungueltiges Map-Element: {exc}")
    if group_id != shared:
        return fail(404, "Elementgruppe nicht gefunden")

    e = MapElement(id=body["id"], group_id=group_id, name=body["name"],
                   resource=body["resource"])
    s.add(e)
    await s.commit()
    await hub.broadcast("map_element_create", {**el_dict(e), "group_id": group_id})
    return ok({"id": e.id})


@router.put(P + "/elements/{element_id}")
async def update_element(workspace_id: str, element_id: str, body: dict = Body(default_factory=dict),
                         user: str = Depends(require_workspace_user), s: AsyncSession = Depends(get_session)):
    try:
        shared = shared_group_id(workspace_id)
        validate_identifier(element_id, "element_id", 64)
    except DjiMapContractError as exc:
        return fail(400, f"Ungueltige Map-Anfrage: {exc}")

    e = await s.get(MapElement, element_id)
    if e is None or e.group_id != shared:
        return fail(404, "Element nicht gefunden")
    resource_type = e.resource.get("type") if isinstance(e.resource, dict) else None
    try:
        validate_update_request(body, resource_type)
    except DjiMapContractError as exc:
        return fail(400, f"Ungueltiges Map-Element: {exc}")

    if "name" in body:
        e.name = body["name"]
    if "content" in body:
        e.resource = {**e.resource, "content": body["content"]}
    e.updated = utcnow()
    await s.commit()
    await hub.broadcast("map_element_update", {**el_dict(e), "group_id": e.group_id})
    return ok({"id": e.id})


@router.delete(P + "/elements/{element_id}")
async def delete_element(workspace_id: str, element_id: str, user: str = Depends(require_workspace_user),
                         s: AsyncSession = Depends(get_session)):
    try:
        shared = shared_group_id(workspace_id)
        validate_identifier(element_id, "element_id", 64)
    except DjiMapContractError as exc:
        return fail(400, f"Ungueltige Map-Anfrage: {exc}")

    e = await s.get(MapElement, element_id)
    if e and e.group_id == shared:
        await s.delete(e)
        await s.commit()
        await hub.broadcast("map_element_delete", {"id": element_id, "group_id": e.group_id})
    return ok({"id": element_id})
