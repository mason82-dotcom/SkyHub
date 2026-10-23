#!/usr/bin/env python3
"""Manual, single-frame thermal detection -> geolocation research handoff.

The detector preview alone is NOT proof of thermal image provenance, stable
track IDs, corrected optical geometry or GPS. An independently reviewed,
explicitly asserted camera/pose package is mandatory. Still no verified GPS.
No ROS, video decoding, MQTT, DJI, ML or HTTP access.
"""
import argparse
import json
import sys

import thermal_person_geolocation as geo
import thermal_person_detector_offline as det

INPUT_SCHEMA = "skyhub-thermal-person-manual-handoff-input-v1"
OUTPUT_SCHEMA = "skyhub-thermal-person-manual-handoff-preview-v1"

_PREVIEW_KEYS = (
    "schema", "status", "source", "image", "modelFormat",
    "detectionCount", "detections", "personPresenceVerified",
    "trackingVerified", "thermalRadiometryVerified", "geolocationVerified",
    "flightControlReady", "searchAndRescueReady",
)
_REVIEW_KEYS = (
    "timestampMs", "frame", "camera", "telemetry", "pixelTransform",
    "sourceFrameReviewed", "modelReviewed", "opticalGeometryReviewed",
    "detectionsReviewed", "trackAssignments",
)


def _preview(report):
    geo._object(report, _PREVIEW_KEYS)
    if (report["schema"] != det.SCHEMA or
            report["source"] != "explicit-local-8bit-thermal-preview" or
            report["status"] not in ("detections", "no_detections") or
            report["modelFormat"] not in ("onnx", "pt")):
        raise geo.InvalidInput("invalid_detector_contract")
    for key in ("personPresenceVerified", "trackingVerified",
                "thermalRadiometryVerified", "geolocationVerified",
                "flightControlReady", "searchAndRescueReady"):
        if report[key] is not False:
            raise geo.InvalidInput("unsafe_detector_claim")
    geo._object(report["image"], ("width", "height", "coordinateSpace"))
    width, height = det.valid_dimensions(
        report["image"]["width"], report["image"]["height"])
    if report["image"]["coordinateSpace"] != "decoded_image_unverified":
        raise geo.InvalidInput("invalid_detector_coordinate_space")
    detections = report["detections"]
    if (not isinstance(detections, list) or len(detections) > geo.MAX_DETECTIONS or
            type(report["detectionCount"]) is not int or
            report["detectionCount"] != len(detections) or
            report["status"] != ("detections" if detections else "no_detections")):
        raise geo.InvalidInput("invalid_detector_counts")
    for index, item in enumerate(detections):
        geo._object(item, ("detectionIndex", "className", "confidence", "bboxXYXY"))
        if type(item["detectionIndex"]) is not int or item["detectionIndex"] != index:
            raise geo.InvalidInput("invalid_detection_index")
        if item["className"] != "person":
            raise geo.InvalidInput("invalid_detector_label")
    # Validate every box before reading any review assertions.
    boxes = [{
        "trackId": item["detectionIndex"],
        "className": "person", "confidence": item["confidence"],
        "bboxXYXY": item["bboxXYXY"],
    } for item in detections]
    geo._validated_detections(boxes, width, height)
    return width, height, detections


def reviewed_projection(payload):
    """Only explicit single-frame research candidate projection; never verified."""
    geo._object(payload, ("schema", "detectionReport", "review"))
    if payload["schema"] != INPUT_SCHEMA:
        raise geo.InvalidInput("invalid_handoff_schema")
    width, height, detections = _preview(payload["detectionReport"])
    review = geo._object(payload["review"], _REVIEW_KEYS)
    for flag in ("sourceFrameReviewed", "modelReviewed",
                 "opticalGeometryReviewed", "detectionsReviewed"):
        geo._true(review[flag])
    if review["pixelTransform"] != "identity-undistorted-full-frame":
        raise geo.InvalidInput("pixel_mapping_review_required")
    frame_w, frame_h, _, _ = geo._camera(review["frame"], review["camera"])
    if (frame_w, frame_h) != (width, height):
        raise geo.InvalidInput("frame_coordinate_mismatch")
    stamp = geo._integer(review["timestampMs"], 1_000_000_000_000,
                         9_999_999_999_999)
    geo._telemetry(review["telemetry"], stamp)
    assignments = review["trackAssignments"]
    if not isinstance(assignments, list) or len(assignments) != len(detections):
        raise geo.InvalidInput("invalid_track_assignments")
    tracks = set()
    reviewed_boxes = []
    for index, item in enumerate(assignments):
        geo._object(item, ("detectionIndex", "trackId"))
        if type(item["detectionIndex"]) is not int or item["detectionIndex"] != index:
            raise geo.InvalidInput("unmatched_detection_assignment")
        track_id = geo._integer(item["trackId"], 0, 2_147_483_647)
        if track_id in tracks:
            raise geo.InvalidInput("duplicate_track_id")
        tracks.add(track_id)
        candidate = detections[index]
        reviewed_boxes.append({
            "trackId": track_id,
            "className": "person",
            "confidence": candidate["confidence"],
            "bboxXYXY": candidate["bboxXYXY"],
        })
    result = geo.project({
        "schema": geo.INPUT_SCHEMA,
        "timestampMs": stamp,
        "frame": review["frame"], "camera": review["camera"],
        "telemetry": review["telemetry"], "detections": reviewed_boxes,
    })
    # Return unverified candidates only; no model identifiers, source times,
    # metadata, serial numbers, raw telemetry or per-frame privacy identifiers.
    return {
        "schema": OUTPUT_SCHEMA,
        "status": result["status"],
        "estimateOnly": True,
        "geolocationVerified": False,
        "accuracyMetersVerified": False,
        "personPresenceVerified": False,
        "trackingVerified": False,
        "flightControlReady": False,
        "searchAndRescueReady": False,
        "inputDetectionCount": result["inputDetectionCount"],
        "candidateCount": result["candidateCount"],
        "rejectedCounts": result["rejectedCounts"],
        "estimates": result["estimates"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Manual single-frame thermal detection/geolocation research handoff")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-sensitive-location-output", action="store_true")
    parser.add_argument("--accept-reviewed-handoff", action="store_true")
    args = parser.parse_args(argv)
    if not (args.allow_sensitive_location_output and args.accept_reviewed_handoff):
        parser.error("Both explicit reviewed-handoff and sensitive-output opt-ins required")
    try:
        result = reviewed_projection(geo._read_local_input(args.input))
        geo._write_local_output(args.output, result)
    except (geo.InvalidInput, det.InvalidInput) as exc:
        # Redacted fixed-class errors; never echo coordinates or frame provenance.
        print("Input refused: invalid_or_unverified_handoff", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
