"""Offline mathematical/validation contracts; no camera, network, ROS or model."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

FILE = Path(__file__).resolve().parents[1] / "backend/workers/thermal_person_geolocation.py"
SPEC = importlib.util.spec_from_file_location("thermal_person_geolocation", FILE)
geo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geo)


def sample(**overrides):
    data = {
        "schema": geo.INPUT_SCHEMA,
        "timestampMs": 1_800_000_000_000,
        "frame": {"width": 640, "height": 512, "coordinateSpace": "undistorted_uncropped"},
        "camera": {"calibrationId": "TEST-verified-local", "horizontalFovDeg": 50.0,
                   "verticalFovDeg": 40.0, "verified": True, "zoomRatio": 1.0},
        "telemetry": {"timestampMs": 1_800_000_000_100, "timeVerified": True,
                      "latitude": 49.0, "longitude": 8.0, "positionVerified": True,
                      "altitudeAglM": 100.0, "altitudeAglVerified": True,
                      "gimbalYawDeg": 0.0, "gimbalPitchDeg": -90.0,
                      "gimbalRollDeg": 0.0, "gimbalVerified": True,
                      "yawReference": "true_north_clockwise"},
        "detections": [{"trackId": 1, "className": "person", "confidence": 0.95,
                        "bboxXYXY": [310, 246, 330, 266]}],
    }
    data.update(overrides)
    return data


class ThermalPersonGeoTest(unittest.TestCase):
    def test_nadir_center_projects_to_aircraft_ground_point(self):
        report = geo.project(sample())
        self.assertEqual(report["candidateCount"], 1)
        result = report["estimates"][0]
        self.assertEqual(result["latitude"], 49.0)
        self.assertEqual(result["longitude"], 8.0)
        self.assertEqual(result["groundOffsetMeters"], 0.0)
        self.assertEqual(result["status"], "unverified_candidate")
        self.assertFalse(report["geolocationVerified"])
        self.assertFalse(report["accuracyMetersVerified"])
        self.assertFalse(report["searchAndRescueReady"])

    def test_oblique_center_projects_north_by_altitude(self):
        payload = sample()
        payload["telemetry"]["gimbalPitchDeg"] = -45.0
        report = geo.project(payload)
        p = report["estimates"][0]
        self.assertAlmostEqual(p["groundOffsetMeters"], 100, places=1)
        self.assertAlmostEqual(p["latitude"] - 49.0, 100 / 111_319.49, delta=1e-6)

    def test_yaw_90_projects_east(self):
        payload = sample()
        payload["telemetry"]["gimbalYawDeg"] = 90.0
        payload["telemetry"]["gimbalPitchDeg"] = -45.0
        p = geo.project(payload)["estimates"][0]
        self.assertAlmostEqual(p["latitude"], 49.0, places=5)
        self.assertGreater(p["longitude"], 8.0)
        self.assertAlmostEqual(p["groundOffsetMeters"], 100, places=1)

    def test_pinhole_image_offsets_nadir(self):
        payload = sample()
        payload["detections"][0]["bboxXYXY"] = [470, 374, 490, 394]
        p = geo.project(payload)["estimates"][0]
        self.assertGreater(p["longitude"], 8.0)
        self.assertLess(p["latitude"], 49.0)

    def test_horizon_rays_rejected(self):
        payload = sample()
        payload["telemetry"]["gimbalPitchDeg"] = 0.0
        report = geo.project(payload)
        self.assertEqual(report["status"], "no_candidates")
        self.assertEqual(report["rejectedCounts"]["invalidGeometry"], 1)

    def test_distance_gate_rejected(self):
        payload = sample()
        payload["telemetry"].update({"altitudeAglM": 500.0, "gimbalPitchDeg": -8.0})
        self.assertEqual(geo.project(payload)["candidateCount"], 0)

    def test_time_boundary_and_missing_verification(self):
        payload = sample()
        payload["telemetry"]["timestampMs"] = payload["timestampMs"] + geo.MAX_SYNC_MS
        self.assertEqual(geo.project(payload)["candidateCount"], 1)
        payload["telemetry"]["timestampMs"] += 1
        with self.assertRaisesRegex(geo.InvalidInput, "telemetry_out_of_sync"):
            geo.project(payload)
        payload["telemetry"]["timestampMs"] = payload["timestampMs"]
        for key in ("timeVerified", "positionVerified", "altitudeAglVerified", "gimbalVerified"):
            with self.subTest(key=key):
                payload["telemetry"][key] = False
                with self.assertRaises(geo.InvalidInput):
                    geo.project(payload)
                payload["telemetry"][key] = True

    def test_refuse_unsupported_roll_zoom_and_coordinate_space(self):
        for field, val in (("gimbalRollDeg", 0.01), ("yawReference", "relative")):
            payload = sample()
            payload["telemetry"][field] = val
            with self.subTest(field=field), self.assertRaises(geo.InvalidInput):
                geo.project(payload)
        payload = sample()
        payload["camera"]["zoomRatio"] = 2.0
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)
        payload = sample()
        payload["frame"]["coordinateSpace"] = "letterboxed"
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)

    def test_missing_camera_calibration_and_agl_refused(self):
        payload = sample()
        payload["camera"]["verified"] = False
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)
        payload = sample()
        payload["telemetry"]["altitudeAglM"] = 0
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)
        payload = sample()
        payload["telemetry"]["latitude"] = 0
        payload["telemetry"]["longitude"] = 0
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)

    def test_malformed_boxes_and_extra_keys_fail_closed(self):
        for box in ([1, 2, 1, 3], [-1, 0, 10, 10], [0, 0, float("nan"), 10],
                    [0, 0, 700, 10], [0, 0, True, 10], [0, 1, 2]):
            payload = sample()
            payload["detections"][0]["bboxXYXY"] = box
            with self.subTest(box=box), self.assertRaises(geo.InvalidInput):
                geo.project(payload)
        payload = sample()
        payload["telemetry"]["rawDjIMqttPayload"] = "secret"
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)

    def test_malformed_and_large_detection_sets_fail(self):
        payload = sample()
        payload["detections"] *= 65
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)
        payload = sample()
        payload["detections"][0]["confidence"] = float("inf")
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)
        payload = sample()
        payload["detections"][0]["trackId"] = True
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)

    def test_non_person_and_low_confidence_do_not_geolocate(self):
        payload = sample()
        payload["detections"] = [
            {"trackId": 1, "className": "other", "confidence": 0.97, "bboxXYXY": [1, 2, 40, 40]},
            {"trackId": 2, "className": "person", "confidence": 0.49, "bboxXYXY": [1, 2, 40, 40]},
        ]
        result = geo.project(payload)
        self.assertEqual(result["candidateCount"], 0)
        self.assertEqual(result["rejectedCounts"], {"nonPerson": 1, "lowConfidence": 1, "invalidGeometry": 0})

    def test_duplicate_id_rejected(self):
        payload = sample()
        payload["detections"].append(dict(payload["detections"][0]))
        with self.assertRaises(geo.InvalidInput):
            geo.project(payload)

    def test_output_never_contains_input_provenance_or_raw_telemetry(self):
        result = json.dumps(geo.project(sample()))
        self.assertNotIn("calibrationId", result)
        self.assertNotIn("gimbalYaw", result)
        self.assertNotIn("timestampMs", result)
        self.assertNotIn("filename", result)

    def test_secure_explicit_cli_output_and_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inp, out = root / "input.json", root / "output.json"
            inp.write_text(json.dumps(sample()), encoding="utf-8")
            self.assertEqual(geo.main(["--input", str(inp), "--output", str(out),
                                       "--allow-sensitive-location-output"]), 0)
            self.assertEqual(json.loads(out.read_text())["candidateCount"], 1)
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
            self.assertEqual(geo.main(["--input", str(inp), "--output", str(out),
                                       "--allow-sensitive-location-output"]), 2)
            bad = root / "bad.json"
            bad.write_text('{"foo":1,"foo":2}', encoding="utf-8")
            self.assertEqual(geo.main(["--input", str(bad), "--output", str(root / "third.json"),
                                       "--allow-sensitive-location-output"]), 2)


if __name__ == "__main__":
    unittest.main()
