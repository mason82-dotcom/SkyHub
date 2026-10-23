#!/usr/bin/env python3
"""Bounded, read-only DJI JPEG APP1/XMP marker evidence from a sealed capture.

No JPEG pixel decoding, GPS/RTK value extraction, DJI authenticity, EXIF
parsing, AGL inference, timestamp sync, MQTT, SDK, ROS, network or persistence.
The result is a privacy-redacted marker-presence report, never flight evidence.
"""
import argparse
import hmac
import os
from pathlib import Path
import re
import sys

import thermal_capture_calibration_offline as capture
import thermal_person_geolocation as geo
import thermal_person_provenance_offline as provenance

SCHEMA = "skyhub-thermal-dji-jpeg-marker-probe-v1"
MAX_SCAN = 262_144
MAX_SEGMENTS = 96
MAX_XMP = 32_768
XMP_PREFIX = b"http://ns.adobe.com/xap/1.0/\x00"
DJI_NAMESPACE = re.compile(
    rb"xmlns:drone-dji\s*=\s*['\"]http://www\.dji\.com/drone-dji/1\.0/['\"]")
XMP_CONTAINER = re.compile(rb"<(?:[a-zA-Z0-9_-]+:)?(?:xmpmeta|RDF)\b")
# Only whitelisted NAMES can exit. Their private VALUES must never leave RAM.
FIELD_NAMES = (
    "GPSLatitude", "GPSLongitude", "AbsoluteAltitude", "RelativeAltitude",
    "GimbalYawDegree", "GimbalPitchDegree", "GimbalRollDegree",
    "FlightYawDegree", "FlightPitchDegree", "FlightRollDegree",
    "GpsStatus", "RtkFlag", "CalibratedFocalLength", "ImageSource",
    "CameraSerialNumber", "DroneSerialNumber",
)
MARKERS = {
    name: re.compile(
        rb"(?:<|\s)drone-dji:" + name.encode("ascii") + rb"(?=[\s=/>])")
    for name in FIELD_NAMES
}


def _scan_jpeg(path):
    """Scan only contiguous header segments up to SOS, never image payload."""
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        with os.fdopen(fd, "rb") as f:
            scanned = 0
            def take(n):
                nonlocal scanned
                if n < 0 or scanned + n > MAX_SCAN:
                    raise geo.InvalidInput("jpeg_scan_budget_exceeded")
                data = f.read(n)
                scanned += len(data)
                if len(data) != n:
                    raise geo.InvalidInput("truncated_jpeg_header")
                return data
            if take(2) != b"\xff\xd8":
                raise geo.InvalidInput("invalid_jpeg_header")
            xmp = None
            exif = False
            seen_sos = False
            for _ in range(MAX_SEGMENTS):
                marker = take(2)
                if marker[0] != 255 or marker[1] in (0, 255):
                    raise geo.InvalidInput("invalid_jpeg_marker")
                kind = marker[1]
                if kind == 0xDA:  # SOS: never read compressed pixels.
                    seen_sos = True
                    break
                if kind == 0xD9:  # EOI without image data
                    raise geo.InvalidInput("invalid_jpeg_header")
                if kind in range(0xD0, 0xD8) or kind == 0x01:
                    continue
                size = int.from_bytes(take(2), "big")
                if size < 2:
                    raise geo.InvalidInput("invalid_jpeg_segment_size")
                size -= 2
                if size > MAX_SCAN - scanned:
                    raise geo.InvalidInput("jpeg_scan_budget_exceeded")
                # The segment is read once in tightly bounded memory.
                payload = take(size)
                if kind != 0xE1:
                    continue
                if payload.startswith(b"Exif\x00\x00"):
                    if exif:
                        raise geo.InvalidInput("duplicated_exif_marker")
                    exif = True
                if payload.startswith(XMP_PREFIX):
                    packet = payload[len(XMP_PREFIX):]
                    if xmp is not None or not 16 <= len(packet) <= MAX_XMP:
                        raise geo.InvalidInput("duplicate_or_oversized_xmp")
                    xmp = packet
            else:
                raise geo.InvalidInput("too_many_jpeg_header_segments")
            if not seen_sos:
                raise geo.InvalidInput("jpeg_no_scan_start")
    except OSError as error:
        raise geo.InvalidInput("unreadable_jpeg") from error
    return exif, xmp


