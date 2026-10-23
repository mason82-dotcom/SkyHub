#!/usr/bin/env python3
"""Opt-in OFFLINE thermal preview detector for reviewed external person models.

This worker only reads a local, already-rendered 8-bit JPEG/PNG. It does not
consume radiometric TIFF/R-JPEG, connect to DJI/ROS/MQTT, track persons across
frames, geolocate anybody or certify actual person presence.
"""

import argparse
import json
import math
from pathlib import Path
import stat
import warnings
import sys

SCHEMA = "skyhub-thermal-person-detection-preview-v1"
MAX_DETECTIONS = 64
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_MODEL_BYTES = 512 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_DIMENSION = 8192


class InvalidInput(ValueError):
    """Output-safe fixed refusal; local sensitive paths are never included."""


def local_file(raw, extensions, limit):
    if not isinstance(raw, str):
        raise InvalidInput("invalid_local_file")
    path = Path(raw)
    if not path.is_absolute() or path.suffix.lower() not in extensions:
        raise InvalidInput("invalid_local_file")
    try:
        info = path.lstat()
    except OSError as error:
        raise InvalidInput("invalid_local_file") from error
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
        raise InvalidInput("invalid_local_file")
    return path


def probe_8bit_image(path):
    # Pillow is optional and only imported after local image/model path checks.
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as error:
        raise InvalidInput("image_dependency_unavailable") from error
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as picture:
                if picture.format not in ("JPEG", "PNG") or picture.mode not in ("RGB", "L"):
                    raise InvalidInput("unsupported_image")
                width, height = picture.size
                valid_dimensions(width, height)
                # Reject EXIF/XMP, including embedded coordinates or R-JPEG fields.
                if (picture.getexif() or any(x in picture.info for x in
                        ("exif", "xmp", "XML:com.adobe.xmp", "Raw profile type exif"))):
                    raise InvalidInput("embedded_metadata_not_supported")
                picture.load()
                return width, height
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise InvalidInput("unsupported_image") from error


def valid_dimensions(width, height):
    if (type(width) is not int or type(height) is not int or
            not 16 <= width <= MAX_DIMENSION or not 16 <= height <= MAX_DIMENSION or
            width * height > MAX_PIXELS):
        raise InvalidInput("invalid_image_dimensions")
    return width, height


def _number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise InvalidInput("invalid_numeric_prediction")
    return float(value)


def _list(value):
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        raise InvalidInput("invalid_model_output")
    return value


def _valid_person_class(names, index):
    if isinstance(names, dict):
        label = names.get(index)
    elif isinstance(names, (list, tuple)):
        label = names[index] if 0 <= index < len(names) else None
    else:
        label = None
    # Never turn generic images or unsafe model labels into 'person' claims.
    return type(label) is str and label.lower() == "person"


def parse_prediction(result, width, height, confidence):
    shape = getattr(result, "orig_shape", None)
    if not isinstance(shape, (list, tuple)) or tuple(shape) != (height, width):
        raise InvalidInput("model_image_shape_changed")
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        raise InvalidInput("missing_predictions")
    xyxy, probs, labels = (_list(getattr(boxes, key, None))
                            for key in ("xyxy", "conf", "cls"))
    if not len(xyxy) == len(probs) == len(labels) or len(xyxy) > MAX_DETECTIONS:
        raise InvalidInput("invalid_model_output")
    parsed = []
    for bbox, score, label in zip(xyxy, probs, labels):
        prob = _number(score, 0, 1)
        cid = _number(label, 0, 9999)
        if not cid.is_integer() or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            raise InvalidInput("invalid_model_output")
        x1 = _number(bbox[0], 0, width)
        y1 = _number(bbox[1], 0, height)
        x2 = _number(bbox[2], 0, width)
        y2 = _number(bbox[3], 0, height)
        if x2 <= x1 or y2 <= y1:
            raise InvalidInput("invalid_model_output")
        parsed.append((int(cid), prob, [x1, y1, x2, y2]))
    # Validate every prediction before emitting even a filtered subset.
    detections = []
    for class_id, score, box in parsed:
        if score < confidence or not _valid_person_class(getattr(result, "names", None), class_id):
            continue
        detections.append({
            "detectionIndex": len(detections),
            "className": "person",
            "confidence": round(score, 4),
            "bboxXYXY": [round(x, 2) for x in box],
        })
    return detections


def analyze(image, model, *, trusted_model=False, trusted_pt=False,
            confidence=0.5, image_probe=None, model_factory=None):
    conf = _number(confidence, 0.1, 0.99)
    if trusted_model is not True:
        raise InvalidInput("model_review_required")
    image_path = local_file(image, {".jpg", ".jpeg", ".png"}, MAX_IMAGE_BYTES)
    model_path = local_file(model, {".onnx", ".pt"}, MAX_MODEL_BYTES)
    if model_path.suffix.lower() == ".pt" and trusted_pt is not True:
        raise InvalidInput("pt_deserialization_not_approved")
    width, height = (image_probe or probe_8bit_image)(image_path)
    valid_dimensions(width, height)
    if model_factory is None:
        # PT loading may execute pickle. Only explicitly reviewed files allowed.
        from ultralytics import YOLO
        model_factory = YOLO
    detector = model_factory(str(model_path), task="detect")
    predictions = detector.predict(
        source=str(image_path), device="cpu", conf=conf, iou=0.45,
        max_det=MAX_DETECTIONS, verbose=False, save=False, stream=False,
    )
    if not isinstance(predictions, (list, tuple)) or len(predictions) != 1:
        raise InvalidInput("invalid_model_output")
    detections = parse_prediction(predictions[0], width, height, conf)
    return {
        "schema": SCHEMA,
        "status": "detections" if detections else "no_detections",
        "source": "explicit-local-8bit-thermal-preview",
        "image": {"width": width, "height": height,
                  "coordinateSpace": "decoded_image_unverified"},
        "modelFormat": model_path.suffix.lower()[1:],
        "detectionCount": len(detections),
        "detections": detections,
        "personPresenceVerified": False,
        "trackingVerified": False,
        "thermalRadiometryVerified": False,
        "geolocationVerified": False,
        "flightControlReady": False,
        "searchAndRescueReady": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Optional local 8-bit thermal-image detector")
    parser.add_argument("--image", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True, help="New absolute private JSON file")
    parser.add_argument("--confidence", type=float, default=0.5)
    parser.add_argument("--trust-local-model", action="store_true",
                        help="Only use separately reviewed local model files")
    parser.add_argument("--allow-trusted-pt", action="store_true",
                        help="Opt in to PyTorch pickle deserialization of reviewed PT weights")
    args = parser.parse_args(argv)
    try:
        report = analyze(args.image, args.model,
                         trusted_model=args.trust_local_model,
                         trusted_pt=args.allow_trusted_pt,
                         confidence=args.confidence)
        from thermal_person_geolocation import _write_local_output
        _write_local_output(args.output, report)
    except Exception:
        # Model import/load errors could include file paths or user identifiers.
        print(json.dumps({"schema": SCHEMA, "status": "unavailable"}, separators=(",", ":")))
        return 2
    print(json.dumps({"schema": SCHEMA, "status": report["status"],
                      "detectionCount": report["detectionCount"]},
                     separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
