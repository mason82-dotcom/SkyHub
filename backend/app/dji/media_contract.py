"""Validation helpers for DJI media HTTP contracts."""
from __future__ import annotations

import re
from typing import Any

from .protocol import validate_serial

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class DjiMediaContractError(ValueError):
    pass


def _required_string(obj: dict[str, Any], key: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or value == "":
        raise DjiMediaContractError(f"{key} must be a non-empty string")
    return value


def _required_bool(obj: dict[str, Any], key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise DjiMediaContractError(f"{key} must be boolean")
    return value


def _validate_fast_ext(ext: Any) -> dict[str, Any]:
    if not isinstance(ext, dict):
        raise DjiMediaContractError("ext must be an object")
    _required_string(ext, "drone_model_key")
    _required_string(ext, "payload_model_key")
    tiny = ext.get("tinny_fingerprint", ext.get("tiny_fingerprint"))
    if not isinstance(tiny, str) or tiny == "":
        raise DjiMediaContractError("tinny_fingerprint must be a non-empty string")
    validate_serial(_required_string(ext, "sn"))
    _required_bool(ext, "is_original")
    return ext


def validate_fast_upload_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    _validate_fast_ext(body.get("ext"))
    _required_string(body, "fingerprint")
    _required_string(body, "name")
    path = body.get("path")
    if path is not None and not isinstance(path, str):
        raise DjiMediaContractError("path must be a string or null")
    return body


def validate_tiny_fingerprint_request(body: Any) -> list[str]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    values = body.get("tiny_fingerprints")
    if not isinstance(values, list) or any(not isinstance(value, str) or value == "" for value in values):
        raise DjiMediaContractError("tiny_fingerprints must be a list of non-empty strings")
    return values


def validate_upload_callback_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    ext = _validate_fast_ext(body.get("ext"))
    file_group_id = ext.get("file_group_id")
    if not isinstance(file_group_id, str):
        raise DjiMediaContractError("file_group_id must be a string")
    if file_group_id and not _UUID_RE.fullmatch(file_group_id):
        raise DjiMediaContractError("file_group_id must be a lowercase UUID when present")

    _required_string(body, "fingerprint")
    _required_string(body, "name")
    _required_string(body, "object_key")

    sub_file_type = body.get("sub_file_type")
    if isinstance(sub_file_type, bool) or sub_file_type not in (0, 1):
        raise DjiMediaContractError("sub_file_type must be 0 or 1")

    if not isinstance(body.get("metadata"), dict):
        raise DjiMediaContractError("metadata must be an object")
    path = body.get("path")
    if path is not None and not isinstance(path, str):
        raise DjiMediaContractError("path must be a string or null")
    return body


def validate_group_upload_callback(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    group_id = _required_string(body, "file_group_id")
    if not _UUID_RE.fullmatch(group_id):
        raise DjiMediaContractError("file_group_id must be a lowercase UUID")

    total = body.get("file_count")
    uploaded = body.get("file_uploaded_count")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        raise DjiMediaContractError("file_count must be a non-negative integer")
    if isinstance(uploaded, bool) or not isinstance(uploaded, int) or uploaded < 0:
        raise DjiMediaContractError("file_uploaded_count must be a non-negative integer")
    if uploaded > total:
        raise DjiMediaContractError("file_uploaded_count cannot exceed file_count")
    return body
