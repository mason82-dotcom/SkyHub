#!/usr/bin/env python3
"""Manual DJI-media chain-of-custody and pinned thermal calibration (offline).

This worker neither parses DJI telemetry nor authenticates the aircraft/sensor.
HMAC binds locally reviewed source-media bytes, extracted image, an externally
pinned calibration profile, and the independently HMAC-sealed detector review.
Nothing is enabled in the SkyHub application or exposed over a network.
"""
import argparse
import hashlib
import hmac
import json
import re
import sys

import thermal_person_detector_offline as detector
import thermal_person_geolocation as geo
import thermal_person_provenance_offline as provenance

REGISTRY_SCHEMA = "skyhub-thermal-camera-calibration-registry-v1"
CAPTURE_SCHEMA = "skyhub-thermal-source-capture-envelope-v1"
OUTPUT_SCHEMA = "skyhub-thermal-calibrated-capture-preview-v1"
CAPTURE_DOMAIN = b"skyhub-thermal-dji-media-capture-v1\x00"
MAX_SOURCE_BYTES = 512 * 1024 * 1024
MODELS = ("Mavic 3T", "Matrice 4T")
SENSOR = "thermal"
PROFILE_KEYS = ("profileId", "revision", "aircraftModel", "sensor",
                "frame", "camera", "evidence")
EVIDENCE_KEYS = ("kind", "evidenceSha256", "reviewId",
                 "calibrationExternallyReviewed")
REVIEW_KEYS = ("aircraftModel", "frameTimestampMs", "sourceMediaReviewed",
               "frameDerivationReviewed", "pixelMappingReviewed")
CAPTURE_PAYLOAD_KEYS = ("schema", "sourceMediaSha256", "imageSha256",
                        "profileSha256", "profileId", "review")
CAPTURE_KEYS = CAPTURE_PAYLOAD_KEYS + ("hmacSha256",)


def validate_registry(registry, profile_id, expected_sha256):
    """Select one pinned, independent calibration; never invent FOV defaults."""
    geo._object(registry, ("schema", "profiles"))
    if registry["schema"] != REGISTRY_SCHEMA:
        raise geo.InvalidInput("invalid_calibration_registry")
    profiles = registry["profiles"]
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 64:
        raise geo.InvalidInput("empty_or_oversized_registry")
    if (type(profile_id) is not str or
            re.fullmatch(r"[A-Za-z0-9_-]{1,64}", profile_id) is None):
        raise geo.InvalidInput("invalid_profile_id")
    pinned = provenance._hex(expected_sha256)
    seen = set()
    selected = None
    for profile in profiles:
        geo._object(profile, PROFILE_KEYS)
        pid = profile["profileId"]
        if (type(pid) is not str or
                re.fullmatch(r"[A-Za-z0-9_-]{1,64}", pid) is None or pid in seen):
            raise geo.InvalidInput("invalid_or_duplicate_profile")
        seen.add(pid)
        geo._integer(profile["revision"], 1, 2_147_483_647)
        if profile["aircraftModel"] not in MODELS or profile["sensor"] != SENSOR:
            raise geo.InvalidInput("unsupported_sensor")
        geo._camera(profile["frame"], profile["camera"])
        if profile["camera"]["calibrationId"] != pid:
            raise geo.InvalidInput("profile_calibration_mismatch")
        evidence = geo._object(profile["evidence"], EVIDENCE_KEYS)
        if evidence["kind"] != "independent-offline-camera-calibration":
            raise geo.InvalidInput("unsupported_calibration_evidence")
        provenance._hex(evidence["evidenceSha256"])
        rid = evidence["reviewId"]
        if (type(rid) is not str or
                re.fullmatch(r"[A-Za-z0-9_-]{8,64}", rid) is None):
            raise geo.InvalidInput("invalid_calibration_review")
        geo._true(evidence["calibrationExternallyReviewed"])
        if pid == profile_id:
            selected = profile
    if selected is None:
        raise geo.InvalidInput("unknown_calibration_profile")
    digest = hashlib.sha256(provenance._canonical(selected)).hexdigest()
    if not hmac.compare_digest(digest, pinned):
        raise geo.InvalidInput("calibration_profile_digest_mismatch")
    return selected


