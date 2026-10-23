#!/usr/bin/env python3
"""Offline-only thermal person geolocation preview (no ROS, DJI, network or ML imports).

Inspired by Gruzver/uav-thermal-person-geolocation (MIT). Not a navigation,
search-and-rescue dispatch, or positional-accuracy certification system.
"""

import argparse
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

INPUT_SCHEMA = "skyhub-thermal-person-geolocation-input-v1"
OUTPUT_SCHEMA = "skyhub-thermal-person-geolocation-preview-v1"
MAX_DETECTIONS = 64
MAX_SYNC_MS = 250
MAX_GROUND_DISTANCE_M = 1000.0
MAX_INPUT_BYTES = 131_072
EARTH_RADIUS_M = 6_378_137.0


class InvalidInput(ValueError):
    """Short, fixed-message refusal; never includes coordinates or paths."""


def _object(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise InvalidInput("invalid_shape")
    return value


def _number(value, lower, upper):
    if type(value) not in (float, int) or not math.isfinite(value) or not lower <= value <= upper:
        raise InvalidInput("invalid_number")
    return float(value)


def _integer(value, lower, upper):
    if type(value) is not int or not lower <= value <= upper:
        raise InvalidInput("invalid_integer")
    return value


def _true(value):
    if value is not True:
        raise InvalidInput("verification_required")


def _camera(frame, camera):
    _object(frame, ("width", "height", "coordinateSpace"))
    width = _integer(frame["width"], 16, 8192)
    height = _integer(frame["height"], 16, 8192)
    if width * height > 12_000_000 or frame["coordinateSpace"] != "undistorted_uncropped":
        raise InvalidInput("unverified_pixel_space")
    _object(camera, ("calibrationId", "horizontalFovDeg", "verticalFovDeg", "verified", "zoomRatio"))
    calibration = camera["calibrationId"]
    if not isinstance(calibration, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", calibration):
        raise InvalidInput("invalid_calibration")
    _true(camera["verified"])
    hfov = _number(camera["horizontalFovDeg"], 1.0, 140.0)
    vfov = _number(camera["verticalFovDeg"], 1.0, 140.0)
    if _number(camera["zoomRatio"], 1.0, 100.0) != 1.0:
        raise InvalidInput("zoom_calibration_required")
    return width, height, hfov, vfov


def _telemetry(telemetry, timestamp):
    _object(telemetry, (
        "timestampMs", "timeVerified", "latitude", "longitude", "positionVerified",
        "altitudeAglM", "altitudeAglVerified", "gimbalYawDeg", "gimbalPitchDeg",
        "gimbalRollDeg", "gimbalVerified", "yawReference",
    ))
    source_time = _integer(telemetry["timestampMs"], 1_000_000_000_000, 9_999_999_999_999)
    _true(telemetry["timeVerified"])
    _true(telemetry["positionVerified"])
    _true(telemetry["altitudeAglVerified"])
    _true(telemetry["gimbalVerified"])
    if telemetry["yawReference"] != "true_north_clockwise":
        raise InvalidInput("unverified_yaw_reference")
    if abs(source_time - timestamp) > MAX_SYNC_MS:
        raise InvalidInput("telemetry_out_of_sync")
    lat = _number(telemetry["latitude"], -85.0, 85.0)
    lon = _number(telemetry["longitude"], -180.0, 180.0)
    if lat == 0.0 and lon == 0.0:
        raise InvalidInput("invalid_position")
    agl = _number(telemetry["altitudeAglM"], 1.0, 500.0)
    yaw = _number(telemetry["gimbalYawDeg"], -180.0, 360.0)
    pitch = _number(telemetry["gimbalPitchDeg"], -90.0, 0.0)
    roll = _number(telemetry["gimbalRollDeg"], -180.0, 180.0)
    # DJI roll sign conventions and camera extrinsics are not calibrated here.
    # Refusing even small non-zero roll is safer than silently ignoring it.
    if abs(roll) > 1e-9:
        raise InvalidInput("roll_calibration_required")
    return lat, lon, agl, math.radians(yaw), math.radians(-pitch)


def _project_pixel(cx, cy, width, height, hfov, vfov, lat, lon, agl, yaw, down_pitch):
    # Pinhole ray in camera forward/right/down axes; image x goes right, y down.
    right = ((2.0 * cx / width) - 1.0) * math.tan(math.radians(hfov) / 2.0)
    down = ((2.0 * cy / height) - 1.0) * math.tan(math.radians(vfov) / 2.0)
    forward = math.cos(down_pitch) - down * math.sin(down_pitch)
    downward = math.sin(down_pitch) + down * math.cos(down_pitch)
    # Near-horizontal rays are sensitive to unknown terrain and attitude.
    if downward < 0.15:
        return None
    north_ray = forward * math.cos(yaw) - right * math.sin(yaw)
    east_ray = forward * math.sin(yaw) + right * math.cos(yaw)
    north = agl * north_ray / downward
    east = agl * east_ray / downward
    distance = math.hypot(north, east)
    if not math.isfinite(distance) or distance > MAX_GROUND_DISTANCE_M:
        return None
    target_lat = lat + math.degrees(north / EARTH_RADIUS_M)
    target_lon = lon + math.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
    if not (-90.0 <= target_lat <= 90.0 and -180.0 <= target_lon <= 180.0):
        return None
    return round(target_lat, 6), round(target_lon, 6), round(distance, 2)


def project(payload):
    """Validate all inputs before producing local-only, unverified location estimates.

    Verification booleans are ASSERTIONS made by a trusted calling workflow,
    not independent evidence that this module can certify calibration or GPS.
    """
    _object(payload, ("schema", "timestampMs", "frame", "camera", "telemetry", "detections"))
    if payload["schema"] != INPUT_SCHEMA:
        raise InvalidInput("invalid_schema")
    timestamp = _integer(payload["timestampMs"], 1_000_000_000_000, 9_999_999_999_999)
    width, height, hfov, vfov = _camera(payload["frame"], payload["camera"])
    lat, lon, agl, yaw, down_pitch = _telemetry(payload["telemetry"], timestamp)
    detections = payload["detections"]
    if not isinstance(detections, list) or len(detections) > MAX_DETECTIONS:
        raise InvalidInput("invalid_detections")

    parsed = []
    seen_ids = set()
    for item in detections:
        _object(item, ("trackId", "className", "confidence", "bboxXYXY"))
        track_id = _integer(item["trackId"], 0, 2_147_483_647)
        if track_id in seen_ids:
            raise InvalidInput("duplicate_track_id")
        seen_ids.add(track_id)
        if item["className"] not in ("person", "other"):
            raise InvalidInput("invalid_class")
        confidence = _number(item["confidence"], 0.0, 1.0)
        bbox = item["bboxXYXY"]
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise InvalidInput("invalid_bbox")
        x1 = _number(bbox[0], 0.0, float(width))
        y1 = _number(bbox[1], 0.0, float(height))
        x2 = _number(bbox[2], 0.0, float(width))
        y2 = _number(bbox[3], 0.0, float(height))
        if x2 <= x1 or y2 <= y1:
            raise InvalidInput("invalid_bbox")
        parsed.append((track_id, item["className"], confidence, (x1+x2)/2, (y1+y2)/2))

    estimates = []
    dropped_non_person = dropped_confidence = dropped_geometry = 0
    for track_id, class_name, confidence, cx, cy in parsed:
        if class_name != "person":
            dropped_non_person += 1
            continue
        if confidence < 0.5:
            dropped_confidence += 1
            continue
        projected = _project_pixel(cx, cy, width, height, hfov, vfov, lat, lon, agl, yaw, down_pitch)
        if projected is None:
            dropped_geometry += 1
            continue
        p_lat, p_lon, distance = projected
        estimates.append({
            "trackId": track_id,
            "latitude": p_lat,
            "longitude": p_lon,
            "groundOffsetMeters": distance,
            "confidence": round(confidence, 4),
            "status": "unverified_candidate",
        })

    return {
        "schema": OUTPUT_SCHEMA,
        "status": "candidates" if estimates else "no_candidates",
        "estimateOnly": True,
        "geolocationVerified": False,
        "accuracyMetersVerified": False,
        "flightControlReady": False,
        "searchAndRescueReady": False,
        "inputDetectionCount": len(parsed),
        "candidateCount": len(estimates),
        "rejectedCounts": {
            "nonPerson": dropped_non_person,
            "lowConfidence": dropped_confidence,
            "invalidGeometry": dropped_geometry,
        },
        "estimates": estimates,
    }


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidInput("duplicate_json_key")
        result[key] = value
    return result


def _reject_constant(_value):
    raise InvalidInput("nonfinite_json_number")


def _read_local_input(name):
    path = Path(name)
    if not path.is_absolute() or path.suffix.lower() != ".json" or path.is_symlink():
        raise InvalidInput("invalid_input_file")
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_INPUT_BYTES:
            raise InvalidInput("invalid_input_file")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            raw = stream.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise InvalidInput("invalid_input_file")
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys, parse_constant=_reject_constant)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise InvalidInput("invalid_input_file") from error


def _write_local_output(name, result):
    path = Path(name)
    if not path.is_absolute() or path.suffix.lower() != ".json" or path.is_symlink():
        raise InvalidInput("invalid_output_file")
    data = (json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
    except OSError as error:
        raise InvalidInput("invalid_output_file") from error


def main(argv=None):
    parser = argparse.ArgumentParser(description="Explicit offline thermal-person geolocation preview")
    parser.add_argument("--input", required=True, help="Absolute path to private JSON input")
    parser.add_argument("--output", required=True, help="New absolute path for private JSON output")
    parser.add_argument("--allow-sensitive-location-output", action="store_true", help="Opt in to writing candidate GPS coordinates")
    args = parser.parse_args(argv)
    if not args.allow_sensitive_location_output:
        parser.error("Explicit sensitive-location-output opt-in required")
    try:
        result = project(_read_local_input(args.input))
        _write_local_output(args.output, result)
    except InvalidInput as error:
        print(f"Input refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
