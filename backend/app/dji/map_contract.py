"""Validation helpers for current DJI Cloud API map contracts."""
from __future__ import annotations

import math
import re
import uuid
from typing import Any

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


def validate_identifier(value: Any, field: str = "id", max_length: int = 64) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise DjiMapContractError(
            f"{field} must be a non-empty string up to {max_length} chars"
        )
    if any(ord(ch) < 32 for ch in value):
        raise DjiMapContractError(f"{field} contains control characters")
    return value


def validate_uuid(value: Any, field: str = "id") -> str:
    """Strict UUID helper retained for server-owned workspace identifiers."""
    value = validate_identifier(value, field, 64)
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
        raise DjiMapContractError(
            "position must contain longitude/latitude and optional altitude"
        )
    lon = _number(value[0])
    lat = _number(value[1])
    if not -180.0 <= lon <= 180.0:
        raise DjiMapContractError("longitude out of range")
    if not -90.0 <= lat <= 90.0:
        raise DjiMapContractError("latitude out of range")
    if len(value) == 3:
        _number(value[2])


def _validate_coordinates(geometry_type: str | None, coordinates: Any) -> None:
    if geometry_type in ("Point", "Circle"):
        _validate_position(coordinates)
        return
    if geometry_type == "LineString":
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise DjiMapContractError("LineString requires at least two positions")
        for position in coordinates:
            _validate_position(position, allow_altitude=False)
        return
    if geometry_type == "Polygon":
        if not isinstance(coordinates, list) or not coordinates:
            raise DjiMapContractError("Polygon requires at least one coordinate ring")
        for ring in coordinates:
            if not isinstance(ring, list) or len(ring) < 3:
                raise DjiMapContractError(
                    "Polygon ring requires at least three positions"
                )
            for position in ring:
                _validate_position(position, allow_altitude=False)
        return

    # DJI's schema leaves geometry.type open. Unknown/new geometry types are
    # retained for forward compatibility, but coordinates still must be arrays.
    if not isinstance(coordinates, list):
        raise DjiMapContractError("geometry.coordinates must be an array")


def validate_content(content: Any, resource_type: int | None = None) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise DjiMapContractError("content must be an object")

    feature_type = content.get("type")
    if feature_type is not None and not isinstance(feature_type, str):
        raise DjiMapContractError("content.type must be a string when present")

    properties = content.get("properties")
    if properties is not None:
        if not isinstance(properties, dict):
            raise DjiMapContractError("content.properties must be an object")
        color = properties.get("color")
        if color is not None and (
            not isinstance(color, str) or not _COLOR_RE.fullmatch(color)
        ):
            raise DjiMapContractError("properties.color must be #RRGGBB")
        for field in ("clampToGround", "is3d"):
            if field in properties and not isinstance(properties[field], bool):
                raise DjiMapContractError(f"properties.{field} must be boolean")

    geometry = content.get("geometry")
    if geometry is not None:
        if not isinstance(geometry, dict):
            raise DjiMapContractError("content.geometry must be an object")
        geometry_type = geometry.get("type")
        if geometry_type is not None and not isinstance(geometry_type, str):
            raise DjiMapContractError("geometry.type must be a string")
        if "coordinates" in geometry:
            _validate_coordinates(geometry_type, geometry["coordinates"])
        if geometry_type == "Circle" and "radius" in geometry:
            radius = _number(geometry["radius"])
            if radius <= 0:
                raise DjiMapContractError("circle radius must be positive")

    return content


def validate_resource(resource: Any) -> dict[str, Any]:
    if not isinstance(resource, dict):
        raise DjiMapContractError("resource must be an object")

    resource_type = resource.get("type")
    if resource_type is not None and (
        isinstance(resource_type, bool)
        or resource_type not in (
            RESOURCE_POINT,
            RESOURCE_LINE_STRING,
            RESOURCE_POLYGON,
        )
    ):
        raise DjiMapContractError("resource.type must be 0, 1 or 2 when present")

    username = resource.get("user_name")
    if username is not None and not isinstance(username, str):
        raise DjiMapContractError("resource.user_name must be a string")

    content = resource.get("content")
    if content is not None:
        validate_content(content, resource_type)
    return resource


def validate_create_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMapContractError("request body must be an object")
    validate_identifier(body.get("id"), "id", 64)

    name = body.get("name")
    if not isinstance(name, str) or len(name) > 256:
        raise DjiMapContractError("name must be a string up to 256 chars")
    if any(ord(ch) < 32 for ch in name):
        raise DjiMapContractError("name contains control characters")

    validate_resource(body.get("resource"))
    return body


def validate_update_request(
    body: Any,
    resource_type: int | None,
) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMapContractError("request body must be an object")

    if "name" in body:
        name = body["name"]
        if not isinstance(name, str) or len(name) > 256:
            raise DjiMapContractError("name must be a string up to 256 chars")
        if any(ord(ch) < 32 for ch in name):
            raise DjiMapContractError("name contains control characters")

    if "content" in body:
        validate_content(body["content"], resource_type)

    return body