def _capture_payload(review, profile, source_sha256, image_sha256,
                     profile_sha256):
    geo._object(review, REVIEW_KEYS)
    if review["aircraftModel"] != profile["aircraftModel"]:
        raise geo.InvalidInput("capture_aircraft_mismatch")
    geo._integer(review["frameTimestampMs"], 1_000_000_000_000, 9_999_999_999_999)
    for flag in ("sourceMediaReviewed", "frameDerivationReviewed",
                 "pixelMappingReviewed"):
        geo._true(review[flag])
    return {
        "schema": CAPTURE_SCHEMA,
        "sourceMediaSha256": source_sha256,
        "imageSha256": image_sha256,
        "profileSha256": profile_sha256,
        "profileId": profile["profileId"],
        "review": review,
    }


def _capture_mac(payload, secret):
    return hmac.new(secret, CAPTURE_DOMAIN + provenance._canonical(payload),
                    hashlib.sha256).hexdigest()


def _source(media):
    # Treat source as opaque bytes: we do not parse R-JPEG, MP4, SRT or XMP.
    return detector.local_file(media, {".jpg", ".jpeg", ".mp4", ".mov",
                                       ".tif", ".tiff"}, MAX_SOURCE_BYTES)


def seal_capture(media, image, registry, profile_id, expected_profile_sha256,
                 capture_review, capture_key_file, *, accept_capture=False):
    """Produce a private, local-review HMAC attestation, not a DJI signature."""
    if accept_capture is not True:
        raise geo.InvalidInput("capture_review_opt_in_required")
    profile = validate_registry(registry, profile_id, expected_profile_sha256)
    secret = provenance._secret(capture_key_file)
    media_path = _source(media)
    image_path = detector.local_file(
        image, {".jpg", ".jpeg", ".png"}, detector.MAX_IMAGE_BYTES)
    if media_path == image_path or media_path.samefile(image_path):
        raise geo.InvalidInput("source_and_frame_must_be_distinct")
    media_hash = provenance._digest_path(media_path, MAX_SOURCE_BYTES)
    image_hash = provenance._digest_path(image_path, detector.MAX_IMAGE_BYTES)
    payload = _capture_payload(capture_review, profile, media_hash, image_hash,
                               expected_profile_sha256)
    return {**payload, "hmacSha256": _capture_mac(payload, secret)}


def verify_capture(envelope, media, image, registry, profile_id,
                   expected_profile_sha256, capture_key_file):
    profile = validate_registry(registry, profile_id, expected_profile_sha256)
    geo._object(envelope, CAPTURE_KEYS)
    payload = {field: envelope[field] for field in CAPTURE_PAYLOAD_KEYS}
    if payload["schema"] != CAPTURE_SCHEMA or payload["profileId"] != profile_id:
        raise geo.InvalidInput("invalid_capture_envelope")
    for field in ("sourceMediaSha256", "imageSha256", "profileSha256"):
        provenance._hex(payload[field])
    supplied_mac = provenance._hex(envelope["hmacSha256"])
    key = provenance._secret(capture_key_file)
    if not hmac.compare_digest(_capture_mac(payload, key), supplied_mac):
        raise geo.InvalidInput("capture_hmac_mismatch")
    if not hmac.compare_digest(payload["profileSha256"], expected_profile_sha256):
        raise geo.InvalidInput("capture_profile_mismatch")
    # A valid local HMAC cannot automatically establish trustworthy source
    # metadata or camera provenance, so require complete review again.
    _capture_payload(payload["review"], profile, payload["sourceMediaSha256"],
                     payload["imageSha256"], payload["profileSha256"])
    media_path = _source(media)
    image_path = detector.local_file(
        image, {".jpg", ".jpeg", ".png"}, detector.MAX_IMAGE_BYTES)
    if media_path == image_path or media_path.samefile(image_path):
        raise geo.InvalidInput("source_and_frame_must_be_distinct")
    if (not hmac.compare_digest(
            provenance._digest_path(media_path, MAX_SOURCE_BYTES),
            payload["sourceMediaSha256"]) or
            not hmac.compare_digest(
                provenance._digest_path(image_path, detector.MAX_IMAGE_BYTES),
                payload["imageSha256"])):
        raise geo.InvalidInput("source_media_bytes_changed")
    return payload, profile