def _marker_summary(packet):
    if packet is None:
        return "xmp-not-found-in-bounded-header", {n: False for n in FIELD_NAMES}, 0
    if (b"<!DOCTYPE" in packet.upper() or b"<!ENTITY" in packet.upper() or
            not XMP_CONTAINER.search(packet) or not DJI_NAMESPACE.search(packet)):
        return "dji-xmp-namespace-not-recognized", {n: False for n in FIELD_NAMES}, 0
    present = {}
    duplicate = 0
    for name, pattern in MARKERS.items():
        matches = list(pattern.finditer(packet))
        if len(matches) > 1:
            duplicate += 1
        present[name] = len(matches) == 1
    # Duplicated tags cannot be unambiguously interpreted as field evidence.
    return "dji-xmp-field-names-untrusted", present, duplicate


def inspect(source_media, capture_envelope, registry, profile_id,
            profile_sha256, derived_image, capture_key_file):
    """Full capture hash/HMAC gate first; bounded JPEG APP1 bytes second."""
    payload, _profile = capture.verify_capture(
        capture_envelope, source_media, derived_image, registry, profile_id,
        profile_sha256, capture_key_file)
    source = capture._source(source_media)
    if source.suffix.lower() not in (".jpg", ".jpeg"):
        return {
            "schema": SCHEMA,
            "status": "unsupported-media-format",
            "captureEnvelopeIntegrityVerified": True,
            "xmpBytePayloadVerified": False, "djiSensorOriginVerified": False,
            "positionVerified": False, "timeAlignmentVerified": False,
            "altitudeAglVerified": False, "gimbalPoseVerified": False,
            "radiometricCalibrationVerified": False, "geolocationVerified": False,
            "flightControlReady": False, "searchAndRescueReady": False,
            "exifMarkerPresent": False,
            "djiXmpFieldPresence": {n: False for n in FIELD_NAMES},
            "ambiguousDjiFieldNames": 0,
        }
    exif, xmp = _scan_jpeg(source)
    # A mutable file must not be accepted as evidence even if it changed
    # after the earlier capture seal check.
    if not hmac.compare_digest(
        provenance._digest_path(source, capture.MAX_SOURCE_BYTES),
        payload["sourceMediaSha256"]):
        raise geo.InvalidInput("source_changed_during_probe")
    status, fields, duplicates = _marker_summary(xmp)
    return {
        "schema": SCHEMA,
        "status": status, "captureEnvelopeIntegrityVerified": True,
        "xmpBytePayloadVerified": False, "djiSensorOriginVerified": False,
        "positionVerified": False, "timeAlignmentVerified": False,
        "altitudeAglVerified": False, "gimbalPoseVerified": False,
        "radiometricCalibrationVerified": False, "geolocationVerified": False,
        "flightControlReady": False, "searchAndRescueReady": False,
        "exifMarkerPresent": exif, "djiXmpFieldPresence": fields,
        "ambiguousDjiFieldNames": duplicates,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Read-only bounded JPEG/XMP field-presence probe; no GPS data")
    parser.add_argument("--media", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--profile-sha256", required=True)
    parser.add_argument("--capture-envelope", required=True)
    parser.add_argument("--capture-key-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--accept-reviewed-capture", action="store_true")
    args = parser.parse_args(argv)
    if not args.accept_reviewed_capture:
        parser.error("Explicit private capture-review opt-in required")
    try:
        result = inspect(
            args.media, geo._read_local_input(args.capture_envelope),
            geo._read_local_input(args.registry), args.profile_id,
            args.profile_sha256, args.image, args.capture_key_file)
        geo._write_local_output(args.output, result)
    except Exception:
        # No raw XMP, private tag values, serials, file paths or GPS on stdout.
        print("Media field-presence probe refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
