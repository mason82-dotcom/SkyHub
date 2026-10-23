"""Synthetic read-only MP4/MOV/SRT timebase and signed-capture integration."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_dji_video_timebase_offline",
    WORKERS / "thermal_dji_video_timebase_offline.py")
timing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(timing)

from test_thermal_capture_calibration_offline import CaptureCalibrationTest


def atom(tag, data=b""):
    return (len(data) + 8).to_bytes(4, "big") + tag + data


def movie(*, duration=3000, timescale=1000, version=0, extras=b"",
          tracks=1, mdat=b"private movie pixels and telemetry not decoded"):
    if version == 0:
        header = (bytes(4) + bytes(8) +
                  timescale.to_bytes(4, "big") + duration.to_bytes(4, "big"))
    elif version == 1:
        header = (bytes([1, 0, 0, 0]) + bytes(16) +
                  timescale.to_bytes(4, "big") + duration.to_bytes(8, "big"))
    else:
        header = bytes([version, 0, 0, 0]) + bytes(16)
    moov = atom(b"mvhd", header) + b"".join(atom(b"trak") for _ in range(tracks)) + extras
    return atom(b"ftyp", b"isom" + bytes(4) + b"isom") + atom(b"mdat", mdat) + atom(b"moov", moov)


SRT = ("1\n00:00:00,000 --> 00:00:00,400\n"
       "GPS:49.123 PRIVATE_SN_SOMEWHERE GimbalYaw:77\n\n"
       "2\n00:00:00,500 --> 00:00:00,900\n"
       "GPS:50.999 PRIVATE_PERSON_HERE\n")


class VideoTimebaseTest(CaptureCalibrationTest):
    """Reuse private capture + approved-but-SYNTHETIC registry fixtures."""

    def setUp(self):
        super().setUp()
        self.media = self.root / "synthetic.mp4"
        self.media.write_bytes(movie())
        self.srt = self.root / "private-cues.srt"
        self.srt.write_text(SRT, encoding="utf-8")
        self.srt_sha = hashlib.sha256(self.srt.read_bytes()).hexdigest()

    def inspect(self, *, capture_envelope=None, srt=False):
        envelope = (self.seal_capture() if capture_envelope is None
                    else capture_envelope)
        return timing.inspect(
            str(self.media), str(self.image), envelope,
            self.registry, self.profile["profileId"], self.profile_sha,
            str(self.capture_key),
            srt=str(self.srt) if srt else None,
            expected_srt_sha256=self.srt_sha if srt else None)

    def test_mp4_header_is_only_an_unverified_duration_hint(self):
        result = self.inspect()
        self.assertEqual(result["schema"], timing.SCHEMA)
        self.assertEqual(result["status"], "movie-header-observed")
        self.assertTrue(result["captureEnvelopeIntegrityVerified"])
        self.assertTrue(result["movieContainerStructureParsed"])
        self.assertEqual(result["movieNominalDurationMsUnverified"], 3000)
        self.assertEqual(result["movieTrackCount"], 1)
        self.assertEqual(result["movieTopLevelAtomCount"], 3)
        for field in ("djiSensorOriginVerified", "movieClockUtcVerified",
                      "srtVideoAlignmentVerified", "frameTimestampUtcVerified",
                      "telemetryTimebaseVerified", "positionVerified",
                      "altitudeAglVerified", "gimbalPoseVerified",
                      "geolocationVerified", "accuracyMetersVerified",
                      "flightControlReady", "searchAndRescueReady"):
            self.assertFalse(result[field])
        self.assertNotIn("sourceMediaSha256", result)

    def test_srt_structural_time_codes_are_not_video_synced(self):
        result = self.inspect(srt=True)
        self.assertTrue(result["srtPinnedBytesVerified"])
        self.assertTrue(result["srtCueTimecodesMonotonic"])
        self.assertEqual(result["srtCueCount"], 2)
        self.assertEqual(result["srtRelativeSpanMsUnverified"], 900)
        for word in ("49.123", "50.999", "PRIVATE_PERSON",
                     "PRIVATE_SN", str(self.root), self.srt_sha,
                     self.profile["profileId"]):
            self.assertNotIn(word, json.dumps(result))
        self.assertFalse(result["srtVideoAlignmentVerified"])
        self.assertFalse(result["movieClockUtcVerified"])

    def test_srt_requires_independent_pinned_digest(self):
        envelope = self.seal_capture()
        for kwargs in (
            {"srt": str(self.srt)},
            {"expected_srt_sha256": self.srt_sha},
            {"srt": str(self.srt), "expected_srt_sha256": "0" * 64},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(timing.geo.InvalidInput):
                timing.inspect(str(self.media), str(self.image), envelope,
                    self.registry, self.profile["profileId"], self.profile_sha,
                    str(self.capture_key), **kwargs)

    def test_srt_tampering_after_digest_pin_fails(self):
        bundle = self.seal_capture()
        self.srt.write_text(SRT + "\nPRIVATE EXTRA", encoding="utf-8")
        with self.assertRaises(timing.geo.InvalidInput):
            self.inspect(capture_envelope=bundle, srt=True)

    def test_nonmonotonic_srt_cue_times_rejected(self):
        for body in (
            "1\n00:00:01,000 --> 00:00:00,000\nX\n",
            "1\n00:00:00,200 --> 00:00:00,500\nA\n\n"
            "2\n00:00:00,300 --> 00:00:00,700\nB\n",
            "1\n99:00:00,000 --> 99:00:00,010\nX\n",
            "1\n00:00:00,000 --> 00:00:00,500\nX\n\n"
            "1\n00:00:00,600 --> 00:00:00,800\nY\n",
        ):
            with self.subTest(body=body[:25]):
                self.srt.write_text(body, encoding="utf-8")
                self.srt_sha = hashlib.sha256(self.srt.read_bytes()).hexdigest()
                with self.assertRaises(timing.geo.InvalidInput):
                    self.inspect(srt=True)

    def test_missing_utf8_or_empty_srt_rejected(self):
        for body in (b"", b"\xff\xfe\x81\x82", b"broken subtitle text"):
            with self.subTest(body=body):
                self.srt.write_bytes(body)
                self.srt_sha = hashlib.sha256(body).hexdigest()
                with self.assertRaises(timing.geo.InvalidInput):
                    self.inspect(srt=True)

    def test_srt_oversize_limit_refused(self):
        self.srt.write_bytes(b"A" * (timing.MAX_SRT_BYTES + 1))
        self.srt_sha = hashlib.sha256(self.srt.read_bytes()).hexdigest()
        with self.assertRaises(timing.geo.InvalidInput):
            self.inspect(srt=True)

    def test_mvhd_v1_and_mov_supported_without_utc_evidence(self):
        self.media = self.root / "synthetic.mov"
        self.media.write_bytes(movie(version=1, duration=6000, timescale=1000))
        result = self.inspect()
        self.assertEqual(result["movieNominalDurationMsUnverified"], 6000)
        self.assertFalse(result["frameTimestampUtcVerified"])

    def test_corrupt_atom_header_rejected(self):
        cases = (
            b"junk",
            atom(b"ftyp", b"isom" + bytes(4)) + b"\0\0\0\x08moov",
            atom(b"ftyp", b"isom" + bytes(4)) + (999).to_bytes(4, "big") + b"moov",
            atom(b"ftyp", b"isom" + bytes(4)) + b"\0\0\0\0mdat",
            movie(duration=0xffffffff),
            movie(timescale=0),
            movie(version=3),
        )
        for case in cases:
            with self.subTest(len=len(case)):
                self.media.write_bytes(case)
                with self.assertRaises(timing.geo.InvalidInput):
                    self.inspect()

    def test_moov_size_budget_and_duplicate_header_rejected(self):
        for data in (
            movie(extras=atom(b"free", b"X" * timing.MAX_MOOV)),
            movie(extras=atom(b"mvhd", bytes(20))),
            movie(tracks=65),
        ):
            with self.subTest(len=len(data)):
                self.media.write_bytes(data)
                with self.assertRaises(timing.geo.InvalidInput):
                    self.inspect()

    def test_mdat_bytes_never_interpreted_as_metadata(self):
        private_text = b"GPS 49.3456 PRIVATE_GIMBAL_77" * 4096
        self.media.write_bytes(movie(mdat=private_text))
        result = self.inspect()
        self.assertNotIn("PRIVATE_GIMBAL", json.dumps(result))
        self.assertEqual(result["movieNominalDurationMsUnverified"], 3000)

    def test_capture_file_mutation_refused_even_if_bmff_valid(self):
        envelope = self.seal_capture()
        self.media.write_bytes(movie(duration=4500))
        with self.assertRaises(timing.geo.InvalidInput):
            self.inspect(capture_envelope=envelope)

    def test_unsupported_jpeg_source_stays_denied_for_srt(self):
        self.media = self.root / "still.jpg"
        self.media.write_bytes(b"synthetic opaque still")
        result = self.inspect()
        self.assertEqual(result["status"], "unsupported-media-format")
        self.assertFalse(result["movieContainerStructureParsed"])
        with self.assertRaises(timing.geo.InvalidInput):
            self.inspect(srt=True)

    def test_source_and_derivative_must_be_distinct_files(self):
        # Override the inherited JPEG-specific fixture: the current source
        # is an MP4, which cannot itself be supplied as a decoded JPEG.
        jpeg_source = self.root / "single-source.jpg"
        jpeg_source.write_bytes(b"synthetic JPEG fixture, not decoded")
        with self.assertRaisesRegex(timing.geo.InvalidInput,
                                    "source_and_frame_must_be_distinct"):
            timing.capture.seal_capture(
                str(jpeg_source), str(jpeg_source), self.registry,
                self.profile["profileId"], self.profile_sha,
                self.capture_review, str(self.capture_key), accept_capture=True)

    def test_private_cli_and_exclusive_result_file(self):
        registry = self.root / "registry.json"
        capture_file = self.root / "capture.json"
        output = self.root / "movie-private.json"
        registry.write_text(json.dumps(self.registry), encoding="utf-8")
        capture_file.write_text(json.dumps(self.seal_capture()), encoding="utf-8")
        args = [
            "--media", str(self.media), "--image", str(self.image),
            "--registry", str(registry), "--profile-id", self.profile["profileId"],
            "--profile-sha256", self.profile_sha,
            "--capture-envelope", str(capture_file),
            "--capture-key-file", str(self.capture_key),
            "--srt", str(self.srt), "--srt-sha256", self.srt_sha,
            "--output", str(output), "--accept-reviewed-capture",
        ]
        self.assertEqual(timing.main(args), 0)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_text())["srtCueCount"], 2)
        self.assertEqual(timing.main(args), 2)


if __name__ == "__main__":
    unittest.main()
