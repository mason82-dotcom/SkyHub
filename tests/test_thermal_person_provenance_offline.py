"""Private HMAC frame provenance contract; mocks, no models, hardware or network."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_person_provenance_offline",
    WORKERS / "thermal_person_provenance_offline.py")
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)

from test_thermal_person_manual_handoff import input_payload


class MockPrediction:
    orig_shape = (512, 640)
    names = {0: "person"}
    boxes = type("Boxes", (), {
        "xyxy": [[310, 246, 330, 266]],
        "conf": [0.95],
        "cls": [0],
    })()


class MockModel:
    def __init__(self, before_return=None):
        self.before_return = before_return

    def predict(self, **kwargs):
        if self.before_return:
            self.before_return()
        return [MockPrediction()]


class HmacProvenanceTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.image = self.root / "thermal-frame.png"
        self.image.write_bytes(b"synthetic private 8-bit image reviewed by mock")
        self.model = self.root / "person.onnx"
        self.model.write_bytes(b"reviewed mock model artifact")
        self.key = self.root / "issuer.key"
        self.key.write_bytes(b"S" * 32)
        self.key.chmod(0o600)
        self.model_sha = hashlib.sha256(self.model.read_bytes()).hexdigest()
        self.review = input_payload()["review"]

    def seal(self, **options):
        opts = {"image_probe": lambda _: (640, 512),
                "model_factory": lambda *_args, **_kwargs: MockModel()}
        opts.update(options)
        return proof.seal(str(self.image), str(self.model),
                          self.model_sha, copy.deepcopy(self.review),
                          str(self.key), trusted_model=True, accept_review=True,
                          **opts)

    def verify(self, envelope):
        return proof.verify_and_project(envelope, str(self.image),
                                        str(self.model), self.model_sha, str(self.key))

    def test_binding_valid_but_sar_and_location_always_unverified(self):
        bundle = self.seal()
        result = self.verify(bundle)
        self.assertEqual(result["candidateCount"], 1)
        self.assertEqual(result["estimates"][0]["trackId"], 98)
        self.assertTrue(result["envelopeIntegrityVerified"])
        self.assertTrue(result["imageBytesMatch"])
        self.assertTrue(result["modelBytesMatch"])
        for key in ("frameSensorOriginVerified", "manualReviewIndependentlyVerified",
                    "geolocationVerified", "accuracyMetersVerified",
                    "personPresenceVerified", "trackingVerified",
                    "flightControlReady", "searchAndRescueReady"):
            self.assertIs(result[key], False)
        self.assertNotIn("imageSha256", result)
        self.assertNotIn("modelSha256", result)
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_tamper_any_bound_component_refused(self):
        changes = [
            ("imageSha256", lambda x: x.update(imageSha256="0" * 64)),
            ("modelSha256", lambda x: x.update(modelSha256="0" * 64)),
            ("hmacSha256", lambda x: x.update(hmacSha256="0" * 64)),
            ("detectionReport", lambda x: x["detectionReport"]["detections"][0].update(confidence=0.8)),
            ("review", lambda x: x["review"]["camera"].update(horizontalFovDeg=45.0)),
            ("timestamp", lambda x: x["review"].update(timestampMs=x["review"]["timestampMs"] + 1)),
            ("telemetry", lambda x: x["review"]["telemetry"].update(latitude=50.0)),
            ("trackAssignment", lambda x: x["review"]["trackAssignments"][0].update(trackId=99)),
        ]
        for label, mutation in changes:
            with self.subTest(label=label):
                envelope = self.seal()
                mutation(envelope)
                with self.assertRaises(proof.geo.InvalidInput):
                    self.verify(envelope)

    def test_image_changes_after_seal_refused(self):
        bundle = self.seal()
        self.image.write_bytes(b"synthetic overwritten source image")
        with self.assertRaisesRegex(proof.geo.InvalidInput, "integrity_file_mismatch"):
            self.verify(bundle)

    def test_model_changes_after_seal_refused(self):
        bundle = self.seal()
        self.model.write_bytes(b"changed weight artifact")
        with self.assertRaises(proof.geo.InvalidInput):
            self.verify(bundle)

    def test_envelope_signed_by_different_key_rejected(self):
        bundle = self.seal()
        self.key.write_bytes(b"T" * 32)
        with self.assertRaisesRegex(proof.geo.InvalidInput, "integrity_signature_mismatch"):
            self.verify(bundle)

    def test_seal_rejects_mutated_image_during_inference(self):
        def mutate():
            self.image.write_bytes(b"mutated frame during inference")
        with self.assertRaisesRegex(proof.geo.InvalidInput, "input_changed_during_detection"):
            self.seal(model_factory=lambda *_a, **_k: MockModel(mutate))

    def test_seal_rejects_mutated_model_during_inference(self):
        def mutate():
            self.model.write_bytes(b"changed during model inference")
        with self.assertRaisesRegex(proof.geo.InvalidInput, "input_changed_during_detection"):
            self.seal(model_factory=lambda *_a, **_k: MockModel(mutate))

    def test_missing_approvals_cannot_seal(self):
        with self.assertRaises(proof.geo.InvalidInput):
            proof.seal(str(self.image), str(self.model), self.model_sha,
                       copy.deepcopy(self.review), str(self.key),
                       trusted_model=False, accept_review=True)
        with self.assertRaises(proof.geo.InvalidInput):
            proof.seal(str(self.image), str(self.model), self.model_sha,
                       copy.deepcopy(self.review), str(self.key),
                       trusted_model=True, accept_review=False)

    def test_untrusted_or_unreviewed_telemetry_refused(self):
        self.review["telemetry"]["altitudeAglVerified"] = False
        with self.assertRaises(proof.geo.InvalidInput):
            self.seal()
        self.review = input_payload()["review"]
        self.review["pixelTransform"] = "letterboxed"
        with self.assertRaises(proof.geo.InvalidInput):
            self.seal()

    def test_reject_missing_model_pin(self):
        for sha in (None, "notsha", "F" * 64, "0" * 64):
            with self.subTest(sha=sha), self.assertRaises(proof.geo.InvalidInput):
                proof.seal(str(self.image), str(self.model), sha,
                           copy.deepcopy(self.review), str(self.key),
                           trusted_model=True, accept_review=True)

    def test_key_permissions_length_and_symlink(self):
        self.key.chmod(0o644)
        with self.assertRaises(proof.geo.InvalidInput):
            self.seal()
        self.key.chmod(0o600)
        self.key.write_bytes(b"short")
        with self.assertRaises(proof.geo.InvalidInput):
            self.seal()
        self.key.write_bytes(b"S" * 32)
        shortcut = self.root / "shortcut.key"
        shortcut.symlink_to(self.key)
        with self.assertRaises(proof.geo.InvalidInput):
            proof._secret(str(shortcut))

    def test_private_file_cli_verify_and_refuse_existing(self):
        bundle = self.seal()
        inp = self.root / "envelope.json"
        out = self.root / "private-result.json"
        inp.write_text(json.dumps(bundle), encoding="utf-8")
        args = ["verify", "--envelope", str(inp), "--image", str(self.image),
                "--model", str(self.model), "--model-sha256", self.model_sha,
                "--key-file", str(self.key), "--output", str(out),
                "--accept-reviewed-handoff", "--allow-sensitive-location-output"]
        self.assertEqual(proof.main(args), 0)
        self.assertEqual(json.loads(out.read_text())["candidateCount"], 1)
        self.assertEqual(out.stat().st_mode & 0o777, 0o600)
        self.assertEqual(proof.main(args), 2)

    def test_invalid_signed_bundle_cannot_inject_output_fields(self):
        bundle = self.seal()
        bundle["PRIVATE_KEY"] = "secret"
        with self.assertRaises(proof.geo.InvalidInput):
            self.verify(bundle)

    def test_changed_expected_external_model_hash_rejected(self):
        bundle = self.seal()
        with self.assertRaises(proof.geo.InvalidInput):
            proof.verify_and_project(bundle, str(self.image), str(self.model),
                                     "0" * 64, str(self.key))

    def test_prevent_cross_path_image_substitution(self):
        bundle = self.seal()
        other = self.root / "different.png"
        other.write_bytes(b"another frame")
        with self.assertRaises(proof.geo.InvalidInput):
            proof.verify_and_project(bundle, str(other), str(self.model),
                                     self.model_sha, str(self.key))


if __name__ == "__main__":
    unittest.main()
