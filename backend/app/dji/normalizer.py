"""Canonical read-only normalization for DJI Cloud API telemetry."""
from __future__ import annotations

import math
import re
from typing import Any

from .rtk import parse_dji_rtk_status

_PAYLOAD_INDEX = re.compile(r"^\d+-\d+-\d+$")


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(float(value)) else None


def _first_number(*values: Any) -> int | float | None:
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _field(host: dict[str, Any], source: dict[str, Any], key: str) -> Any:
    return host[key] if key in host else source.get(key)


def normalize_dji_payload(payload: Any) -> dict[str, Any]:
    """Normalize DJI OSD/state payloads without inventing capabilities."""
    root = _record(payload)
    if root is None:
        return {"capabilities": []}

    source = _record(root.get("data")) or root
    host = _record(source.get("host")) or source
    capabilities: set[str] = set()

    position = {
        "latitude_deg": _number(_field(host, source, "latitude")),
        "longitude_deg": _number(_field(host, source, "longitude")),
    }
    altitude = {
        "ellipsoid_m": _number(_field(host, source, "height")),
        "relative_m": _number(_field(host, source, "elevation")),
    }
    velocity = {
        "horizontal_mps": _number(_field(host, source, "horizontal_speed")),
        "vertical_mps": _number(_field(host, source, "vertical_speed")),
    }
    attitude = {
        "yaw_deg": _first_number(_field(host, source, "attitude_head"), _field(host, source, "yaw")),
        "pitch_deg": _first_number(_field(host, source, "attitude_pitch"), _field(host, source, "pitch")),
        "roll_deg": _first_number(_field(host, source, "attitude_roll"), _field(host, source, "roll")),
    }
    mode_code = _number(_field(host, source, "mode_code"))

    position_state = _record(host.get("position_state")) or _record(source.get("position_state")) or {}
    gnss = {
        "fix_state_code": _number(position_state.get("is_fixed")),
        "quality_code": _number(position_state.get("quality")),
        "gps_satellites": _first_number(
            position_state.get("gps_number"),
            host.get("gps_number"),
            source.get("gps_number"),
        ),
    }

    flight_values = [
        *position.values(),
        *altitude.values(),
        *velocity.values(),
        *attitude.values(),
        mode_code,
        *gnss.values(),
    ]
    if any(value is not None for value in flight_values):
        capabilities.add("telemetry.flight")

    battery_obj = _record(host.get("battery")) or _record(source.get("battery")) or {}
    battery_percent = _number(battery_obj.get("capacity_percent"))
    if battery_percent is None and isinstance(battery_obj.get("batteries"), list):
        for entry in battery_obj["batteries"]:
            rec = _record(entry)
            if rec is None:
                continue
            battery_percent = _number(rec.get("capacity_percent"))
            if battery_percent is not None:
                break
    if battery_obj:
        capabilities.add("telemetry.battery")

    cameras_source = host.get("cameras") if "cameras" in host else source.get("cameras")
    cameras: list[dict[str, Any]] = []
    if isinstance(cameras_source, list):
        for entry in cameras_source:
            camera = _record(entry)
            if camera is None:
                continue
            payload_index = camera.get("payload_index")
            if not isinstance(payload_index, str) or not _PAYLOAD_INDEX.fullmatch(payload_index):
                continue
            item: dict[str, Any] = {"payload_index": payload_index}
            mappings = {
                "camera_mode": "mode_code",
                "photo_state": "photo_state_code",
                "recording_state": "recording_state_code",
                "remain_photo_num": "remaining_photos",
                "remain_record_duration": "remaining_record_seconds",
                "record_time": "recording_elapsed_seconds",
                "zoom_factor": "zoom_factor",
                "ir_zoom_factor": "thermal_zoom_factor",
            }
            for raw_key, normalized_key in mappings.items():
                value = _number(camera.get(raw_key))
                if value is not None:
                    item[normalized_key] = value
            cameras.append(item)
    if cameras:
        capabilities.add("telemetry.camera")

    gimbals: dict[str, dict[str, int | float]] = {}
    scopes = [source] if host is source else [source, host]
    for scope in scopes:
        for payload_index, value in scope.items():
            if not isinstance(payload_index, str) or not _PAYLOAD_INDEX.fullmatch(payload_index):
                continue
            rec = _record(value)
            if rec is None:
                continue
            axes: dict[str, int | float] = {}
            for raw_key, normalized_key in (
                ("gimbal_pitch", "pitch_deg"),
                ("gimbal_roll", "roll_deg"),
                ("gimbal_yaw", "yaw_deg"),
            ):
                axis = _number(rec.get(raw_key))
                if axis is not None:
                    axes[normalized_key] = axis
            if axes:
                gimbals[payload_index] = axes
    if gimbals:
        capabilities.add("telemetry.gimbal")

    rtk = parse_dji_rtk_status(payload)
    if rtk is not None:
        capabilities.add("telemetry.rtk")

    return {
        "flight": {
            "position": position,
            "altitude": altitude,
            "velocity": velocity,
            "attitude": attitude,
            "mode": {"code": mode_code},
        },
        "navigation": {
            "gnss": gnss,
            "rtk": rtk,
        },
        "battery": {"capacity_percent": battery_percent},
        "cameras": cameras,
        "gimbals": gimbals,
        "capabilities": sorted(capabilities),
    }


def telemetry_point_fields(normalized: dict[str, Any]) -> dict[str, Any] | None:
    """Extract fields used by SkyHub TelemetryPoint persistence."""
    flight = _record(normalized.get("flight")) or {}
    position = _record(flight.get("position")) or {}
    altitude = _record(flight.get("altitude")) or {}
    velocity = _record(flight.get("velocity")) or {}
    attitude = _record(flight.get("attitude")) or {}
    mode = _record(flight.get("mode")) or {}
    battery = _record(normalized.get("battery")) or {}

    lat = _number(position.get("latitude_deg"))
    lon = _number(position.get("longitude_deg"))
    if lat is None or lon is None:
        return None

    battery_percent = _number(battery.get("capacity_percent"))
    mode_code = _number(mode.get("code"))
    return {
        "lat": lat,
        "lon": lon,
        "height": _number(altitude.get("ellipsoid_m")),
        "elevation": _number(altitude.get("relative_m")),
        "heading": _number(attitude.get("yaw_deg")),
        "h_speed": _number(velocity.get("horizontal_mps")),
        "v_speed": _number(velocity.get("vertical_mps")),
        "battery": int(battery_percent) if battery_percent is not None else None,
        "mode_code": int(mode_code) if mode_code is not None else None,
    }
