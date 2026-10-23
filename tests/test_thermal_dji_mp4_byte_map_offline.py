"""Offline MP4 encoded-sample mdat mapping; synthetic files, no hardware."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

WORKERS = Path(__file__).resolve().parents[1] / "backend/workers"
sys.path.insert(0, str(WORKERS))
SPEC = importlib.util.spec_from_file_location(
    "thermal_dji_mp4_byte_map_offline",
    WORKERS / "thermal_dji_mp4_byte_map_offline.py")
mapping = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mapping)

from test_thermal_capture_calibration_offline import CaptureCalibrationTest
from test_thermal_dji_video_timebase_offline import atom, movie, SRT
from test_thermal_dji_mp4_sample_timing_offline import videotrack, fullbox

PAYLOAD = b"PRIVATE ENCODED DJI-LIKE SAMPLE 49.123 " * 3
assert len(PAYLOAD) > 96
PAYLOAD = PAYLOAD[:96]
FIRST_MDAT_BYTE = 28  # synthetic ftyp box=20 + mdat header=8
VIDEO_SAMPLE_SIZE = 24


def u32(value):
    return value.to_bytes(4, "big")


def stsd(codec=b"avc1", entries=1):
    item = atom(codec, bytes(78))
    return atom(b"stsd", fullbox() + u32(entries) + item)


def stsc(rows=((1, 2, 1),)):
    return atom(b"stsc", fullbox() + u32(len(rows)) +
                b"".join(b"".join(u32(z) for z in row) for row in rows))


def chunk_offsets(items=(28, 76), *, bits=32):
    tag = b"co64" if bits == 64 else b"stco"
    return atom(tag, fullbox() + u32(len(items)) +
                b"".join(v.to_bytes(bits // 8, "big") for v in items))


def build_video(*, chunks=(28, 76), rows=((1, 2, 1),), bits=32,
                codec=b"avc1", extra=b"", sample_count=4,
                sample_sizes=None, media=PAYLOAD, extra_movie=b"",
                descriptions=1):
    tables = (stsd(codec=codec, entries=descriptions) +
              stsc(rows) + chunk_offsets(chunks, bits=bits) + extra)
    track = videotrack(sample_count=sample_count, extra_stbl=tables)
    if sample_sizes is not None:
        # Rebuild *all* parent atom lengths; a raw byte replacement inside
        # an existing moov would produce an invalid ISO-BMFF container.
        replacement = atom(b"stsz", fullbox() + u32(0) +
                           u32(len(sample_sizes)) +
                           b"".join(u32(n) for n in sample_sizes))
        stts = atom(b"stts", fullbox() + u32(1) + u32(4) + u32(100))
        stbl = atom(b"stbl", stts + replacement + tables)
        mdhd = atom(b"mdhd", fullbox() + bytes(8) + u32(1000) +
                    u32(400) + bytes(4))
        hdlr = atom(b"hdlr", fullbox() + bytes(4) + b"vide" + bytes(8))
        track = atom(b"trak", atom(b"mdia", mdhd + hdlr +
                                  atom(b"minf", stbl)))
    return movie(tracks=0, extras=track + extra_movie, mdat=media)


class Mp4ByteMapTest(CaptureCalibrationTest):
    def setUp(self):
        super().setUp()
        self.media = self.root / "synthetic-video.mp4"
        self.media.write_bytes(build_video())
        self.srt = self.root / "sensitive.srt"
        self.srt.write_text(SRT, encoding="utf-8")
        self.srt_sha = hashlib.sha256(self.srt.read_bytes()).hexdigest()

    def analyze(self, envelope=None, *, srt=False):
        return mapping.inspect(
            str(self.media), str(self.image),
            self.seal_capture() if envelope is None else envelope,
            self.registry, self.profile["profileId"], self.profile_sha,
            str(self.capture_key),
            srt=str(self.srt) if srt else None,
            expected_srt_sha256=self.srt_sha if srt else None)

    def test_valid_chunk_offsets_and_counts_structurally_mapped(self):
        result = self.analyze()
        self.assertEqual(result["schema"], mapping.SCHEMA)
        self.assertEqual(result["status"], "relative-video-byte-map-observed")
        self.assertEqual(result["videoIndexedSamplesUnverified"], 4)
        self.assertEqual(result["videoIndexedChunksUnverified"], 2)
        self.assertEqual(result["videoIndexedPayloadBytesUnverified"], 96)
        self.assertEqual(result["videoChunkOffsetWidthBits"], 32)
        self.assertEqual(result["videoCodecLabelUnverified"], "H264-container-hint")
        self.assertTrue(result["videoSampleByteRangesStructurallyMapped"])
        for field in ("videoEncodedSampleBytesDecoded",
                      "videoSamplePayloadAuthenticityVerified",
                      "videoFrameDecodeVerified", "videoSampleUtcVerified",
                      "srtToSampleAlignmentVerified", "perFramePoseAligned",
                      "djiSensorOriginVerified", "geolocationVerified",
                      "flightControlReady", "searchAndRescueReady"):
            self.assertIs(result[field], False)
        for private in (str(self.root), "PRIVATE", "49.123",
                        "sourceMediaSha256", "chunkOffsets", "sampleByteOffset"):
            self.assertNotIn(private, json.dumps(result))

    def test_co64_and_hevc_container_hint(self):
        self.media.write_bytes(build_video(bits=64, codec=b"hvc1"))
        result = self.analyze()
        self.assertEqual(result["videoChunkOffsetWidthBits"], 64)
        self.assertEqual(result["videoCodecLabelUnverified"], "H265-container-hint")
        self.assertTrue(result["videoSampleByteRangesStructurallyMapped"])

    def test_variable_video_sample_sizes_and_chunk_spans(self):
        self.media.write_bytes(build_video(chunks=(28, 48),
                             sample_sizes=(10, 10, 30, 46)))
        result = self.analyze()
        self.assertEqual(result["videoIndexedPayloadBytesUnverified"], 96)
        self.assertTrue(result["videoSampleByteRangesStructurallyMapped"])

    def test_srt_duration_comparison_cannot_claim_alignment(self):
        result = self.analyze(srt=True)
        self.assertTrue(result["srtPinnedBytesVerified"])
        self.assertEqual(result["srtVsVideoDecodeSpanDifferenceMsUnverified"], 500)
        self.assertIs(result["srtToSampleAlignmentVerified"], False)
        self.assertIs(result["perFramePoseAligned"], False)
        self.assertIs(result["frameTimestampUtcVerified"], False)

    def test_invalid_offsets_outside_mdat_or_overlap(self):
        for offsets in ((0, 76), (20, 76), (29, 76), (28, 70),
                        (28, 5000), (76, 28)):
            with self.subTest(offsets=offsets):
                self.media.write_bytes(build_video(chunks=offsets))
                with self.assertRaises(mapping.geo.InvalidInput):
                    self.analyze()

    def test_inconsistent_stsc_chunk_coverage(self):
        for rows in (
            ((1, 1, 1),), ((1, 3, 1),),
            ((2, 2, 1),), ((1, 0, 1),),
            ((1, 2, 0),), ((1, 2, 2),),
            ((1, 2, 1), (1, 2, 1)),
            ((1, 2, 1), (3, 2, 1)),
        ):
            with self.subTest(rows=rows):
                self.media.write_bytes(build_video(rows=rows))
                with self.assertRaises(mapping.geo.InvalidInput):
                    self.analyze()

    def test_unsupported_encrypted_or_ambiguous_sample_descriptions(self):
        for codec in (b"encv", b"abcd", b"mp4v"):
            with self.subTest(codec=codec):
                self.media.write_bytes(build_video(codec=codec))
                with self.assertRaises(mapping.geo.InvalidInput):
                    self.analyze()
        self.media.write_bytes(build_video(descriptions=2))
        with self.assertRaises(mapping.geo.InvalidInput):
            self.analyze()

    def test_duplicate_and_missing_offset_boxes_refused(self):
        for extra in (chunk_offsets((28, 76)),
                      chunk_offsets((28, 76), bits=64)):
            self.media.write_bytes(build_video(extra=extra))
            with self.assertRaises(mapping.geo.InvalidInput):
                self.analyze()
        self.media.write_bytes(build_video().replace(
            b"stco", b"junk", 1))
        with self.assertRaises(mapping.geo.InvalidInput):
            self.analyze()

    def test_missing_stsd_and_bad_stsz_refused(self):
        original = build_video()
        for changed in (original.replace(b"stsd", b"junk", 1),
                        original.replace(b"stsc", b"junk", 1),
                        original.replace(b"stsz", b"junk", 1),
                        build_video(sample_sizes=(24, 24, 24, 0)),
                        build_video(sample_sizes=(24, 24, 24, 64)),
                        build_video(sample_count=3)):
            with self.subTest(length=len(changed)):
                self.media.write_bytes(changed)
                with self.assertRaises(mapping.geo.InvalidInput):
                    self.analyze()

    def test_multiple_mdat_boxes_rejected(self):
        self.media.write_bytes(build_video() + atom(b"mdat", b"second"))
        with self.assertRaisesRegex(mapping.geo.InvalidInput,
                                    "multiple_mdat_not_supported"):
            self.analyze()

    def test_source_change_after_capture_seal_rejected(self):
        envelope = self.seal_capture()
        self.media.write_bytes(build_video(chunks=(28, 77)))
        with self.assertRaises(mapping.geo.InvalidInput):
            self.analyze(envelope=envelope)

    def test_extra_unmapped_trailing_mdat_bytes_do_not_prove_frame_decoder(self):
        self.media.write_bytes(build_video(
            media=PAYLOAD + b"PRIVATE TRAILING AUDIO OR PADDING"))
        result = self.analyze()
        self.assertEqual(result["videoIndexedPayloadBytesUnverified"], 96)
        self.assertFalse(result["videoEncodedSampleBytesDecoded"])
        self.assertNotIn("AUDIO", json.dumps(result))

    def test_private_cli_no_replacement_of_existing_output(self):
        registry = self.root / "registry.json"
        envelope = self.root / "capture.json"
        output = self.root / "mapped-summary.json"
        registry.write_text(json.dumps(self.registry), encoding="utf-8")
        envelope.write_text(json.dumps(self.seal_capture()), encoding="utf-8")
        args = ["--media", str(self.media), "--image", str(self.image),
                "--registry", str(registry), "--profile-id", self.profile["profileId"],
                "--profile-sha256", self.profile_sha,
                "--capture-envelope", str(envelope),
                "--capture-key-file", str(self.capture_key),
                "--output", str(output), "--accept-reviewed-capture"]
        self.assertEqual(mapping.main(args), 0)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_text())["videoIndexedSamplesUnverified"], 4)
        self.assertEqual(mapping.main(args), 2)

    def test_source_and_derivative_must_be_distinct_files(self):
        jpg = self.root / "same-file.jpg"
        jpg.write_bytes(b"synthetic jpeg")
        with self.assertRaisesRegex(mapping.geo.InvalidInput,
                                    "source_and_frame_must_be_distinct"):
            mapping.capture.seal_capture(
                str(jpg), str(jpg), self.registry,
                self.profile["profileId"], self.profile_sha,
                self.capture_review, str(self.capture_key), accept_capture=True)


if __name__ == "__main__":
    unittest.main()
