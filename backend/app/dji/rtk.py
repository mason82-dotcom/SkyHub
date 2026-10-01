"""Read-only DJI GNSS/RTK status parsing.

The semantics intentionally follow FH-Clone:
- position_state.is_fixed is a generic acquisition state.
- quality == 10 is the explicit RTK-fixed indicator.
- mode_code == 18 is an airborne RTK fixing mode, not proof of a fix.
"""
from __future__ import annotations

import math
import time
from typing import Any


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(float(value)) else None


def _fix_state(code: int | float | None) -> str:
    return {
        0: "not_started",
        1: "fixing",
        2: "fixed",
        3: "failed",
    }.get(code, "unknown")


def parse_dji_rtk_status(payload: Any, sampled_at_ms: int | None = None) -> dict[str, Any] | None:
    """Parse RTK/GNSS state without promoting generic GNSS fix to RTK fixed."""
    root = _record(payload)
    if root is None:
        return None

    source = _record(root.get("data")) or root
    host = _record(source.get("host")) or source
    position = _record(host.get("position_state")) or _record(source.get("position_state"))

    fix_state_code = _number(position.get("is_fixed")) if position else None
    quality_code = _number(position.get("quality")) if position else None

    gps_satellites = _number(position.get("gps_number")) if position else None
    if gps_satellites is None:
        gps_satellites = _number(host.get("gps_number"))
    if gps_satellites is None:
        gps_satellites = _number(source.get("gps_number"))

    rtk_satellites = _number(position.get("rtk_number")) if position else None
    if rtk_satellites is None:
        rtk_satellites = _number(host.get("rtk_number"))
    if rtk_satellites is None:
        rtk_satellites = _number(source.get("rtk_number"))

    mode_code = _number(host.get("mode_code"))
    if mode_code is None:
        mode_code = _number(source.get("mode_code"))

    has_rtk_evidence = (
        rtk_satellites is not None
        or quality_code == 10
        or mode_code == 18
    )
    if not has_rtk_evidence:
        return None

    result: dict[str, Any] = {
        "fix_state": _fix_state(fix_state_code),
        "airborne_rtk_fixing_mode": mode_code == 18,
        "sampled_at_ms": sampled_at_ms if sampled_at_ms is not None else int(time.time() * 1000),
    }
    if fix_state_code is not None:
        result["fix_state_code"] = fix_state_code
    if quality_code is not None:
        result["quality_code"] = quality_code
        result["is_fixed"] = quality_code == 10 and (fix_state_code is None or fix_state_code == 2)
    if gps_satellites is not None:
        result["gps_satellites"] = gps_satellites
    if rtk_satellites is not None:
        result["rtk_satellites"] = rtk_satellites
    if mode_code is not None:
        result["mode_code"] = mode_code
    return result


class RtkFixMonitor:
    """Track deterministic RTK fixed/lost transitions per aircraft."""

    def __init__(self) -> None:
        self._fixed_by_device: dict[str, bool] = {}

    def observe(self, device_id: str, status: dict[str, Any]) -> dict[str, Any] | None:
        current = status.get("is_fixed")
        if not isinstance(current, bool):
            return None

        previous = self._fixed_by_device.get(device_id)
        self._fixed_by_device[device_id] = current
        if previous is None or previous == current:
            return None

        return {
            "device_id": device_id,
            "type": "acquired" if current else "lost",
            "sampled_at_ms": status.get("sampled_at_ms"),
            "previous_fixed": previous,
            "current_fixed": current,
        }
