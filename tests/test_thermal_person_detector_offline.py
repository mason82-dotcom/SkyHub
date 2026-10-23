"""Mock-only tests for opt-in 8-bit thermal detection; no YOLO install or camera."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

WORKER = Path(__file__).resolve().parents[1] / "backend/workers/thermal_person_detector_offline.py"
SPEC = importlib.util.spec_from_file_location("thermal_person_detector_offline", WORKER)
detector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(detector)


class Prediction:
    def __init__(self, rows=None, shape=(512, 640), names=None):
        self.orig_shape = shape
        if rows is None:
            rows = [([300, 230, 340, 280], 0.9, 0)]
        self.boxes = type("Boxes", (), {
            "xyxy": [r[0] for r in rows],
            "conf": [r[1] for r in rows],
            "cls": [r[2] for r in rows]})()
        self.names = names if names is not None else {0: "person"}


class FakeModel:
    def __init__(self, prediction):
        self.prediction = prediction
        self.kwargs = None

    def predict(self, **kwargs):
        self.kwargs = kwargs
        return [self.prediction]


class ThermalDetectorTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.image = self.root / "frame.png"
        self.model = self.root / "model.onnx"
        self.image.write_bytes(b"mock decoded image via probe")
        self.model.write_bytes(b"mock reviewed model")

    def analyze(self, prediction=None, **options):
        mock = FakeModel(prediction or Prediction())
        report = detector.analyze(
            str(self.image), str(self.model), trusted_model=True,
            image_probe=lambda _: (640, 512),
            model_factory=lambda *_args, **_kwargs: mock, **options)
        return report, mock

    def test_person_detection_is_explicitly_unverified(self):
        report, mock = self.analyze()
        self.assertEqual(report["detectionCount"], 1)
        self.assertEqual(report["detections"][0]["bboxXYXY"], [300, 230, 340, 280])
        self.assertEqual(report["image"]["coordinateSpace"], "decoded_image_unverified")
        for flag in ("personPresenceVerified", "trackingVerified",
                     "thermalRadiometryVerified", "geolocationVerified",
                     "flightControlReady", "searchAndRescueReady"):
            self.assertIs(report[flag], False)
        self.assertEqual(mock.kwargs["device"], "cpu")
        self.assertEqual(mock.kwargs["max_det"], detector.MAX_DETECTIONS)
        self.assertEqual(mock.kwargs["save"], False)

    def test_non_person_class_cannot_create_person_candidate(self):
        report, _ = self.analyze(Prediction(names={0: "car"}))
        self.assertEqual(report["status"], "no_detections")
        self.assertEqual(report["detectionCount"], 0)

    def test_unknown_class_cannot_create_person_candidate(self):
        report, _ = self.analyze(Prediction(rows=[([1, 2, 20, 22], 0.9, 2)]))
        self.assertEqual(report["detectionCount"], 0)

    def test_mixed_classes_and_confidence_filter(self):
        pred = Prediction(rows=[
            ([1, 2, 20, 22], 0.85, 0),
            ([1, 2, 20, 22], 0.97, 1),
            ([1, 2, 20, 22], 0.40, 0),
        ], names={0: "person", 1: "vehicle"})
        report, _ = self.analyze(pred, confidence=0.6)
        self.assertEqual(report["detectionCount"], 1)
        self.assertEqual(report["detections"][0]["className"], "person")

    def test_requires_explicit_model_review(self):
        with self.assertRaises(detector.InvalidInput):
            detector.analyze(str(self.image), str(self.model),
                             image_probe=lambda _: (640, 512),
                             model_factory=lambda *a, **k: None)

    def test_pt_must_be_separately_approved(self):
        self.model = self.root / "best.pt"
        self.model.write_bytes(b"mock torch pickle")
        with self.assertRaises(detector.InvalidInput):
            self.analyze()
        report, _ = self.analyze(trusted_pt=True)
        self.assertEqual(report["modelFormat"], "pt")

    def test_reject_unknown_model_types_and_radiometric_tiffs(self):
        self.image = self.root / "raw.tif"
        self.image.write_bytes(b"not renderable")
        with self.assertRaises(detector.InvalidInput):
            self.analyze()
        self.image = self.root / "frame.png"
        with self.assertRaises(detector.InvalidInput):
            detector.local_file("relative.png", {".png"}, detector.MAX_IMAGE_BYTES)

    def test_symlink_and_size_bound_rejected(self):
        shortcut = self.root / "other.png"
        shortcut.symlink_to(self.image)
        with self.assertRaises(detector.InvalidInput):
            detector.local_file(str(shortcut), {".png"}, detector.MAX_IMAGE_BYTES)
        with self.assertRaises(detector.InvalidInput):
            detector.local_file(str(self.image), {".png"}, 3)

    def test_bad_image_shapes_rejected_before_model_initialization(self):
        started = []
        for shape in [(400000, 32), (32, 400000), (5000, 5000), (0, 10)]:
            with self.subTest(shape=shape), self.assertRaises(detector.InvalidInput):
                detector.analyze(str(self.image), str(self.model), trusted_model=True,
                    image_probe=lambda _, s=shape: s,
                    model_factory=lambda *_args, **_kwargs: started.append(1))
        self.assertEqual(started, [])

    def test_bad_predictions_are_rejected_not_clamped(self):
        for rows in [
            [([-1, 2, 20, 22], 0.8, 0)],
            [([1, 2, 700, 22], 0.8, 0)],
            [([1, 2, 20, 22], float("nan"), 0)],
            [([1, 2, 20, 22], 0.8, 0.5)],
            [([8, 2, 8, 22], 0.8, 0)],
            [([1, 2, 20, 22], 0.8, 0)] * 65,
        ]:
            with self.subTest(rows=str(rows)[:30]), self.assertRaises(detector.InvalidInput):
                self.analyze(Prediction(rows=rows))

    def test_predictions_orig_shape_must_match(self):
        with self.assertRaises(detector.InvalidInput):
            self.analyze(Prediction(shape=(512, 800)))

    def test_finite_confidence_required(self):
        for confidence in (float("inf"), float("nan"), 0, 1, True):
            with self.subTest(value=confidence), self.assertRaises(detector.InvalidInput):
                self.analyze(confidence=confidence)

    def test_serialization_never_leaks_filepaths_or_labels(self):
        report, _ = self.analyze(Prediction(names={0: "GPS private location"}))
        payload = json.dumps(report)
        self.assertEqual(report["detectionCount"], 0)
        self.assertNotIn(str(self.root), payload)
        self.assertNotIn("GPS", payload)

    def test_cli_redacts_errors_and_never_creates_output_on_refusal(self):
        dest = self.root / "result.json"
        output = StringIO()
        with redirect_stdout(output):
            status = detector.main(["--image", str(self.image),
                                    "--model", str(self.model),
                                    "--output", str(dest)])
        self.assertEqual(status, 2)
        self.assertFalse(dest.exists())
        self.assertEqual(json.loads(output.getvalue()),
                         {"schema": detector.SCHEMA, "status": "unavailable"})


if __name__ == "__main__":
    unittest.main()
