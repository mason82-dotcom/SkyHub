#!/usr/bin/env python3
"""Bounded offline frame/telemetry synchronization for thermal location candidates.

Input provenance and timestamps must already have been verified by a trusted
caller. No DJI API, camera, ROS2, MQTT, storage, or network operations.
"""
import argparse
import bisect
import json
import sys

import thermal_person_geolocation as geo

INPUT_SCHEMA = "skyhub-thermal-geolocation-batch-input-v1"
OUTPUT_SCHEMA = "skyhub-thermal-geolocation-batch-preview-v1"
MAX_FRAMES = 128
MAX_STATES = 256


def _ordered_times(records, label):
    stamps = []
    for record in records:
        if not isinstance(record, dict) or "timestampMs" not in record:
            raise geo.InvalidInput("invalid_" + label)
        stamp = geo._integer(record["timestampMs"], 1_000_000_000_000, 9_999_999_999_999)
        if stamps and stamp <= stamps[-1]:
            raise geo.InvalidInput("unordered_" + label)
        stamps.append(stamp)
    return stamps


def analyze_batch(payload):
    """Process precomputed detection boxes with nearest verified pose, no interpolation.

    An unmatched frame never produces coordinates; source timestamps and
    aircraft state never appear in the report.
    """
    geo._object(payload, ("schema", "frames", "telemetry"))
    if payload["schema"] != INPUT_SCHEMA:
        raise geo.InvalidInput("invalid_batch_schema")
    frames = payload["frames"]
    states = payload["telemetry"]
    if (not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES or
            not isinstance(states, list) or not 1 <= len(states) <= MAX_STATES):
        raise geo.InvalidInput("invalid_batch_size")
    frame_times = _ordered_times(frames, "frames")
    state_times = _ordered_times(states, "telemetry")
    for state, stamp in zip(states, state_times):
        # Verify the full telemetry schema before matching any frames.
        geo._telemetry(state, stamp)
    for frame, stamp in zip(frames, frame_times):
        geo._object(frame, ("timestampMs", "frame", "camera", "detections"))
        geo._camera(frame["frame"], frame["camera"])
        # Input with skipped frames must still use bounded detector arrays.
        detections = frame["detections"]
        if not isinstance(detections, list) or len(detections) > geo.MAX_DETECTIONS:
            raise geo.InvalidInput("invalid_detections")

    results = []
    missing_pose = 0
    total_candidates = 0
    for index, (frame, stamp) in enumerate(zip(frames, frame_times)):
        pos = bisect.bisect_left(state_times, stamp)
        nearby = [i for i in (pos - 1, pos) if 0 <= i < len(states)]
        nearest = min(nearby, key=lambda i: (abs(state_times[i] - stamp), i))
        delta = abs(state_times[nearest] - stamp)
        if delta > geo.MAX_SYNC_MS:
            missing_pose += 1
            results.append({"frameIndex": index, "status": "pose_unavailable",
                            "candidateCount": 0, "estimates": []})
            continue
        single = geo.project({
            "schema": geo.INPUT_SCHEMA, "timestampMs": stamp, "frame": frame["frame"],
            "camera": frame["camera"], "telemetry": states[nearest],
            "detections": frame["detections"],
        })
        results.append({"frameIndex": index, "status": single["status"],
                        "candidateCount": single["candidateCount"],
                        "estimates": single["estimates"]})
        total_candidates += single["candidateCount"]
    return {
        "schema": OUTPUT_SCHEMA,
        "status": "candidates" if total_candidates else "no_candidates",
        "estimateOnly": True,
        "geolocationVerified": False,
        "accuracyMetersVerified": False,
        "searchAndRescueReady": False,
        "flightControlReady": False,
        "frameCount": len(frames),
        "unmatchedFrameCount": missing_pose,
        "candidateCount": total_candidates,
        "frames": results,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline-only verified-timestamp geolocation batch")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-sensitive-location-output", action="store_true")
    args = parser.parse_args(argv)
    if not args.allow_sensitive_location_output:
        parser.error("Explicit sensitive-location-output opt-in required")
    try:
        report = analyze_batch(geo._read_local_input(args.input))
        geo._write_local_output(args.output, report)
    except geo.InvalidInput as error:
        print(f"Input refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
