"""DJI Cloud API v1.16.1 TSA topology response helpers.

Current official DJI documentation is normative here. The retired Demo used a
different DTO representation, so this module intentionally follows the current
Pilot-to-Cloud HTTP schema instead.
"""
from __future__ import annotations

from typing import Any

from .protocol import DjiProtocolValueError, validate_serial


class DjiTsaContractError(ValueError):
    pass


def _identity_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DjiTsaContractError(f"{field} must be a non-negative integer")
    return value


def build_device_model(domain: int, type_: int, sub_type: int) -> dict[str, str]:
    domain = _identity_int(domain, "domain")
    type_ = _identity_int(type_, "type")
    sub_type = _identity_int(sub_type, "sub_type")
    return {
        "key": f"{domain}-{type_}-{sub_type}",
        "domain": str(domain),
        "type": str(type_),
        "sub_type": str(sub_type),
    }


def build_device_topology(
    *,
    sn: str,
    callsign: str | None,
    domain: int,
    type_: int,
    sub_type: int,
    online: bool,
    fallback_callsign: str,
    user_id: str = "",
    user_callsign: str = "",
) -> dict[str, Any]:
    try:
        validate_serial(sn)
    except DjiProtocolValueError as exc:
        raise DjiTsaContractError(str(exc)) from exc

    if not isinstance(online, bool):
        raise DjiTsaContractError("online must be boolean")

    display = callsign if isinstance(callsign, str) and callsign else fallback_callsign
    if not isinstance(display, str) or not display:
        raise DjiTsaContractError("device_callsign must be a non-empty string")

    if not isinstance(user_id, str):
        raise DjiTsaContractError("user_id must be a string")
    if not isinstance(user_callsign, str):
        raise DjiTsaContractError("user_callsign must be a string")

    return {
        "sn": sn,
        "device_callsign": display,
        "device_model": build_device_model(domain, type_, sub_type),
        "online_status": online,
        "user_id": user_id,
        "user_callsign": user_callsign,
        "icon_urls": {
            # DJI documents that empty icon URLs fall back to device_model icons.
            "normal_icon_url": "",
            "selected_icon_url": "",
        },
    }
