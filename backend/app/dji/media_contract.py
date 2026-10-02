"""Validation helpers for DJI Cloud API v1.16.1 media HTTP contracts."""
from __future__ import annotations

import hashlib
import re
from typing import Any

from .protocol import DjiProtocolValueError, validate_serial

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_MODEL_KEY_RE = re.compile(r"^\d+-\d+-\d+$")


class DjiMediaContractError(ValueError):
    pass


def _required_string(obj: dict[str, Any], key: str, max_length: int | None = None) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or value == "":
        raise DjiMediaContractError(f"{key} must be a non-empty string")
    if max_length is not None and len(value) > max_length:
        raise DjiMediaContractError(f"{key} is too long")
    return value


def _optional_string(obj: dict[str, Any], key: str, max_length: int | None = None) -> str | None:
    if key not in obj or obj[key] is None:
        return None
    return _required_string(obj, key, max_length)


def _validate_model_key(value: str, field: str) -> str:
    if not _MODEL_KEY_RE.fullmatch(value):
        raise DjiMediaContractError(f"{field} must be a DJI product key")
    return value


def _validate_ext(ext: Any) -> dict[str, Any]:
    if ext is None:
        return {}
    if not isinstance(ext, dict):
        raise DjiMediaContractError("ext must be an object when present")

    file_group_id = _optional_string(ext, "file_group_id", 64)
    if file_group_id is not None and not _UUID_RE.fullmatch(file_group_id):
        raise DjiMediaContractError("file_group_id must be a lowercase UUID")

    for field in ("drone_model_key", "payload_model_key"):
        value = _optional_string(ext, field, 32)
        if value is not None:
            _validate_model_key(value, field)

    tiny = ext.get("tinny_fingerprint", ext.get("tiny_fingerprint"))
    if tiny is not None and (
        not isinstance(tiny, str) or not tiny or len(tiny) > 256
    ):
        raise DjiMediaContractError(
            "tinny_fingerprint must be a non-empty string up to 256 chars"
        )

    sn = _optional_string(ext, "sn", 64)
    if sn is not None:
        try:
            validate_serial(sn)
        except DjiProtocolValueError as exc:
            raise DjiMediaContractError("sn is not a valid DJI serial") from exc

    if "is_original" in ext and not isinstance(ext["is_original"], bool):
        raise DjiMediaContractError("is_original must be boolean when present")

    return ext


def validate_fast_upload_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")

    _required_string(body, "fingerprint", 128)
    _validate_ext(body.get("ext"))

    _optional_string(body, "name", 256)
    path = body.get("path")
    if path is not None and (not isinstance(path, str) or len(path) > 512):
        raise DjiMediaContractError("path must be a string up to 512 chars or null")
    return body


def validate_tiny_fingerprint_request(body: Any) -> list[str]:
    # v1.16.1 documents the request body as array[string]. The legacy object
    # shape remains accepted for compatibility with older Pilot integrations.
    values = body.get("tiny_fingerprints") if isinstance(body, dict) else body
    if not isinstance(values, list) or any(
        not isinstance(value, str) or value == "" for value in values
    ):
        raise DjiMediaContractError(
            "tiny_fingerprints must be an array of non-empty strings"
        )
    if len(values) > 1000:
        raise DjiMediaContractError("tiny_fingerprints contains too many values")
    if any(len(value) > 256 for value in values):
        raise DjiMediaContractError("tiny_fingerprint is too long")
    return values


def validate_upload_callback_request(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")

    result = body.get("result")
    if isinstance(result, bool) or not isinstance(result, int):
        raise DjiMediaContractError("result must be an integer")

    name = _required_string(body, "name", 256)
    object_key = _required_string(body, "object_key", 512)
    fingerprint = _optional_string(body, "fingerprint", 128)
    ext = _validate_ext(body.get("ext"))

    metadata = body.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise DjiMediaContractError("metadata must be an object when present")

    sub_file_type = body.get("sub_file_type")
    if sub_file_type is not None and (
        isinstance(sub_file_type, bool) or sub_file_type not in (0, 1)
    ):
        raise DjiMediaContractError("sub_file_type must be 0 or 1 when present")

    path = body.get("path")
    if path is not None and (not isinstance(path, str) or len(path) > 512):
        raise DjiMediaContractError("path must be a string up to 512 chars or null")

    return {
        **body,
        "result": result,
        "name": name,
        "object_key": object_key,
        "fingerprint": fingerprint,
        "ext": ext,
        "metadata": metadata or {},
    }


def media_storage_identity(callback: dict[str, Any]) -> str:
    """Return an internal unique DB key without pretending it is a DJI fingerprint.

    DJI v1.16.1 allows upload callbacks without fingerprint. In that case a
    namespaced hash of object_key is used only as SkyHub's internal unique key.
    It will never match a real Pilot fast-upload fingerprint.
    """
    fingerprint = callback.get("fingerprint")
    if isinstance(fingerprint, str) and fingerprint:
        return fingerprint
    object_key = callback["object_key"]
    digest = hashlib.sha256(object_key.encode("utf-8")).hexdigest()
    return f"object-key:{digest}"


def validate_group_upload_callback(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise DjiMediaContractError("request body must be an object")

    group_id = body.get("file_group_id")
    if group_id is not None:
        if not isinstance(group_id, str) or (
            group_id and not _UUID_RE.fullmatch(group_id)
        ):
            raise DjiMediaContractError(
                "file_group_id must be a lowercase UUID when present"
            )

    total = body.get("file_count")
    uploaded = body.get("file_uploaded_count")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        raise DjiMediaContractError("file_count must be a non-negative integer")
    if isinstance(uploaded, bool) or not isinstance(uploaded, int) or uploaded < 0:
        raise DjiMediaContractError(
            "file_uploaded_count must be a non-negative integer"
        )
    if uploaded > total:
        raise DjiMediaContractError("file_uploaded_count cannot exceed file_count")
    return body
