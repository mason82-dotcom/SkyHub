"""Validation helpers for DJI media HTTP contracts."""
from __future__ import annotations

import re
from typing import Any

from .protocol import DjiProtocolValueError, validate_serial

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class DjiMediaContractError(ValueError):
    pass


def _required_string(obj: dict[str, Any], key: str, max_length: int | None = None) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or value == "":
        raise DjiMediaContractError(f"{key} must be a non-empty string")
    if max_length is not None and len(value) > max_length:
        raise DjiMediaContractError(f"{key} is too long")
    return value


def _required_bool(obj: dict[str, Any], key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise DjiMediaContractError(f"{key} must be boolean")
    return value


def _validate_fast_ext(ext: Any) -> dict[str, Any]:
    if not isinstance(ext, dict):
        raise DjiMediaContractError("ext must be an object")
    _required_string(ext, "drone_model_key", 32)
    _required_string(ext, "payload_model_key", 32)
    tiny = ext.get("tinny_fingerprint", ext.get("tiny_fingerprint"))
    if not isinstance(tiny, str) or tiny == "" or len(tiny) > 256:
        raise DjiMediaContractError("tinny_fingerprint must be a non-empty string up to 256 chars")
    try:
        validate_serial(_required_string(ext, "sn", 64))
    except DjiProtocolValueError as exc:
        raise DjiMediaContractError("sn is not a valid DJI serial") from exc
    _required_bool(ext, "is_original")
    return ext


def validate_fast_upload_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    _validate_fast_ext(body.get("ext"))
    _required_string(body, "fingerprint", 128)
    _required_string(body, "name", 256)
    path = body.get("path")
    if path is not None and (not isinstance(path, str) or len(path) > 512):
        raise DjiMediaContractError("path must be a string up to 512 chars or null")
    return body


def validate_tiny_fingerprint_request(body: Any) -> list[str]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")
    values = body.get("tiny_fingerprints")
    if not isinstance(values, list) or any(not isinstance(value, str) or value == "" for value in values):
        raise DjiMediaContractError("tiny_fingerprints must be a list of non-empty strings")
    if len(values) > 1000:
        raise DjiMediaContractError("tiny_fingerprints contains too many values")
    if any(len(value) > 256 for value in values):
        raise DjiMediaContractError("tiny_fingerprint is too long")
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
    _required_string(body, "object_key", 512)

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
