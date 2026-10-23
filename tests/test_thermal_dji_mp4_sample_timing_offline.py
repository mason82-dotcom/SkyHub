"""Synthetic BMFF sample-table DTS/PTS tests; no DJI data or decoded media."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_dji_mp4_sample_timing_offline",
    WORKERS / "thermal_dji_mp4_sample_timing_offline.py")
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)
from test_thermal_capture_calibration_offline import CaptureCalibrationTest
from test_thermal_dji_video_timebase_offline import atom, movie, SRT


def fullbox(version=0):
    return bytes([version, 0, 0, 0])


def entries(tag, pairs, version=0):
    body = fullbox(version) + len(pairs).to_bytes(4, "big")
    for count, value in pairs:
        body += count.to_bytes(4, "big")
        body += value.to_bytes(4, "big", signed=(tag == b"ctts" and version == 1))
    return atom(tag, body)


def videotrack(*, stts=((4, 100),), ctts=None, ctts_version=0,
               sample_count=4, timescale=1000, handler=b"vide",
               edits=False, mdhd_version=0, extra_stbl=b"", stsz_version=0):
    if mdhd_version == 0:
        mdhd = fullbox() + bytes(8) + timescale.to_bytes(4, "big") + (
            400).to_bytes(4, "big") + bytes(4)
    else:
        mdhd = fullbox(mdhd_version) + bytes(16) + timescale.to_bytes(4, "big") + (
            400).to_bytes(8, "big") + bytes(4)
    stsz = (fullbox(stsz_version) + (24).to_bytes(4, "big") +
            sample_count.to_bytes(4, "big"))
    stbl = entries(b"stts", stts)
    if ctts is not None:
        stbl += entries(b"ctts", ctts, ctts_version)
    stbl += atom(b"stsz", stsz) + extra_stbl
    mdia = (atom(b"mdhd", mdhd) +
            atom(b"hdlr", fullbox() + bytes(4) + handler + bytes(8)) +
            atom(b"minf", atom(b"stbl", stbl)))
    return atom(b"trak", (atom(b"edts", b"") if edits else b"") + atom(b"mdia", mdia))


def fixture(**kwargs):
    return movie(tracks=0, extras=videotrack(**kwargs))


class RelativeVideoTimingTest(CaptureCalibrationTest):
    def setUp(self):
        super().setUp()
        self.media = self.root / "pinned-video.mp4"
        self.media.write_bytes(fixture())
        self.srt = self.root / "private.srt"
        self.srt.write_text(SRT, encoding="utf-8")
        self.srt_sha = hashlib.sha256(self.srt.read_bytes()).hexdigest()

    def inspect(self, *, envelope=None, srt=False):
        return sample.analyze(
            str(self.media), str(self.image),
            self.seal_capture() if envelope is None else envelope,
            self.registry, self.profile["profileId"], self.profile_sha,
            str(self.capture_key),
            srt=str(self.srt) if srt else None,
            expected_srt_sha256=self.srt_sha if srt else None,
        )

    def test_four_samples_no_ctts_yields_decode_equals_presentation(self):
        r = self.inspect()
        self.assertEqual(r["schema"], sample.SCHEMA)
        self.assertEqual(r["videoTimingSamplesUnverified"], 4)
        self.assertEqual(r["videoTrackTimescaleUnverified"], 1000)
        self.assertEqual(r["videoDecodeSpanMsUnverified"], 400)
        self.assertEqual(r["videoCompositionSpanMsUnverified"], 400)
        self.assertFalse(r["videoCompositionOffsetsPresent"])
        self.assertFalse(r["videoCompositionOrderDiffersFromDecodeOrder"])
        self.assertTrue(r["videoSampleTableCountsConsistent"])
        self.assertTrue(r["captureEnvelopeIntegrityVerified"])
        for flag in ("videoSamplePayloadMapped", "videoFrameDecodeVerified",
                     "videoSampleUtcVerified", "srtToSampleAlignmentVerified",
                     "perFramePoseAligned", "frameTimestampUtcVerified",
                     "movieClockUtcVerified", "telemetryTimebaseVerified",
                     "djiSensorOriginVerified", "geolocationVerified",
                     "flightControlReady", "searchAndRescueReady"):
            self.assertFalse(r[flag])
        self.assertNotIn("videoAbsoluteTimestamp", r)

    def test_composition_offsets_and_b_frame_reordering(self):
        self.media.write_bytes(fixture(ctts=((1, 200), (1, 0), (2, 0))))
        r = self.inspect()
        self.assertTrue(r["videoCompositionOffsetsPresent"])
        self.assertTrue(r["videoCompositionOrderDiffersFromDecodeOrder"])
        self.assertEqual(r["videoCompositionSpanMsUnverified"], 300)
        self.assertEqual(r["videoDecodeSpanMsUnverified"], 400)

    def test_signed_ctts_v1_negative_offsets(self):
        self.media.write_bytes(fixture(ctts=((1, 0), (1, -100), (2, 0)),
                                       ctts_version=1))
        r = self.inspect()
        self.assertTrue(r["videoCompositionOffsetsPresent"])
        self.assertEqual(r["videoCompositionSpanMsUnverified"], 400)
        self.assertFalse(r["videoSampleUtcVerified"])

    def test_track_media_header_v1(self):
        self.media.write_bytes(fixture(mdhd_version=1))
        self.assertEqual(self.inspect()["videoTimingSamplesUnverified"], 4)

    def test_audio_and_video_tracks_do_not_make_a_frame_ambiguity(self):
        video = videotrack()
        audio = videotrack(handler=b"soun")
        self.media.write_bytes(movie(tracks=0, extras=audio + video))
        r = self.inspect()
        self.assertEqual(r["videoTimingSamplesUnverified"], 4)

    def test_multiple_video_tracks_are_ambiguous(self):
        self.media.write_bytes(movie(tracks=0,
                                     extras=videotrack() + videotrack()))
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "ambiguous_multiple_video_tracks"):
            self.inspect()

    def test_fragmented_media_refused(self):
        self.media.write_bytes(fixture() + atom(b"moof", b"some fragment"))
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "fragmented_mp4_not_supported"):
            self.inspect()
        self.media.write_bytes(movie(tracks=0,
            extras=videotrack() + atom(b"mvex", atom(b"trex", b""))))
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "fragmented_mp4_not_supported"):
            self.inspect()

    def test_edit_list_not_silently_applied(self):
        self.media.write_bytes(fixture(edits=True))
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "edit_lists_not_supported"):
            self.inspect()

    def test_missing_stts_or_count_mismatch_rejected(self):
        for item in (
            {"stts": ((4, 100),), "sample_count": 3},
            {"stts": ((0, 100),)},
            {"stts": ((4, 0),)},
            {"ctts": ((3, 0),)},
            {"ctts": ((5, 0),)},
            {"extra_stbl": atom(b"stts", fullbox() + bytes(4))},
        ):
            with self.subTest(item=item):
                self.media.write_bytes(fixture(**item))
                with self.assertRaises(sample.geo.InvalidInput):
                    self.inspect()

    def test_unsupported_table_revisions_rejected(self):
        for item in (
            {"ctts": ((4, 0),), "ctts_version": 2},
            {"stsz_version": 1},
            {"extra_stbl": atom(b"stz2", bytes(10))},
            {"mdhd_version": 9},
        ):
            with self.subTest(item=item):
                self.media.write_bytes(fixture(**item))
                with self.assertRaises(sample.geo.InvalidInput):
                    self.inspect()

    def test_srt_does_not_implicitly_align_to_pts(self):
        r = self.inspect(srt=True)
        self.assertTrue(r["srtPinnedBytesVerified"])
        self.assertTrue(r["srtCueTimecodesMonotonic"])
        self.assertFalse(r["srtToSampleAlignmentVerified"])
        self.assertFalse(r["perFramePoseAligned"])
        for secret in ("49.123", "PRIVATE_PERSON", str(self.root), self.srt_sha):
            self.assertNotIn(secret, json.dumps(r))

    def test_capture_changed_media_refused(self):
        envelope = self.seal_capture()
        self.media.write_bytes(fixture(ctts=((4, 50),)))
        with self.assertRaises(sample.geo.InvalidInput):
            self.inspect(envelope=envelope)

    def test_no_per_sample_timestamps_cross_output_boundary(self):
        self.media.write_bytes(fixture(ctts=((4, 200),)))
        raw = json.dumps(self.inspect())
        for field in ("sampleDts", "samplePts", "timestampMs",
                      "sourceMediaSha256", "GPSLatitude", "modelSha256"):
            self.assertNotIn(field, raw)

    def test_missing_video_track_refused(self):
        self.media.write_bytes(movie(tracks=0, extras=videotrack(handler=b"soun")))
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "no_video_sample_timing"):
            self.inspect()

    def test_max_sample_and_time_bounds(self):
        for params in (
            {"sample_count": sample.MAX_SAMPLES + 1},
            {"stts": ((sample.MAX_SAMPLES + 1, 100),),
             "sample_count": sample.MAX_SAMPLES + 1},
            {"stts": ((4, 1_000_000_001),)},
        ):
            with self.subTest(params=params):
                self.media.write_bytes(fixture(**params))
                with self.assertRaises(sample.geo.InvalidInput):
                    self.inspect()

    def test_private_cli_and_exclusive_json(self):
        registry = self.root / "registry.json"
        envelope = self.root / "capture.json"
        output = self.root / "redacted.json"
        registry.write_text(json.dumps(self.registry), encoding="utf-8")
        envelope.write_text(json.dumps(self.seal_capture()), encoding="utf-8")
        args = [
            "--media", str(self.media), "--image", str(self.image),
            "--registry", str(registry), "--profile-id", self.profile["profileId"],
            "--profile-sha256", self.profile_sha,
            "--capture-envelope", str(envelope),
            "--capture-key-file", str(self.capture_key),
            "--output", str(output), "--accept-reviewed-capture",
        ]
        self.assertEqual(sample.main(args), 0)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_text())["videoTimingSamplesUnverified"], 4)
        self.assertEqual(sample.main(args), 2)

    def test_source_and_derivative_must_be_distinct_files(self):
        # Same-file gate in shared capture worker (MP4 is not a JPEG frame).
        jpg = self.root / "source.jpg"
        jpg.write_bytes(b"synthetic source JPEG")
        with self.assertRaisesRegex(sample.geo.InvalidInput,
                                    "source_and_frame_must_be_distinct"):
            sample.capture.seal_capture(
                str(jpg), str(jpg), self.registry,
                self.profile["profileId"], self.profile_sha,
                self.capture_review, str(self.capture_key), accept_capture=True)


if __name__ == "__main__":
    unittest.main()
