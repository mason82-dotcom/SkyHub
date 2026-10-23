#!/usr/bin/env python3
"""Explicit, local-only HMAC integrity envelope for thermal research frames.

A MAC ties bytes from an explicitly supplied image, reviewed model, detector
report and manually reviewed camera/pose object together. This does NOT
establish image sensor authenticity, truthful review, real persons, or
position accuracy. Never connect this to an automatic DJI/live path.
"""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import sys

import thermal_person_detector_offline as det
import thermal_person_geolocation as geo
import thermal_person_manual_handoff as handoff

SCHEMA = "skyhub-thermal-frame-integrity-envelope-v1"
OUTPUT_SCHEMA = "skyhub-thermal-integrity-geolocation-preview-v1"
DOMAIN = b"skyhub-thermal-frame-integrity-v1\x00"
MAX_KEY_BYTES = 32
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
PAYLOAD_KEYS = ("schema", "imageSha256", "modelSha256", "detectionReport", "review")
ENVELOPE_KEYS = PAYLOAD_KEYS + ("hmacSha256",)


def _hex(value):
    if type(value) is not str or HEX64.fullmatch(value) is None:
        raise geo.InvalidInput("invalid_digest")
    return value


def _canonical(payload):
    try:
        return json.dumps(payload, sort_keys=True, ensure_ascii=True,
                          allow_nan=False, separators=(",", ":")).encode("ascii")
    except (TypeError, ValueError, OverflowError) as error:
        raise geo.InvalidInput("invalid_integrity_payload") from error


def _digest_path(path, maximum):
    """Bound a local, regular, non-symlinked file; rehash its actual bytes."""
    path = Path(path)
    if not path.is_absolute() or path.is_symlink():
        raise geo.InvalidInput("invalid_integrity_file")
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as handle:
            before = os.fstat(handle.fileno())
            if (not stat.S_ISREG(before.st_mode) or
                    not 0 < before.st_size <= maximum):
                raise geo.InvalidInput("invalid_integrity_file")
            digest = hashlib.sha256()
            remaining = maximum
            while True:
                chunk = handle.read(min(1024 * 1024, remaining + 1))
                if not chunk:
                    break
                remaining -= len(chunk)
                if remaining < 0:
                    raise geo.InvalidInput("invalid_integrity_file")
                digest.update(chunk)
            after = os.fstat(handle.fileno())
            current = path.lstat()
            if (not stat.S_ISREG(current.st_mode) or
                    (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) !=
                    (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns)):
                raise geo.InvalidInput("changed_integrity_file")
            return digest.hexdigest()
    except OSError as error:
        raise geo.InvalidInput("invalid_integrity_file") from error


def _secret(key_file):
    path = Path(key_file)
    if not path.is_absolute() or path.is_symlink():
        raise geo.InvalidInput("invalid_key_file")
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_size != MAX_KEY_BYTES or
                    info.st_uid != os.geteuid() or info.st_mode & 0o077):
                raise geo.InvalidInput("invalid_key_file")
            secret = handle.read(MAX_KEY_BYTES + 1)
            if len(secret) != MAX_KEY_BYTES:
                raise geo.InvalidInput("invalid_key_file")
            return secret
    except OSError as error:
        raise geo.InvalidInput("invalid_key_file") from error


def _envelope_tag(payload, secret):
    return hmac.new(secret, DOMAIN + _canonical(payload), hashlib.sha256).hexdigest()


def seal(image, model, model_sha256, review, key_file, *,
         trusted_model=False, trusted_pt=False, accept_review=False,
         confidence=0.5, model_factory=None, image_probe=None):
    """Hash -> infer -> rehash -> validate review -> MAC exact envelope.

    Even with dual hashes there is a small TOCTOU window if an attacker can
    modify source files. Run only with private, read-only staged inputs.
    """
    if trusted_model is not True or accept_review is not True:
        raise geo.InvalidInput("explicit_review_required")
    expected = _hex(model_sha256)
    key = _secret(key_file)
    image_path = det.local_file(image, {".jpg", ".jpeg", ".png"}, det.MAX_IMAGE_BYTES)
    model_path = det.local_file(model, {".onnx", ".pt"}, det.MAX_MODEL_BYTES)
    before_image = _digest_path(image_path, det.MAX_IMAGE_BYTES)
    before_model = _digest_path(model_path, det.MAX_MODEL_BYTES)
    if not hmac.compare_digest(before_model, expected):
        raise geo.InvalidInput("unreviewed_model")
    # Never generate new review approvals inside this worker.
    geo._object(review, handoff._REVIEW_KEYS)
    report = det.analyze(
        str(image_path), str(model_path), trusted_model=True,
        trusted_pt=trusted_pt, model_sha256=expected,
        confidence=confidence, model_factory=model_factory,
        image_probe=image_probe,
    )
    if (not hmac.compare_digest(_digest_path(image_path, det.MAX_IMAGE_BYTES), before_image)
            or not hmac.compare_digest(_digest_path(model_path, det.MAX_MODEL_BYTES), before_model)):
        raise geo.InvalidInput("input_changed_during_detection")
    # This validates the exact detector report and independent geometry/pose
    # review before any signature is created. Location result is discarded.
    handoff.reviewed_projection({
        "schema": handoff.INPUT_SCHEMA,
        "detectionReport": report, "review": review,
    })
    payload = {
        "schema": SCHEMA,
        "imageSha256": before_image,
        "modelSha256": before_model,
        "detectionReport": report,
        "review": review,
    }
    return {**payload, "hmacSha256": _envelope_tag(payload, key)}


