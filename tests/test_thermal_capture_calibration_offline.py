"""Offline M3T/M4T pinned calibration and private source-media integrity tests.

All data are synthetic; no DJI export, optics measurement or thermal weights.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_capture_calibration_offline",
    WORKERS / "thermal_capture_calibration_offline.py")
cal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cal)

from test_thermal_person_manual_handoff import input_payload
from test_thermal_person_provenance_offline import MockModel


class CaptureCalibrationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.image = self.root / "image.png"
        self.image.write_bytes(b"private derived 8-bit synthetic thermal frame")
        self.media = self.root / "raw-source.jpg"
        self.media.write_bytes(b"synthetic raw DJI-like input; NOT a verified DJI image")
        self.model = self.root / "reviewed.onnx"
        self.model.write_bytes(b"reviewed test weights")
        self.model_sha = hashlib.sha256(self.model.read_bytes()).hexdigest()
        self.capture_key = self.root / "capture-secret.bin"
        self.capture_key.write_bytes(b"C" * 32)
        self.capture_key.chmod(0o600)
        self.detection_key = self.root / "detector-secret.bin"
        self.detection_key.write_bytes(b"D" * 32)
        self.detection_key.chmod(0o600)
        self.review = input_payload()["review"]
        self.profile = {
            "profileId": "M4T_thermal_test_cal_1",
            "revision": 1,
            "aircraftModel": "Matrice 4T",
            "sensor": "thermal",
            "frame": copy.deepcopy(self.review["frame"]),
            "camera": copy.deepcopy(self.review["camera"]),
            "evidence": {
                "kind": "independent-offline-camera-calibration",
                "evidenceSha256": hashlib.sha256(b"dummy unsigned calibration test").hexdigest(),
                "reviewId": "SYNTHETIC_REVIEW_01",
                "calibrationExternallyReviewed": True,
            },
        }
        self.profile["camera"]["calibrationId"] = self.profile["profileId"]
        self.review["camera"]["calibrationId"] = self.profile["profileId"]
        self.registry = {"schema": cal.REGISTRY_SCHEMA,
                         "profiles": [copy.deepcopy(self.profile)]}
        self.profile_sha = self.profile_digest()
        self.capture_review = {
            "aircraftModel": "Matrice 4T",
            "frameTimestampMs": self.review["timestampMs"],
            "sourceMediaReviewed": True,
            "frameDerivationReviewed": True,
            "pixelMappingReviewed": True,
        }

    def profile_digest(self):
        return hashlib.sha256(cal.provenance._canonical(self.profile)).hexdigest()

    def seal_capture(self):
        return cal.seal_capture(
            str(self.media), str(self.image), copy.deepcopy(self.registry),
            self.profile["profileId"], self.profile_sha,
            copy.deepcopy(self.capture_review), str(self.capture_key),
            accept_capture=True)

    def seal_detection(self):
        return cal.provenance.seal(
            str(self.image), str(self.model), self.model_sha,
            copy.deepcopy(self.review), str(self.detection_key),
            trusted_model=True, accept_review=True,
            image_probe=lambda *_a: (640, 512),
            model_factory=lambda *_a, **_k: MockModel())

    def project(self, cap=None, det=None, *, registry=None, expected_profile=None,
                capture_key=None, detection_key=None):
        return cal.verify_bound_projection(
            self.seal_capture() if cap is None else cap,
            self.seal_detection() if det is None else det,
            copy.deepcopy(self.registry) if registry is None else registry,
            self.profile["profileId"],
            self.profile_sha if expected_profile is None else expected_profile,
            str(self.media), str(self.image), str(self.model), self.model_sha,
            str(self.capture_key) if capture_key is None else capture_key,
            str(self.detection_key) if detection_key is None else detection_key)

    def test_complete_two_key_two_envelope_chain(self):
        report = self.project()
        self.assertEqual(report["schema"], cal.OUTPUT_SCHEMA)
        self.assertEqual(report["candidateCount"], 1)
        self.assertEqual(report["estimates"][0]["trackId"], 98)
        for flag in ("captureEnvelopeIntegrityVerified",
                     "detectionEnvelopeIntegrityVerified",
                     "calibrationProfileDigestVerified",
                     "sourceMediaBytesMatch", "derivedFrameBytesMatch"):
            self.assertIs(report[flag], True)
        for flag in ("djiSensorOriginVerified", "thermalRadiometryVerified",
                     "calibrationGroundTruthVerified", "geolocationVerified",
                     "accuracyMetersVerified", "personPresenceVerified",
                     "trackingVerified", "flightControlReady",
                     "searchAndRescueReady"):
            self.assertIs(report[flag], False)
        self.assertNotIn("sourceMediaSha256", report)
        self.assertNotIn("timestampMs", report)
        self.assertNotIn("camera", report)
        self.assertNotIn("review", report)

    def test_registry_no_synthetic_defaults(self):
        self.assertRaises(cal.geo.InvalidInput, cal.validate_registry,
                          {"schema": cal.REGISTRY_SCHEMA, "profiles": []},
                          self.profile["profileId"], self.profile_sha)

    def test_calibration_requires_independently_pinned_profile_hash(self):
        for wrong in ("0" * 64, "F" * 64, "", None):
            with self.subTest(wrong=wrong), self.assertRaises(cal.geo.InvalidInput):
                cal.validate_registry(self.registry,
                                      self.profile["profileId"], wrong)

    def test_tampering_fov_or_revision_breaks_pin(self):
        for mutate in (
            lambda p: p["camera"].update(horizontalFovDeg=42),
            lambda p: p.update(revision=2),
            lambda p: p["evidence"].update(reviewId="CHANGED_0000001"),
            lambda p: p["frame"].update(width=720),
        ):
            data = copy.deepcopy(self.registry)
            mutate(data["profiles"][0])
            with self.assertRaises(cal.geo.InvalidInput):
                cal.validate_registry(data, self.profile["profileId"],
                                      self.profile_sha)

    def test_registry_unknown_and_duplicate_profiles_refused(self):
        data = copy.deepcopy(self.registry)
        data["profiles"].append(copy.deepcopy(self.profile))
        with self.assertRaises(cal.geo.InvalidInput):
            cal.validate_registry(data, self.profile["profileId"], self.profile_sha)
        data = copy.deepcopy(self.registry)
        data["profiles"][0]["PRIVATE_LOCATION"] = "hidden"
        with self.assertRaises(cal.geo.InvalidInput):
            cal.validate_registry(data, self.profile["profileId"], self.profile_sha)

    def test_reject_unverified_or_unknown_camera_models(self):
        for name in ("Mavic 3M", "Mavic 3T++", "Matrice 3T"):
            data = copy.deepcopy(self.registry)
            data["profiles"][0]["aircraftModel"] = name
            with self.assertRaises(cal.geo.InvalidInput):
                cal.validate_registry(data, self.profile["profileId"], self.profile_sha)
        data = copy.deepcopy(self.registry)
        data["profiles"][0]["evidence"]["calibrationExternallyReviewed"] = False
        with self.assertRaises(cal.geo.InvalidInput):
            cal.validate_registry(data, self.profile["profileId"], self.profile_sha)

    def test_registry_can_label_m3t_without_trusting_model_specific_fov(self):
        self.profile["aircraftModel"] = "Mavic 3T"
        self.registry["profiles"] = [copy.deepcopy(self.profile)]
        self.profile_sha = self.profile_digest()
        self.capture_review["aircraftModel"] = "Mavic 3T"
        result = self.project()
        self.assertEqual(result["candidateCount"], 1)
        self.assertFalse(result["calibrationGroundTruthVerified"])

    def test_changed_media_after_signing_refused(self):
        cap = self.seal_capture()
        det = self.seal_detection()
        self.media.write_bytes(b"new source media")
        with self.assertRaisesRegex(cal.geo.InvalidInput,
                                    "source_media_bytes_changed"):
            self.project(cap=cap, det=det)

    def test_changed_image_after_signing_refused(self):
        cap = self.seal_capture()
        det = self.seal_detection()
        self.image.write_bytes(b"new derived frame")
        with self.assertRaises(cal.geo.InvalidInput):
            self.project(cap=cap, det=det)

    def test_capture_manifest_fields_hmac_tamper_refused(self):
        mutations = (
            lambda x: x["review"].update(frameTimestampMs=x["review"]["frameTimestampMs"] + 1),
            lambda x: x.update(profileId="DIFFERENT_PROFILE"),
            lambda x: x.update(imageSha256="0" * 64),
            lambda x: x.update(hmacSha256="0" * 64),
            lambda x: x["review"].update(sourceMediaReviewed=False),
        )
        det = self.seal_detection()
        for mutate in mutations:
            with self.subTest(mutate=str(mutate)):
                cap = self.seal_capture()
                mutate(cap)
                with self.assertRaises(cal.geo.InvalidInput):
                    self.project(cap=cap, det=det)

    def test_detection_camera_mismatch_even_if_hmac_valid(self):
        det = self.seal_detection()
        det["review"]["camera"]["horizontalFovDeg"] = 55
        payload = {key: det[key] for key in cal.provenance.PAYLOAD_KEYS}
        det["hmacSha256"] = cal.provenance._envelope_tag(
            payload, cal.provenance._secret(str(self.detection_key)))
        with self.assertRaisesRegex(cal.geo.InvalidInput,
                                    "capture_calibration_frame_mismatch"):
            self.project(det=det)

    def test_capture_clock_diff_even_with_valid_signatures(self):
        cap = self.seal_capture()
        cap["review"]["frameTimestampMs"] += 999
        payload = {key: cap[key] for key in cal.CAPTURE_PAYLOAD_KEYS}
        cap["hmacSha256"] = cal._capture_mac(
            payload, cal.provenance._secret(str(self.capture_key)))
        with self.assertRaisesRegex(cal.geo.InvalidInput,
                                    "capture_calibration_frame_mismatch"):
            self.project(cap=cap)

    def test_derived_frame_tamper_cannot_be_fixed_by_resealing_one_manifest(self):
        cap = self.seal_capture()
        det = self.seal_detection()
        self.image.write_bytes(b"altered frame")
        new_cap = self.seal_capture()
        with self.assertRaises(cal.geo.InvalidInput):
            self.project(cap=new_cap, det=det)

    def test_capture_issuer_must_be_separate_from_detection_issuer(self):
        with self.assertRaisesRegex(cal.geo.InvalidInput,
                                    "capture_and_detector_keys_must_be_distinct"):
            self.project(detection_key=str(self.capture_key))

    def test_capture_requires_explicit_review(self):
        with self.assertRaises(cal.geo.InvalidInput):
            cal.seal_capture(
                str(self.media), str(self.image), self.registry,
                self.profile["profileId"], self.profile_sha,
                self.capture_review, str(self.capture_key), accept_capture=False)
        self.capture_review["frameDerivationReviewed"] = False
        with self.assertRaises(cal.geo.InvalidInput):
            self.seal_capture()

    def test_source_and_derivative_must_be_distinct_files(self):
        with self.assertRaises(cal.geo.InvalidInput):
            cal.seal_capture(
                str(self.image), str(self.image), self.registry,
                self.profile["profileId"], self.profile_sha,
                self.capture_review, str(self.capture_key), accept_capture=True)

    def test_verify_does_not_access_model_before_capture_checks_pass(self):
        cap = self.seal_capture()
        self.media.write_bytes(b"modified")
        with patch.object(cal.provenance, "verify_and_project",
                          side_effect=AssertionError("should not run")):
            with self.assertRaises(cal.geo.InvalidInput):
                self.project(cap=cap, det=self.seal_detection())

    def test_private_cli_capture_seal_output(self):
        registry = self.root / "registry.json"
        review = self.root / "review.json"
        output = self.root / "capture-envelope.json"
        registry.write_text(json.dumps(self.registry), encoding="utf-8")
        review.write_text(json.dumps(self.capture_review), encoding="utf-8")
        args = [
            "seal-capture", "--media", str(self.media),
            "--image", str(self.image), "--registry", str(registry),
            "--profile-id", self.profile["profileId"],
            "--profile-sha256", self.profile_sha,
            "--capture-key-file", str(self.capture_key),
            "--capture-review", str(review), "--output", str(output),
            "--accept-reviewed-capture", "--allow-sensitive-location-output",
        ]
        self.assertEqual(cal.main(args), 0)
        self.assertEqual(json.loads(output.read_text())["schema"], cal.CAPTURE_SCHEMA)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(cal.main(args), 2)

    def test_no_capture_approved_if_output_false_flags_changed(self):
        result = self.project()
        for key in ("geolocationVerified", "djiSensorOriginVerified",
                    "calibrationGroundTruthVerified", "searchAndRescueReady"):
            self.assertFalse(result[key])


if __name__ == "__main__":
    unittest.main()
