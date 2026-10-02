"""DJI Pilot 2 Wayline HTTP contract helpers for Cloud API v1.16.1."""
from __future__ import annotations

import re
from typing import Any

_MODEL_KEY_RE = re.compile(r"^\d+-\d+-\d+$")
_ALLOWED_ORDER_BY = {
    "update_time asc",
    "update_time desc",
    "name asc",
    "name desc",
}


class DjiWaylineContractError(ValueError):
    pass


def _model_key(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _MODEL_KEY_RE.fullmatch(value):
        raise DjiWaylineContractError(f"{field} must be a DJI product key")
    return value


def validate_list_query(
    *,
    page: int,
    page_size: int,
    order_by: str | None,
    template_type: list[int],
    action_type: int | None,
    drone_model_keys: list[str],
    payload_model_key: list[str],
) -> str:
    if isinstance(page, bool) or not 1 <= page <= 10000:
        raise DjiWaylineContractError("page must be between 1 and 10000")
    if isinstance(page_size, bool) or not 1 <= page_size <= 100:
        raise DjiWaylineContractError("page_size must be between 1 and 100")
    if len(template_type) > 32 or any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in template_type
    ):
        raise DjiWaylineContractError("invalid template_type filter")
    if action_type is not None and (
        isinstance(action_type, bool) or action_type not in (0, 1)
    ):
        raise DjiWaylineContractError("action_type must be 0 or 1")
    if len(drone_model_keys) > 32:
        raise DjiWaylineContractError("too many drone_model_keys")
    if len(payload_model_key) > 32:
        raise DjiWaylineContractError("too many payload_model_key values")
    for value in drone_model_keys:
        _model_key(value, "drone_model_keys")
    for value in payload_model_key:
        _model_key(value, "payload_model_key")

    normalized_order = (order_by or "update_time desc").strip().lower()
    if normalized_order not in _ALLOWED_ORDER_BY:
        raise DjiWaylineContractError("unsupported order_by")
    return normalized_order


def filter_wayline_items(
    items: list[dict[str, Any]],
    *,
    favorited: bool | None,
    template_type: list[int],
    action_type: int | None,
    drone_model_keys: list[str],
    payload_model_key: list[str],
    order_by: str,
) -> list[dict[str, Any]]:
    result = items

    if favorited is not None:
        result = [item for item in result if item.get("favorited") is favorited]
    if template_type:
        wanted = set(template_type)
        result = [
            item for item in result
            if wanted.intersection(item.get("template_types") or [])
        ]
    if drone_model_keys:
        wanted = set(drone_model_keys)
        result = [item for item in result if item.get("drone_model_key") in wanted]
    if payload_model_key:
        wanted = set(payload_model_key)
        result = [
            item for item in result
            if wanted.intersection(item.get("payload_model_keys") or [])
        ]

    # SkyHub does not implement AI Spot-Check waylines yet. Existing files are
    # normal action_type=0 waylines; action_type=1 therefore returns no items.
    if action_type is not None:
        result = [item for item in result if item.get("action_type", 0) == action_type]

    field, direction = order_by.split(" ", 1)
    key_name = "update_time" if field == "update_time" else "name"
    return sorted(
        result,
        key=lambda item: (item.get(key_name) if item.get(key_name) is not None else "", item.get("id", "")),
        reverse=direction == "desc",
    )


def validate_upload_callback(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiWaylineContractError("request body must be an object")

    object_key = body.get("object_key")
    if not isinstance(object_key, str) or not object_key:
        raise DjiWaylineContractError("object_key is required")

    name = body.get("name")
    if name is not None:
        if not isinstance(name, str) or not name.strip() or len(name) > 256:
            raise DjiWaylineContractError("invalid wayline name")
        if any(ord(ch) < 32 for ch in name):
            raise DjiWaylineContractError("invalid control character in wayline name")
        name = name.strip()

    metadata = body.get("metadata")
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise DjiWaylineContractError("metadata must be an object")

    drone_model_key = metadata.get("drone_model_key", "")
    if drone_model_key:
        _model_key(drone_model_key, "drone_model_key")

    payload_model_keys = metadata.get("payload_model_keys") or []
    if not isinstance(payload_model_keys, list) or len(payload_model_keys) > 32:
        raise DjiWaylineContractError("payload_model_keys must be an array")
    for value in payload_model_keys:
        _model_key(value, "payload_model_keys")

    template_types = metadata.get("template_types") or []
    if not isinstance(template_types, list) or len(template_types) > 32:
        raise DjiWaylineContractError("template_types must be an array")
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value < 0
        for value in template_types
    ):
        raise DjiWaylineContractError("invalid template_types")

    return {
        "object_key": object_key,
        "name": name,
        "metadata": {
            "drone_model_key": drone_model_key,
            "payload_model_keys": payload_model_keys,
            "template_types": template_types,
        },
    }


def fallback_wayline_name(object_key: str) -> str:
    raw = object_key.replace("\\", "/").rsplit("/", 1)[-1]
    name = raw.removesuffix(".kmz").strip()
    if not name:
        return "Route"
    return name[:256]
