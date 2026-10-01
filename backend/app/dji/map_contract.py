"""Validation helpers for DJI Cloud API map contracts.

The field shapes are independently implemented from the public DJI Demo
contract. Extra fields are retained by callers; only required structural
constraints are validated here.
"""
from __future__ import annotations

import math
import re
import uuid
from typing import Any

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

RESOURCE_POINT = 0
RESOURCE_LINE_STRING = 1
RESOURCE_POLYGON = 2
SHARED_GROUP_TYPE = 2


class DjiMapContractError(ValueError):
    pass


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DjiMapContractError("coordinate must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise DjiMapContractError("coordinate must be finite")
    return result


def validate_uuid(value: Any, field: str = "id") -> str:
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise DjiMapContractError(f"{field} must be a lowercase UUID")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise DjiMapContractError(f"{field} must be a valid UUID") from exc
    if str(parsed) != value:
        raise DjiMapContractError(f"{field} must use canonical UUID form")
    return value


def shared_group_id(workspace_id: str) -> str:
    """Return a stable UUID group id for SkyHub's one shared Pilot layer."""
    validate_uuid(workspace_id, "workspace_id")
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"skyhub:{workspace_id}:map:shared"))


def _validate_position(value: Any, *, allow_altitude: bool = True) -> None:
    if not isinstance(value, list):
        raise DjiMapContractError("position coordinates must be an array")
    allowed_lengths = (2, 3) if allow_altitude else (2,)
    if len(value) not in allowed_lengths:
        raise DjiMapContractError("position must contain longitude/latitude and optional altitude")
    lon = _number(value[0])
    lat = _number(value[1])
    if not -180.0 <= lon <= 180.0:
        raise DjiMapContractError("longitude out of range")
    if not -90.0 <= lat <= 90.0:
        raise DjiMapContractError("latitude out of range")
    if len(value) == 3:
        _number(value[2])


def validate_content(content: Any, resource_type: int) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise DjiMapContractError("content must be an object")
    if content.get("type") != "Feature":
        raise DjiMapContractError("content.type must be Feature")

    properties = content.get("properties")
    if not isinstance(properties, dict):
        raise DjiMapContractError("content.properties must be an object")
    color = properties.get("color")
    if not isinstance(color, str) or not _COLOR_RE.fullmatch(color):
        raise DjiMapContractError("properties.color must be #RRGGBB")
    if "clampToGround" in properties and not isinstance(properties["clampToGround"], bool):
        raise DjiMapContractError("properties.clampToGround must be boolean")

    geometry = content.get("geometry")
    if not isinstance(geometry, dict):
        raise DjiMapContractError("content.geometry must be an object")
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if resource_type == RESOURCE_POINT:
        if geometry_type not in ("Point", "Circle"):
            raise DjiMapContractError("point resource requires Point/Circle geometry")
        _validate_position(coordinates)
        if geometry_type == "Circle":
            radius = _number(geometry.get("radius"))
            if radius <= 0:
                raise DjiMapContractError("circle radius must be positive")
    elif resource_type == RESOURCE_LINE_STRING:
        if geometry_type != "LineString":
            raise DjiMapContractError("line resource requires LineString geometry")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise DjiMapContractError("LineString requires at least two positions")
        for position in coordinates:
            _validate_position(position, allow_altitude=False)
    elif resource_type == RESOURCE_POLYGON:
        if geometry_type != "Polygon":
            raise DjiMapContractError("polygon resource requires Polygon geometry")
        if not isinstance(coordinates, list) or len(coordinates) != 1:
            raise DjiMapContractError("Polygon requires exactly one coordinate ring")
        ring = coordinates[0]
        if not isinstance(ring, list) or len(ring) < 3:
            raise DjiMapContractError("Polygon ring requires at least three positions")
        for position in ring:
            _validate_position(position, allow_altitude=False)
    else:
        raise DjiMapContractError("resource.type must be 0, 1 or 2")

    return content


def validate_resource(resource: Any) -> dict[str, Any]:
    if not isinstance(resource, dict):
        raise DjiMapContractError("resource must be an object")
    resource_type = resource.get("type")
    if isinstance(resource_type, bool) or resource_type not in (
        RESOURCE_POINT,
        RESOURCE_LINE_STRING,
        RESOURCE_POLYGON,
    ):
        raise DjiMapContractError("resource.type must be 0, 1 or 2")
    username = resource.get("user_name")
    if username is not None and not isinstance(username, str):
        raise DjiMapContractError("resource.user_name must be a string")
    validate_content(resource.get("content"), resource_type)
    return resource


def validate_create_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMapContractError("request body must be an object")
    validate_uuid(body.get("id"), "id")
    if not isinstance(body.get("name"), str):
        raise DjiMapContractError("name must be a string")
    validate_resource(body.get("resource"))
    return body


def validate_update_request(body: Any, resource_type: int) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMapContractError("request body must be an object")
    if not isinstance(body.get("name"), str):
        raise DjiMapContractError("name must be a string")
    validate_content(body.get("content"), resource_type)
    return body
