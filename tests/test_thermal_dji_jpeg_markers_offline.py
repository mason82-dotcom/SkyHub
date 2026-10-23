"""Opt-in DJI marker presence only; synthetic JPEG headers and private HMAC."""
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
    "thermal_dji_jpeg_markers_offline",
    WORKERS / "thermal_dji_jpeg_markers_offline.py")
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

from test_thermal_capture_calibration_offline import CaptureCalibrationTest


def segment(kind, payload=b""):
    return b"\xff" + bytes([kind]) + (len(payload) + 2).to_bytes(2, "big") + payload


def xmp(fields=b'drone-dji:GPSLatitude="49.123456"'):
    return (b'<x:xmpmeta xmlns:x="adobe:ns:meta/" '
            b'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">'
            b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            b'<rdf:Description ' + fields + b'/></rdf:RDF></x:xmpmeta>')


def jpeg(*items, add_scan=True):
    # This represents only JPEG header structure, not an actual DJI capture.
    data = b"\xff\xd8" + b"".join(items)
    return data + (b"\xff\xda" if add_scan else b"")


class MarkerProbeTest(CaptureCalibrationTest):
    """Re-use fully working synthetic capture/registry/key setup."""

    def setUp(self):
        super().setUp()
        self.media.write_bytes(jpeg(
            segment(0xE1, b"Exif\x00\x00SECRET_GPS 51.5"),
            segment(0xE1, probe.XMP_PREFIX + xmp(
                b'drone-dji:GPSLatitude="49.123456" '
                b'drone-dji:GimbalYawDegree="999" '
                b'drone-dji:CameraSerialNumber="PRIVATE_SERIAL"'))))

    def summary(self, bundle=None):
        cap = self.seal_capture() if bundle is None else bundle
        return probe.inspect(
            str(self.media), cap, self.registry,
            self.profile["profileId"], self.profile_sha,
            str(self.image), str(self.capture_key))

    def test_only_presence_bits_escape_never_private_values(self):
        r = self.summary()
        self.assertEqual(r["status"], "dji-xmp-field-names-untrusted")
        self.assertTrue(r["exifMarkerPresent"])
        self.assertTrue(r["djiXmpFieldPresence"]["GPSLatitude"])
        self.assertTrue(r["djiXmpFieldPresence"]["CameraSerialNumber"])
        self.assertTrue(r["djiXmpFieldPresence"]["GimbalYawDegree"])
        self.assertFalse(r["djiXmpFieldPresence"]["GPSLongitude"])
        self.assertTrue(r["captureEnvelopeIntegrityVerified"])
        for k in ("djiSensorOriginVerified", "positionVerified",
                  "timeAlignmentVerified", "altitudeAglVerified",
                  "gimbalPoseVerified", "radiometricCalibrationVerified",
                  "geolocationVerified", "searchAndRescueReady",
                  "flightControlReady", "xmpBytePayloadVerified"):
            self.assertFalse(r[k])
        escaped = json.dumps(r)
        for phrase in ("PRIVATE_SERIAL", "49.123456", "SECRET_GPS",
                       "51.5", str(self.root), "999",
                       self.profile["profileId"], self.profile_sha):
            self.assertNotIn(phrase, escaped)

    def test_jpeg_with_no_app1_xmp(self):
        self.media.write_bytes(jpeg(segment(0xE0, b"JFIF\x00\x01\x02")))
        r = self.summary()
        self.assertEqual(r["status"], "xmp-not-found-in-bounded-header")
        self.assertFalse(any(r["djiXmpFieldPresence"].values()))

    def test_unknown_xmp_namespace_does_not_claim_dji(self):
        self.media.write_bytes(jpeg(segment(
            0xE1, probe.XMP_PREFIX +
            b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            b'drone-dji:GPSLatitude="sensitive"</x:xmpmeta>')))
        r = self.summary()
        self.assertEqual(r["status"], "dji-xmp-namespace-not-recognized")
        self.assertFalse(any(r["djiXmpFieldPresence"].values()))

    def test_duplicate_xmp_rejected(self):
        pkt = segment(0xE1, probe.XMP_PREFIX + xmp())
        self.media.write_bytes(jpeg(pkt, pkt))
        with self.assertRaisesRegex(probe.geo.InvalidInput,
                                    "duplicate_or_oversized_xmp"):
            self.summary()

    def test_oversized_xmp_rejected(self):
        pkt = probe.XMP_PREFIX + xmp() + b" " * (probe.MAX_XMP + 1)
        self.media.write_bytes(jpeg(segment(0xE1, pkt)))
        with self.assertRaises(probe.geo.InvalidInput):
            self.summary()

    def test_duplicate_exif_rejected(self):
        pkt = segment(0xE1, b"Exif\x00\x00")
        self.media.write_bytes(jpeg(pkt, pkt))
        with self.assertRaisesRegex(probe.geo.InvalidInput, "duplicated_exif_marker"):
            self.summary()

    def test_duplicate_dji_field_names_ambiguous(self):
        packet = xmp(
            b'drone-dji:GPSLatitude="49.0" drone-dji:GPSLatitude="50.0"')
        self.media.write_bytes(jpeg(segment(0xE1, probe.XMP_PREFIX + packet)))
        r = self.summary()
        self.assertEqual(r["ambiguousDjiFieldNames"], 1)
        self.assertFalse(r["djiXmpFieldPresence"]["GPSLatitude"])

    def test_malformed_jpeg_header_rejected(self):
        for bytes_ in (b"bad media file", b"\xff\xd8\xff\xe1\x00\x01",
                       b"\xff\xd8\xff\xe1\x00\x10short",
                       jpeg(segment(0xE1, probe.XMP_PREFIX + xmp()),
                            add_scan=False)):
            with self.subTest(raw=bytes_[:10]):
                self.media.write_bytes(bytes_)
                with self.assertRaises(probe.geo.InvalidInput):
                    self.summary()

    def test_bounded_header_scan_limits_and_segment_count(self):
        # Large comments must not force unbounded source loading.
        self.media.write_bytes(jpeg(
            segment(0xFE, b"x" * 65500),
            segment(0xFE, b"y" * 65500),
            segment(0xFE, b"z" * 65500),
            segment(0xFE, b"w" * 65500),
        ))
        with self.assertRaisesRegex(probe.geo.InvalidInput, "jpeg_scan_budget_exceeded"):
            self.summary()
        self.media.write_bytes(jpeg(*[segment(0xFE, b"m") for _ in range(100)]))
        with self.assertRaisesRegex(probe.geo.InvalidInput,
                                    "too_many_jpeg_header_segments"):
            self.summary()

    def test_source_mutation_after_capture_seal_denied(self):
        seal = self.seal_capture()
        self.media.write_bytes(jpeg(segment(0xE1, probe.XMP_PREFIX +
                                            xmp(b'drone-dji:GPSLatitude="52.0"'))))
        with self.assertRaises(probe.geo.InvalidInput):
            self.summary(bundle=seal)

    def test_hmac_mutation_denied_before_image_read(self):
        seal = self.seal_capture()
        seal["hmacSha256"] = "0" * 64
        with self.assertRaises(probe.geo.InvalidInput):
            self.summary(bundle=seal)

    def test_non_jpeg_source_is_explicitly_unsupported(self):
        self.media = self.root / "synthetic.mp4"
        self.media.write_bytes(b"synthetic movie bytes; structurally unchecked")
        report = self.summary()
        self.assertEqual(report["status"], "unsupported-media-format")
        self.assertFalse(any(report["djiXmpFieldPresence"].values()))
        self.assertFalse(report["djiSensorOriginVerified"])

    def test_private_cli_result_mode_and_no_overwrite(self):
        registry = self.root / "registry.json"
        capture = self.root / "capture.json"
        output = self.root / "redacted.json"
        registry.write_text(json.dumps(self.registry), encoding="utf-8")
        capture.write_text(json.dumps(self.seal_capture()), encoding="utf-8")
        args = ["--media", str(self.media), "--image", str(self.image),
                "--registry", str(registry),
                "--profile-id", self.profile["profileId"],
                "--profile-sha256", self.profile_sha,
                "--capture-envelope", str(capture),
                "--capture-key-file", str(self.capture_key),
                "--output", str(output), "--accept-reviewed-capture"]
        self.assertEqual(probe.main(args), 0)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("PRIVATE_SERIAL", output.read_text())
        self.assertEqual(probe.main(args), 2)

    def test_xmp_doctype_not_trusted(self):
        self.media.write_bytes(jpeg(segment(
            0xE1, probe.XMP_PREFIX +
            xmp() + b'<!DOCTYPE private SYSTEM "file:///etc/passwd">')))
        result = self.summary()
        self.assertEqual(result["status"], "dji-xmp-namespace-not-recognized")
        self.assertFalse(any(result["djiXmpFieldPresence"].values()))


if __name__ == "__main__":
    unittest.main()