def verify_bound_projection(capture_envelope, detection_envelope, registry,
                            profile_id, expected_profile_sha256, media, image,
                            model, expected_model_sha256, capture_key_file,
                            detection_key_file):
    """Require *both* independent local seals and the externally pinned FOV."""
    cap, profile = verify_capture(
        capture_envelope, media, image, registry, profile_id,
        expected_profile_sha256, capture_key_file)
    if hmac.compare_digest(provenance._secret(capture_key_file),
                           provenance._secret(detection_key_file)):
        raise geo.InvalidInput("capture_and_detector_keys_must_be_distinct")
    # The detector envelope HMAC is verified by its worker, but its review
    # metadata must first match the separately pinned optics + capture epoch.
    geo._object(detection_envelope, provenance.ENVELOPE_KEYS)
    review = detection_envelope["review"]
    geo._object(review, ("timestampMs", "frame", "camera", "telemetry",
                         "pixelTransform", "sourceFrameReviewed", "modelReviewed",
                         "opticalGeometryReviewed", "detectionsReviewed",
                         "trackAssignments"))
    if (review["timestampMs"] != cap["review"]["frameTimestampMs"] or
            review["frame"] != profile["frame"] or
            review["camera"] != profile["camera"] or
            review["pixelTransform"] != "identity-undistorted-full-frame"):
        raise geo.InvalidInput("capture_calibration_frame_mismatch")
    if not hmac.compare_digest(
            provenance._hex(detection_envelope["imageSha256"]),
            cap["imageSha256"]):
        raise geo.InvalidInput("capture_detection_image_mismatch")
    result = provenance.verify_and_project(
        detection_envelope, image, model, expected_model_sha256,
        detection_key_file)
    return {
        "schema": OUTPUT_SCHEMA, "status": result["status"],
        "captureEnvelopeIntegrityVerified": True,
        "detectionEnvelopeIntegrityVerified": True,
        "calibrationProfileDigestVerified": True,
        "sourceMediaBytesMatch": True, "derivedFrameBytesMatch": True,
        "djiSensorOriginVerified": False,
        "thermalRadiometryVerified": False,
        "calibrationGroundTruthVerified": False,
        "geolocationVerified": False, "accuracyMetersVerified": False,
        "personPresenceVerified": False, "trackingVerified": False,
        "flightControlReady": False, "searchAndRescueReady": False,
        "candidateCount": result["candidateCount"],
        "estimates": result["estimates"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Offline only: manually reviewed source media and pinned optics")
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("seal-capture", "verify"):
        p = sub.add_parser(action)
        p.add_argument("--media", required=True)
        p.add_argument("--image", required=True)
        p.add_argument("--registry", required=True)
        p.add_argument("--profile-id", required=True)
        p.add_argument("--profile-sha256", required=True)
        p.add_argument("--capture-key-file", required=True)
        p.add_argument("--output", required=True)
        p.add_argument("--accept-reviewed-capture", action="store_true")
        p.add_argument("--allow-sensitive-location-output", action="store_true")
        if action == "seal-capture":
            p.add_argument("--capture-review", required=True)
        else:
            p.add_argument("--capture-envelope", required=True)
            p.add_argument("--detection-envelope", required=True)
            p.add_argument("--model", required=True)
            p.add_argument("--model-sha256", required=True)
            p.add_argument("--detection-key-file", required=True)
    args = parser.parse_args(argv)
    if not (args.accept_reviewed_capture and args.allow_sensitive_location_output):
        parser.error("Explicit capture review and sensitive-output opt-in required")
    try:
        registry = geo._read_local_input(args.registry)
        if args.action == "seal-capture":
            result = seal_capture(
                args.media, args.image, registry, args.profile_id,
                args.profile_sha256, geo._read_local_input(args.capture_review),
                args.capture_key_file, accept_capture=True)
        else:
            result = verify_bound_projection(
                geo._read_local_input(args.capture_envelope),
                geo._read_local_input(args.detection_envelope),
                registry, args.profile_id, args.profile_sha256,
                args.media, args.image, args.model, args.model_sha256,
                args.capture_key_file, args.detection_key_file)
        geo._write_local_output(args.output, result)
    except Exception:
        # No raw location, hashes, reviewer identities or sensitive paths to logs.
        print("Offline capture/calibration check refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
