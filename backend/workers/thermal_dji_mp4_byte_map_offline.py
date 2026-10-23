#!/usr/bin/env python3
"""Offline, bounded MP4 encoded-sample byte-range *structural* mapping.

HMAC binds exact complete source bytes via the parent capture workflow.
Read moov table data, but NEVER read or decode mdat media payload. stsc,
stco/co64, stsz and stsd claims are checked against one bounded mdat extent.
The output is aggregate only, no offsets, per-frame times, GPS or SRT text.
"""
import argparse
import hmac
import os
from pathlib import Path
import stat
import sys

import thermal_dji_mp4_sample_timing_offline as sample
import thermal_dji_video_timebase_offline as movie
import thermal_capture_calibration_offline as capture
import thermal_person_geolocation as geo
import thermal_person_provenance_offline as provenance

SCHEMA = "skyhub-thermal-mp4-video-sample-byte-map-v1"
MAX_CHUNKS = 4096
MAX_SAMPLE_BYTES = 64 * 1024 * 1024
ALLOWED_CODECS = {b"avc1": "H264-container-hint",
                  b"avc3": "H264-container-hint",
                  b"hvc1": "H265-container-hint",
                  b"hev1": "H265-container-hint"}


def _table(raw, entry_size):
    if len(raw) < 8 or raw[:4] != b"\x00\x00\x00\x00":
        raise geo.InvalidInput("invalid_video_sample_map_table")
    count = sample._u(raw, 4)
    if not 1 <= count <= MAX_CHUNKS or len(raw) != 8 + entry_size * count:
        raise geo.InvalidInput("unsupported_video_sample_map_table")
    return count


def _descriptions(stbl):
    raw = sample._one(stbl, b"stsd")
    count = _table(raw, 0) if len(raw) == 8 else None
    # stsd uses variable-length sample entries; only a single media label is
    # supported. Its value is explicitly an untrusted container hint.
    if count is None:
        if len(raw) < 16 or raw[:4] != b"\0\0\0\0":
            raise geo.InvalidInput("invalid_video_sample_description")
        count = sample._u(raw, 4)
    if count != 1:
        raise geo.InvalidInput("ambiguous_video_sample_description")
    if len(raw) < 8 + 86:
        raise geo.InvalidInput("short_video_sample_description")
    entry_size = sample._u(raw, 8)
    codec = raw[12:16]
    if codec not in ALLOWED_CODECS or entry_size < 86 or 8 + entry_size != len(raw):
        raise geo.InvalidInput("unsupported_video_sample_description")
    return ALLOWED_CODECS[codec]


def _sample_sizes(stbl, total):
    raw = sample._one(stbl, b"stsz")
    if len(raw) < 12 or raw[:4] != b"\0\0\0\0":
        raise geo.InvalidInput("invalid_video_sample_sizes")
    fixed = sample._u(raw, 4)
    count = sample._u(raw, 8)
    if count != total or not 1 <= count <= sample.MAX_SAMPLES:
        raise geo.InvalidInput("video_sample_count_mismatch")
    if fixed:
        if len(raw) != 12 or fixed > MAX_SAMPLE_BYTES:
            raise geo.InvalidInput("invalid_fixed_video_sample_size")
        return [fixed] * count
    if len(raw) != 12 + count * 4:
        raise geo.InvalidInput("invalid_variable_video_sample_sizes")
    sizes = [sample._u(raw, 12 + i * 4) for i in range(count)]
    if any(size < 1 or size > MAX_SAMPLE_BYTES for size in sizes):
        raise geo.InvalidInput("invalid_video_sample_size")
    return sizes


def _chunk_offsets(stbl):
    a = sample._one(stbl, b"stco", required=False)
    b = sample._one(stbl, b"co64", required=False)
    if (a is None) == (b is None):
        raise geo.InvalidInput("missing_or_ambiguous_chunk_offsets")
    is64 = b is not None
    raw = b if is64 else a
    count = _table(raw, 8 if is64 else 4)
    width = 8 if is64 else 4
    offsets = [sample._u(raw, 8 + i * width, width) for i in range(count)]
    if any(offset == 0 for offset in offsets):
        raise geo.InvalidInput("invalid_chunk_offset")
    return offsets, is64


def _chunk_layout(stbl, count):
    raw = sample._one(stbl, b"stsc")
    groups = _table(raw, 12)
    layout = []
    last_first = 0
    for i in range(groups):
        pos = 8 + 12 * i
        first = sample._u(raw, pos)
        per_chunk = sample._u(raw, pos + 4)
        description = sample._u(raw, pos + 8)
        if (first <= last_first or first > count or
                per_chunk < 1 or per_chunk > sample.MAX_SAMPLES or
                description != 1):
            raise geo.InvalidInput("invalid_sample_to_chunk")
        if i == 0 and first != 1:
            raise geo.InvalidInput("sample_to_chunk_must_start_at_one")
        layout.append((first, per_chunk))
        last_first = first
    return layout


def _video_stbl(moov):
    if sample._one(moov, b"mvex", required=False) is not None:
        raise geo.InvalidInput("fragmented_mp4_not_supported")
    selected = None
    for kind, track in sample._children(moov):
        if kind != b"trak":
            continue
        if sample._one(track, b"edts", required=False) is not None:
            raise geo.InvalidInput("edit_lists_not_supported")
        mdia = sample._one(track, b"mdia")
        if sample._handler(sample._one(mdia, b"hdlr")) != b"vide":
            continue
        if selected is not None:
            raise geo.InvalidInput("ambiguous_multiple_video_tracks")
        minf = sample._one(mdia, b"minf")
        selected = sample._one(minf, b"stbl")
    if selected is None:
        raise geo.InvalidInput("missing_video_sample_tables")
    return selected


