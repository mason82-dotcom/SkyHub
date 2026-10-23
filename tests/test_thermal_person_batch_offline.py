"""Offline frame-to-pose pairing contracts; no DJI broker, camera, ROS or ML."""
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
    "thermal_person_batch_offline", WORKERS / "thermal_person_batch_offline.py")
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)
from test_thermal_person_geolocation import sample


def frame(timestamp, track_id=1):
    data = sample()
    item = {
        "timestampMs": timestamp, "frame": copy.deepcopy(data["frame"]),
        "camera": copy.deepcopy(data["camera"]),
        "detections": copy.deepcopy(data["detections"]),
    }
    item["detections"][0]["trackId"] = track_id
    return item


def scenario():
    data = sample()
    return {
        "schema": batch.INPUT_SCHEMA,
        "frames": [frame(data["timestampMs"])],
        "telemetry": [copy.deepcopy(data["telemetry"])],
    }


class BatchContractTest(unittest.TestCase):
    def test_single_valid_frame_no_automatic_readiness(self):
        report = batch.analyze_batch(scenario())
        self.assertEqual(report["schema"], batch.OUTPUT_SCHEMA)
        self.assertEqual(report["frameCount"], 1)
        self.assertEqual(report["candidateCount"], 1)
        self.assertEqual(report["unmatchedFrameCount"], 0)
        self.assertEqual(report["frames"][0]["frameIndex"], 0)
        self.assertFalse(report["geolocationVerified"])
        self.assertFalse(report["searchAndRescueReady"])
        self.assertFalse(report["accuracyMetersVerified"])

    def test_multiple_frames_sync_only_near_valid_pose(self):
        payload = scenario()
        t = payload["frames"][0]["timestampMs"]
        payload["frames"] = [frame(t), frame(t + 200, 2), frame(t + 2000, 3)]
        report = batch.analyze_batch(payload)
        self.assertEqual(report["frameCount"], 3)
        self.assertEqual(report["candidateCount"], 2)
        self.assertEqual(report["unmatchedFrameCount"], 1)
        self.assertEqual(report["frames"][2],
                         {"frameIndex": 2, "status": "pose_unavailable",
                          "candidateCount": 0, "estimates": []})

    def test_exact_sync_boundary_inclusive(self):
        payload = scenario()
        payload["telemetry"][0]["timestampMs"] = (
            payload["frames"][0]["timestampMs"] + batch.geo.MAX_SYNC_MS)
        self.assertEqual(batch.analyze_batch(payload)["candidateCount"], 1)
        payload["telemetry"][0]["timestampMs"] += 1
        self.assertEqual(batch.analyze_batch(payload)["unmatchedFrameCount"], 1)

    def test_reject_malformed_unmatched_detection(self):
        payload = scenario()
        payload["telemetry"][0]["timestampMs"] += 800
        payload["frames"][0]["detections"][0]["className"] = "untrusted_secret"
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)

    def test_reject_unverified_telemetry_even_when_unmatched(self):
        payload = scenario()
        payload["telemetry"][0]["timestampMs"] += 2000
        payload["telemetry"][0]["timeVerified"] = False
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)

    def test_reject_unsorted_duplicate_and_invalid_frames(self):
        payload = scenario()
        ts = payload["frames"][0]["timestampMs"]
        payload["frames"].append(frame(ts))
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)
        payload["frames"][1]["timestampMs"] = ts - 1
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)
        payload = scenario()
        payload["frames"][0]["sessionSecret"] = "exfiltrate"
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)

    def test_reject_unsorted_and_extra_telemetry(self):
        payload = scenario()
        state = copy.deepcopy(payload["telemetry"][0])
        payload["telemetry"].append(state)
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)
        payload = scenario()
        payload["telemetry"][0]["deviceSerial"] = "secret"
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)

    def test_reject_large_batch_or_empty_telemetry(self):
        payload = scenario()
        payload["frames"] = [frame(1_800_000_000_000 + i) for i in range(batch.MAX_FRAMES+1)]
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)
        payload = scenario()
        payload["telemetry"] = []
        with self.assertRaises(batch.geo.InvalidInput):
            batch.analyze_batch(payload)

    def test_no_candidate_for_other_class(self):
        payload = scenario()
        payload["frames"][0]["detections"][0]["className"] = "other"
        report = batch.analyze_batch(payload)
        self.assertEqual(report["candidateCount"], 0)
        self.assertEqual(report["status"], "no_candidates")

    def test_sensitive_cli_writes_exclusive_private_result(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            inp = path / "input.json"
            out = path / "out.json"
            inp.write_text(json.dumps(scenario()), encoding="utf-8")
            code = batch.main(["--input", str(inp), "--output", str(out),
                               "--allow-sensitive-location-output"])
            self.assertEqual(code, 0)
            result = json.loads(out.read_text())
            self.assertEqual(result["candidateCount"], 1)
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("timestampMs", out.read_text())
            self.assertNotIn("calibrationId", out.read_text())
            self.assertEqual(batch.main(["--input", str(inp), "--output", str(out),
                                         "--allow-sensitive-location-output"]), 2)


if __name__ == "__main__":
    unittest.main()
