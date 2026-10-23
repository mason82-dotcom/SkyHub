#!/usr/bin/env python3
"""Opt-in, offline RGB YOLO11 inference; no DJI, S3, MQTT, or HTTP access.

Only explicit, local RGB image/model files are accepted. Output is a bounded
and intentionally redacted detection contract; it is not a defect diagnosis.
Third-party model files are untrusted code/data: only use reviewed weights.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import stat
import sys
import warnings
from pathlib import Path

SCHEMA = "skyhub-vision-yolo11-preview-v1"
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_MODEL_BYTES = 256 * 1024 * 1024
MAX_PIXELS = 24_000_000
MAX_DETECTIONS = 100
LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


class InvalidInput(ValueError):
    """An unsupported or unsafe local input or prediction."""


def local_file(value: str, extensions: set[str], limit: int) -> Path:
    path = Path(value)
    if not path.is_absolute() or path.suffix.lower() not in extensions:
        raise InvalidInput("Unsupported local file")
    try:
        info = path.lstat()
    except OSError as exc:
        raise InvalidInput("File unavailable") from exc
    # No symlink or directory traversal through the final path component.
    if not stat.S_ISREG(info.st_mode) or info.st_size <= 0 or info.st_size > limit:
        raise InvalidInput("File unavailable or above size limit")
    return path


def inspect_rgb(path: Path) -> tuple[int, int]:
    """Decode once before inference to bound dimensions and reject fake images."""
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise InvalidInput("Image dependency unavailable") from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.MAX_IMAGE_PIXELS = MAX_PIXELS
            with Image.open(path) as picture:
                if picture.format not in {"JPEG", "PNG"} or picture.mode != "RGB":
                    raise InvalidInput("Unsupported image format")
                width, height = picture.size
                if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                    raise InvalidInput("Image dimensions exceed limit")
                # Force decoding; detecting only a plausible magic header is insufficient.
                picture.load()
                return width, height
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise InvalidInput("Invalid image") from exc


def values(tensor):
    result = tensor.tolist() if hasattr(tensor, "tolist") else tensor
    if not isinstance(result, (list, tuple)):
        raise InvalidInput("Invalid model predictions")
    return result


def finite(value) -> float:
    if isinstance(value, bool):
        raise InvalidInput("Invalid numeric prediction")
    try:
        num = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise InvalidInput("Invalid numeric prediction") from exc
    if not math.isfinite(num):
        raise InvalidInput("Nonfinite numeric prediction")
    return num


def safe_label(names, class_id: int) -> str:
    value = None
    if isinstance(names, dict):
        value = names.get(class_id)
    elif isinstance(names, (list, tuple)) and class_id < len(names):
        value = names[class_id]
    return value if isinstance(value, str) and LABEL.fullmatch(value) else f"class_{class_id}"


def normalized_detections(result, width: int, height: int, threshold: float):
    original = getattr(result, "orig_shape", None)
    if not isinstance(original, (list, tuple)) or tuple(original) != (height, width):
        raise InvalidInput("Inference image dimensions changed")
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        raise InvalidInput("Missing model boxes")
    coords = values(boxes.xyxy)
    confidence = values(boxes.conf)
    classes = values(boxes.cls)
    if len(coords) > MAX_DETECTIONS or len(coords) != len(confidence) or len(coords) != len(classes):
        raise InvalidInput("Unbounded or inconsistent predictions")
    detections = []
    for coordinates, score, raw_class in zip(coords, confidence, classes):
        if not isinstance(coordinates, (list, tuple)) or len(coordinates) != 4:
            raise InvalidInput("Invalid bounding box")
        prob = finite(score)
        cid = finite(raw_class)
        if not 0 <= prob <= 1 or not cid.is_integer() or not 0 <= cid <= 9999:
            raise InvalidInput("Invalid class or confidence")
        x1, y1, x2, y2 = (finite(v) for v in coordinates)
        x1, x2 = max(0.0, min(x1, width)), max(0.0, min(x2, width))
        y1, y2 = max(0.0, min(y1, height)), max(0.0, min(y2, height))
        if x2 <= x1 or y2 <= y1:
            raise InvalidInput("Invalid bounding box geometry")
        if prob < threshold:
            continue
        class_id = int(cid)
        detections.append({
            "classId": class_id,
            "className": safe_label(getattr(result, "names", None), class_id),
            "confidence": round(prob, 5),
            "bboxXYXY": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
        })
    return detections


def analyze(image: str, model: str, *, confidence: float = 0.35,
            allow_pt: bool = False, model_factory=None, image_probe=None) -> dict:
    confidence = finite(confidence)
    if confidence < 0.05 or confidence > 0.95:
        raise InvalidInput("Confidence outside permitted range")
    image_path = local_file(image, {".jpg", ".jpeg", ".png"}, MAX_IMAGE_BYTES)
    model_path = local_file(model, {".onnx", ".pt"}, MAX_MODEL_BYTES)
    if model_path.suffix.lower() == ".pt" and not allow_pt:
        raise InvalidInput("PyTorch weights require explicit trusted-file opt-in")
    width, height = (image_probe or inspect_rgb)(image_path)
    if (not isinstance(width, int) or not isinstance(height, int)
            or width <= 0 or height <= 0 or width * height > MAX_PIXELS):
        raise InvalidInput("Invalid image dimensions")
    if model_factory is None:
        # Import only after input validation. Ultralytics is not bundled with SkyHub.
        from ultralytics import YOLO
        model_factory = YOLO
    detector = model_factory(str(model_path), task="detect")
    predictions = detector.predict(
        source=str(image_path), device="cpu", imgsz=640,
        conf=confidence, iou=0.45, max_det=MAX_DETECTIONS,
        verbose=False, save=False, stream=False,
    )
    if not isinstance(predictions, (tuple, list)) or len(predictions) != 1:
        raise InvalidInput("Expected one image result")
    detections = normalized_detections(predictions[0], width, height, confidence)
    return {
        "schema": SCHEMA,
        "status": "ok",
        "source": "offline-explicit-local-rgb",
        "image": {"width": width, "height": height},
        "modelFormat": model_path.suffix.lower().lstrip("."),
        "detections": detections,
        "detectionCount": len(detections),
        "defectVerified": False,
        "geolocationVerified": False,
        "multispectralReady": False,
        "flightControlReady": False,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Offline SkyHub YOLO11 RGB inspection preview")
    parser.add_argument("--image", required=True, help="Absolute path to local RGB JPEG/PNG")
    parser.add_argument("--model", required=True, help="Absolute path to reviewed local ONNX/PT model")
    parser.add_argument("--confidence", type=float, default=0.35)
    parser.add_argument("--allow-trusted-pt", action="store_true",
                        help="Permit locally reviewed PyTorch weights (may execute code on load)")
    args = parser.parse_args(argv)
    try:
        report = analyze(args.image, args.model, confidence=args.confidence,
                         allow_pt=args.allow_trusted_pt)
    except Exception:
        # Never send caller paths, EXIF, internal errors or model-loader text to output.
        print(json.dumps({"schema": SCHEMA, "status": "unavailable",
                          "detections": [], "detectionCount": 0}))
        return 2
    print(json.dumps(report, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
