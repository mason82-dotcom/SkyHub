"""Manual handoff contract; entirely dependency-free and hardware/network isolated."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_person_manual_handoff", WORKERS / "thermal_person_manual_handoff.py")
handoff = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handoff)
from test_thermal_person_geolocation import sample


def input_payload():
    base = sample()
    base["frame"]["coordinateSpace"] = "undistorted_uncropped"
    detection = {
        "schema": "skyhub-thermal-person-detection-preview-v1",
        "status": "detections",
        "source": "explicit-local-8bit-thermal-preview",
        "image": {"width": 640, "height": 512,
                  "coordinateSpace": "decoded_image_unverified"},
        "modelFormat": "onnx",
        "detectionCount": 1,
        "detections": [{
            "detectionIndex": 0,
            "className": "person",
            "confidence": 0.95,
            "bboxXYXY": [310, 246, 330, 266],
        }],
        "personPresenceVerified": False,
        "trackingVerified": False,
        "thermalRadiometryVerified": False,
        "geolocationVerified": False,
        "flightControlReady": False,
        "searchAndRescueReady": False,
    }
    review = {
        "timestampMs": base["timestampMs"],
        "frame": copy.deepcopy(base["frame"]),
        "camera": copy.deepcopy(base["camera"]),
        "telemetry": copy.deepcopy(base["telemetry"]),
        "pixelTransform": "identity-undistorted-full-frame",
        "sourceFrameReviewed": True,
        "modelReviewed": True,
        "opticalGeometryReviewed": True,
        "detectionsReviewed": True,
        "trackAssignments": [{"detectionIndex": 0, "trackId": 98}],
    }
    return {"schema": handoff.INPUT_SCHEMA, "detectionReport": detection,
            "review": review}


class ManualHandoffTest(unittest.TestCase):
    def test_synthetic_candidate_is_never_verified(self):
        result = handoff.reviewed_projection(input_payload())
        self.assertEqual(result["schema"], handoff.OUTPUT_SCHEMA)
        self.assertEqual(result["candidateCount"], 1)
        self.assertEqual(result["estimates"][0]["trackId"], 98)
        self.assertEqual(result["estimates"][0]["latitude"], 49.0)
        self.assertEqual(result["estimates"][0]["longitude"], 8.0)
        for flag in ("geolocationVerified", "accuracyMetersVerified",
                     "personPresenceVerified", "trackingVerified",
                     "flightControlReady", "searchAndRescueReady"):
            self.assertIs(result[flag], False)

    def test_detector_claims_cannot_upgrade_readiness(self):
        for field in ("personPresenceVerified", "trackingVerified",
                      "thermalRadiometryVerified", "geolocationVerified",
                      "flightControlReady", "searchAndRescueReady"):
            with self.subTest(field=field):
                data = input_payload()
                data["detectionReport"][field] = True
                with self.assertRaises(handoff.geo.InvalidInput):
                    handoff.reviewed_projection(data)

    def test_review_flags_all_required(self):
        for field in ("sourceFrameReviewed", "modelReviewed",
                      "opticalGeometryReviewed", "detectionsReviewed"):
            with self.subTest(field=field):
                data = input_payload()
                data["review"][field] = False
                with self.assertRaises(handoff.geo.InvalidInput):
                    handoff.reviewed_projection(data)

    def test_no_automatic_reclassification_of_uncalibrated_frame(self):
        data = input_payload()
        data["review"]["pixelTransform"] = "resize-letterbox"
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)
        data = input_payload()
        data["review"]["frame"]["coordinateSpace"] = "decoded_image_unverified"
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)

    def test_frame_dimensions_must_match_detector_exactly(self):
        data = input_payload()
        data["review"]["frame"]["width"] = 700
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)

    def test_reject_bad_detection_counts_and_index(self):
        data = input_payload()
        data["detectionReport"]["detectionCount"] = 2
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)
        data = input_payload()
        data["detectionReport"]["detections"][0]["detectionIndex"] = 1
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)

    def test_reject_secret_injected_into_detector_preview(self):
        for target in ("detectionReport", "review"):
            with self.subTest(target=target):
                data = input_payload()
                data[target]["SECRET_WORKSPACE_KEY"] = "private"
                with self.assertRaises(handoff.geo.InvalidInput):
                    handoff.reviewed_projection(data)

    def test_assignments_must_be_explicit_unique_and_exact(self):
        for item in ([], [{"detectionIndex": 1, "trackId": 98}],
                     [{"detectionIndex": 0, "trackId": True}]):
            with self.subTest(item=item):
                data = input_payload()
                data["review"]["trackAssignments"] = item
                with self.assertRaises(handoff.geo.InvalidInput):
                    handoff.reviewed_projection(data)

    def test_unverified_or_stale_pose_blocks_geolocation(self):
        data = input_payload()
        data["review"]["telemetry"]["timestampMs"] += 1500
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)
        data = input_payload()
        data["review"]["telemetry"]["gimbalVerified"] = False
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)

    def test_no_person_detections_yields_empty_output(self):
        data = input_payload()
        data["detectionReport"]["detections"] = []
        data["detectionReport"]["detectionCount"] = 0
        data["detectionReport"]["status"] = "no_detections"
        data["review"]["trackAssignments"] = []
        result = handoff.reviewed_projection(data)
        self.assertEqual(result["candidateCount"], 0)
        self.assertEqual(result["status"], "no_candidates")
        self.assertEqual(result["estimates"], [])

    def test_malformed_model_predictions_rejected(self):
        data = input_payload()
        data["detectionReport"]["detections"][0]["bboxXYXY"][0] = -1
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)
        data = input_payload()
        data["detectionReport"]["detections"][0]["className"] = "SECRET_LOCATION"
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(data)

    def test_result_redacts_raw_camera_and_telemetry_context(self):
        report = json.dumps(handoff.reviewed_projection(input_payload()))
        for forbidden in ("timestampMs", "calibrationId", "modelFormat",
                          "gimbalPitchDeg", "decoded_image_unverified",
                          "sourceFrameReviewed", "latitudeDr"):
            self.assertNotIn(forbidden, report)

    def test_explicit_private_cli_output(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            inp, out = root / "handoff.json", root / "candidates.json"
            inp.write_text(json.dumps(input_payload()), encoding="utf-8")
            self.assertEqual(handoff.main([
                "--input", str(inp), "--output", str(out),
                "--accept-reviewed-handoff",
                "--allow-sensitive-location-output",
            ]), 0)
            self.assertEqual(json.loads(out.read_text())["candidateCount"], 1)
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
            self.assertEqual(handoff.main([
                "--input", str(inp), "--output", str(out),
                "--accept-reviewed-handoff",
                "--allow-sensitive-location-output",
            ]), 2)

    def test_real_detector_contract_passes_manual_handoff_with_mock_model(self):
        # Cross-module contract test: detector.analyze -> reviewed_projection.
        # No Ultralytics, camera, network, weights, or DJI hardware involved.
        with tempfile.TemporaryDirectory() as name:
            base = Path(name)
            image = base / "synthetic.png"
            model = base / "reviewed.onnx"
            image.write_bytes(b"mock decoded image, checked by test probe")
            model.write_bytes(b"mock reviewed ONNX, checked by test model")
            detector = handoff.det

            class MockPrediction:
                orig_shape = (512, 640)
                names = {0: "person"}
                boxes = type("Boxes", (), {
                    "xyxy": [[310, 246, 330, 266]],
                    "conf": [0.95],
                    "cls": [0],
                })()

            class MockModel:
                def predict(self, **kwargs):
                    self.called_with = kwargs
                    return [MockPrediction()]

            report = detector.analyze(
                str(image), str(model), trusted_model=True,
                image_probe=lambda _: (640, 512),
                model_factory=lambda *_args, **_kwargs: MockModel(),
            )
            payload = input_payload()
            payload["detectionReport"] = report
            output = handoff.reviewed_projection(payload)
            self.assertEqual(output["candidateCount"], 1)
            self.assertEqual(output["estimates"][0]["trackId"], 98)
            self.assertFalse(output["geolocationVerified"])

    def test_incompatible_detector_dimensions_rejected_end_to_end(self):
        payload = input_payload()
        payload["detectionReport"]["image"]["width"] = 1024
        with self.assertRaises(handoff.geo.InvalidInput):
            handoff.reviewed_projection(payload)



if __name__ == "__main__":
    unittest.main()