def verify_and_project(envelope, image, model, expected_model_sha256, key_file):
    """Check MAC, exact local bytes and complete manual handoff before GPS math."""
    geo._object(envelope, ENVELOPE_KEYS)
    payload = {key: envelope[key] for key in PAYLOAD_KEYS}
    if payload["schema"] != SCHEMA:
        raise geo.InvalidInput("invalid_integrity_schema")
    _hex(payload["imageSha256"])
    _hex(payload["modelSha256"])
    supplied = _hex(envelope["hmacSha256"])
    expected = _hex(expected_model_sha256)
    key = _secret(key_file)
    if not hmac.compare_digest(_envelope_tag(payload, key), supplied):
        raise geo.InvalidInput("integrity_signature_mismatch")
    if not hmac.compare_digest(payload["modelSha256"], expected):
        raise geo.InvalidInput("model_not_approved")
    image_path = det.local_file(image, {".jpg", ".jpeg", ".png"}, det.MAX_IMAGE_BYTES)
    model_path = det.local_file(model, {".onnx", ".pt"}, det.MAX_MODEL_BYTES)
    if (not hmac.compare_digest(_digest_path(image_path, det.MAX_IMAGE_BYTES),
                                payload["imageSha256"]) or
            not hmac.compare_digest(_digest_path(model_path, det.MAX_MODEL_BYTES),
                                    payload["modelSha256"])):
        raise geo.InvalidInput("integrity_file_mismatch")
    if payload["detectionReport"]["modelFormat"] != model_path.suffix.lower().lstrip("."):
        raise geo.InvalidInput("model_format_mismatch")
    report = handoff.reviewed_projection({
        "schema": handoff.INPUT_SCHEMA,
        "detectionReport": payload["detectionReport"],
        "review": payload["review"],
    })
    return {
        "schema": OUTPUT_SCHEMA, "status": report["status"],
        "envelopeIntegrityVerified": True, "imageBytesMatch": True,
        "modelBytesMatch": True,
        "frameSensorOriginVerified": False, "manualReviewIndependentlyVerified": False,
        "geolocationVerified": False, "accuracyMetersVerified": False,
        "personPresenceVerified": False, "trackingVerified": False,
        "flightControlReady": False, "searchAndRescueReady": False,
        "candidateCount": report["candidateCount"], "estimates": report["estimates"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Isolated local thermal integrity proof")
    sub = parser.add_subparsers(dest="action", required=True)
    for name in ("seal", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--image", required=True)
        p.add_argument("--model", required=True)
        p.add_argument("--model-sha256", required=True)
        p.add_argument("--key-file", required=True)
        p.add_argument("--output", required=True)
        p.add_argument("--accept-reviewed-handoff", action="store_true")
        p.add_argument("--allow-sensitive-location-output", action="store_true")
        if name == "seal":
            p.add_argument("--review", required=True)
            p.add_argument("--trust-local-model", action="store_true")
            p.add_argument("--allow-trusted-pt", action="store_true")
        else:
            p.add_argument("--envelope", required=True)
    args = parser.parse_args(argv)
    if not (args.accept_reviewed_handoff and args.allow_sensitive_location_output):
        parser.error("Two explicit offline, sensitive-location opt-ins are required")
    try:
        if args.action == "seal":
            bundle = seal(
                args.image, args.model, args.model_sha256,
                geo._read_local_input(args.review), args.key_file,
                trusted_model=args.trust_local_model,
                trusted_pt=args.allow_trusted_pt, accept_review=True,
            )
            geo._write_local_output(args.output, bundle)
        else:
            result = verify_and_project(
                geo._read_local_input(args.envelope), args.image,
                args.model, args.model_sha256, args.key_file,
            )
            geo._write_local_output(args.output, result)
    except Exception:
        # Never log file paths, key material, raw pose, image or internal model errors.
        print("Integrity operation refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