def _mdat_extent(source):
    """Identify one mdat payload via seek/read of headers only."""
    try:
        fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 16 <= info.st_size <= capture.MAX_SOURCE_BYTES:
                raise geo.InvalidInput("invalid_video_source")
            pos = 0
            count = 0
            extent = None
            while pos < info.st_size:
                if count >= movie.MAX_ATOMS:
                    raise geo.InvalidInput("too_many_movie_atoms")
                size, tag, header = movie._header(stream, pos, info.st_size)
                if tag == b"mdat":
                    if extent is not None:
                        raise geo.InvalidInput("multiple_mdat_not_supported")
                    extent = (pos + header, pos + size)
                elif tag in (b"moof", b"mfra"):
                    raise geo.InvalidInput("fragmented_mp4_not_supported")
                pos += size
                count += 1
            if extent is None or extent[1] <= extent[0]:
                raise geo.InvalidInput("missing_video_media_payload")
            return extent
    except OSError as error:
        raise geo.InvalidInput("unavailable_video_file") from error


def _map(stbl, extent, total):
    codec = _descriptions(stbl)
    sizes = _sample_sizes(stbl, total)
    offsets, uses_64 = _chunk_offsets(stbl)
    layout = _chunk_layout(stbl, len(offsets))
    group = 0
    previous_end = extent[0]
    cursor = 0
    total_bytes = 0
    for i, offset in enumerate(offsets, 1):
        while group + 1 < len(layout) and i >= layout[group + 1][0]:
            group += 1
        samples_in_chunk = layout[group][1]
        if cursor + samples_in_chunk > total:
            raise geo.InvalidInput("sample_chunk_coverage_excess")
        span = sum(sizes[cursor:cursor + samples_in_chunk])
        stop = offset + span
        if (offset < extent[0] or offset < previous_end or stop > extent[1]):
            raise geo.InvalidInput("sample_outside_mdat_or_overlapping")
        cursor += samples_in_chunk
        total_bytes += span
        previous_end = stop
    if cursor != total:
        raise geo.InvalidInput("incomplete_video_sample_chunk_coverage")
    return {
        "videoIndexedSamplesUnverified": total,
        "videoIndexedChunksUnverified": len(offsets),
        "videoIndexedPayloadBytesUnverified": total_bytes,
        "videoChunkOffsetWidthBits": 64 if uses_64 else 32,
        "videoCodecLabelUnverified": codec,
        "videoSampleByteRangesStructurallyMapped": True,
        "videoEncodedSampleBytesDecoded": False,
        "videoSamplePayloadAuthenticityVerified": False,
        "videoFrameDecodeVerified": False,
        "videoSampleUtcVerified": False,
        "srtToSampleAlignmentVerified": False,
        "perFramePoseAligned": False,
    }


def inspect(media, image, envelope, registry, profile_id, profile_sha256,
            capture_key_file, *, srt=None, expected_srt_sha256=None):
    """Verify complete sealed capture before mapping; rehash source at end."""
    report = sample.analyze(
        media, image, envelope, registry, profile_id, profile_sha256,
        capture_key_file, srt=srt, expected_srt_sha256=expected_srt_sha256)
    if not report["movieContainerStructureParsed"]:
        raise geo.InvalidInput("video_required")
    source = capture._source(media)
    raw = sample._moov(source)
    stbl = _video_stbl(raw)
    expected_samples = report["videoTimingSamplesUnverified"]
    extent = _mdat_extent(source)
    result = _map(stbl, extent, expected_samples)
    if not hmac.compare_digest(
        provenance._digest_path(source, capture.MAX_SOURCE_BYTES),
        provenance._hex(envelope["sourceMediaSha256"])):
        raise geo.InvalidInput("video_changed_during_offset_check")
    report.update(result)
    report["schema"] = SCHEMA
    report["status"] = "relative-video-byte-map-observed"
    # SRT relative cues may differ from movie samples: no shared UTC,
    # source anchoring or proof of per-frame relation is ever implied.
    if report["srtPinnedBytesVerified"]:
        report["srtVsVideoDecodeSpanDifferenceMsUnverified"] = abs(
            report["srtRelativeSpanMsUnverified"] -
            report["videoDecodeSpanMsUnverified"])
    else:
        report["srtVsVideoDecodeSpanDifferenceMsUnverified"] = None
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Offline private MP4 video sample offset tables; no frame decoding")
    for name in ("media", "image", "registry", "profile-id", "profile-sha256",
                 "capture-envelope", "capture-key-file", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--srt")
    parser.add_argument("--srt-sha256")
    parser.add_argument("--accept-reviewed-capture", action="store_true")
    args = parser.parse_args(argv)
    if not args.accept_reviewed_capture:
        parser.error("Explicit signed capture review required")
    try:
        result = inspect(
            args.media, args.image, geo._read_local_input(args.capture_envelope),
            geo._read_local_input(args.registry), args.profile_id,
            args.profile_sha256, args.capture_key_file,
            srt=args.srt, expected_srt_sha256=args.srt_sha256)
        geo._write_local_output(args.output, result)
    except Exception:
        # Fixed redacted message: no source paths, offsets, hashes or GPS.
        print("Private video byte-range mapping refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
