#!/usr/bin/env python3
"""Bounded offline BMFF video sample-timing *structure*, not verified UTC.

Read moov/trak/mdia/minf/stbl timing tables stts/ctts/stsz only. No mdat,
packet decoding, GPS, DJI telemetry, sample-to-file-offset association,
timestamp export, camera origin claim, or SRT/frame synchronization.
"""
import argparse
import hmac
import os
from pathlib import Path
import stat
import sys

import thermal_dji_video_timebase_offline as movie
import thermal_capture_calibration_offline as capture
import thermal_person_geolocation as geo
import thermal_person_provenance_offline as provenance

SCHEMA = "skyhub-thermal-mp4-relative-video-sample-timing-v1"
MAX_ENTRIES = 4096
MAX_SAMPLES = 65536
MAX_BOXES = 128
MAX_SECONDS = 604800


def _u(raw, start, count=4, *, signed=False):
    if start < 0 or start + count > len(raw):
        raise geo.InvalidInput("invalid_video_timing_box")
    return int.from_bytes(raw[start:start + count], "big", signed=signed)


def _children(raw, *, reject=()):
    """One bounded level of ISO BMFF boxes, refusing duplicates on demand."""
    pos = 0
    count = 0
    while pos < len(raw):
        if count >= MAX_BOXES or pos + 8 > len(raw):
            raise geo.InvalidInput("invalid_nested_movie_structure")
        n = _u(raw, pos)
        name = raw[pos + 4:pos + 8]
        header = 8
        if n == 1:
            header = 16
            n = _u(raw, pos + 8, 8)
        if n < header or n > len(raw) - pos or name in reject:
            raise geo.InvalidInput("unsupported_nested_movie_structure")
        yield name, raw[pos + header:pos + n]
        pos += n
        count += 1


def _one(raw, kind, *, required=True, reject=()):
    result = None
    for name, data in _children(raw, reject=reject):
        if name == kind:
            if result is not None:
                raise geo.InvalidInput("duplicate_video_timing_box")
            result = data
    if result is None and required:
        raise geo.InvalidInput("missing_video_timing_box")
    return result


def _mdhd(raw):
    version = _u(raw, 0, 1)
    if version == 0 and len(raw) >= 24:
        scale = _u(raw, 12)
        duration = _u(raw, 16)
        sentinel = 0xffffffff
    elif version == 1 and len(raw) >= 36:
        scale = _u(raw, 20)
        duration = _u(raw, 24, 8)
        sentinel = 0xffffffffffffffff
    else:
        raise geo.InvalidInput("unsupported_track_timebase")
    if (not 1 <= scale <= 1_000_000_000 or duration == sentinel or
            duration * 1000 // scale > MAX_SECONDS * 1000):
        raise geo.InvalidInput("invalid_track_timebase")
    return scale


def _handler(raw):
    # hdlr fullbox: version/flags 4 + pre_defined 4 + handler_type 4.
    if len(raw) < 12 or raw[:4] != b"\0\0\0\0":
        raise geo.InvalidInput("invalid_track_handler")
    return raw[8:12]


def _entries(raw, *, signed_delta=False, kind="stts"):
    if len(raw) < 8 or raw[:4] != b"\0\0\0\0":
        if kind == "ctts" and len(raw) >= 8 and raw[:4] == b"\x01\0\0\0":
            signed_delta = True
        else:
            raise geo.InvalidInput("invalid_sample_timing_table")
    n = _u(raw, 4)
    if not 1 <= n <= MAX_ENTRIES or len(raw) != 8 + n * 8:
        raise geo.InvalidInput("invalid_sample_timing_table")
    groups = []
    total = 0
    for i in range(n):
        count = _u(raw, 8 + 8 * i)
        delta = _u(raw, 12 + 8 * i, signed=signed_delta)
        if not 1 <= count <= MAX_SAMPLES or total + count > MAX_SAMPLES:
            raise geo.InvalidInput("excessive_video_samples")
        if kind == "stts":
            if not 1 <= delta <= 1_000_000_000:
                raise geo.InvalidInput("invalid_decode_interval")
        elif not -1_000_000_000 <= delta <= 1_000_000_000:
            raise geo.InvalidInput("invalid_composition_offset")
        groups.append((count, delta))
        total += count
    return groups, total


def _sample_sizes(raw, expected_count):
    if (len(raw) < 12 or raw[:4] != b"\0\0\0\0" or
            _u(raw, 8) != expected_count):
        raise geo.InvalidInput("sample_count_mismatch")
    fixed = _u(raw, 4)
    if fixed > 0:
        if len(raw) != 12:
            raise geo.InvalidInput("invalid_sample_size_table")
    else:
        if len(raw) != 12 + 4 * expected_count:
            raise geo.InvalidInput("invalid_sample_size_table")
        for i in range(expected_count):
            if _u(raw, 12 + i * 4) == 0:
                raise geo.InvalidInput("zero_sample_size")


def _video_table(track):
    if _one(track, b"edts", required=False) is not None:
        raise geo.InvalidInput("edit_lists_not_supported")
    mdia = _one(track, b"mdia")
    handler = _handler(_one(mdia, b"hdlr"))
    if handler != b"vide":
        return None
    timescale = _mdhd(_one(mdia, b"mdhd"))
    minf = _one(mdia, b"minf")
    stbl = _one(minf, b"stbl")
    if _one(stbl, b"stz2", required=False) is not None:
        raise geo.InvalidInput("compact_sample_sizes_unsupported")
    stts, total = _entries(_one(stbl, b"stts"), kind="stts")
    ctts_raw = _one(stbl, b"ctts", required=False)
    ctts, composition_count = (
        _entries(ctts_raw, kind="ctts") if ctts_raw is not None else
        ([(total, 0)], total))
    if composition_count != total:
        raise geo.InvalidInput("composition_sample_count_mismatch")
    _sample_sizes(_one(stbl, b"stsz"), total)
    # This stage deliberately does NOT parse stco/co64/stsc or stsd:
    # observed timing-table entries are NOT a validated media-payload map.
    return timescale, stts, ctts, total, ctts_raw is not None


def _aggregate(track):
    scale, stts, ctts, count, has_ctts = track
    decode = 0
    min_pts = None
    max_pts_end = None
    first_pts = None
    last_pts = None
    reorder = False
    cidx = 0
    cused = 0
    for samples, delta in stts:
        for _ in range(samples):
            while cused == ctts[cidx][0]:
                cidx += 1
                cused = 0
            offset = ctts[cidx][1]
            cused += 1
            pts = decode + offset
            if abs(pts) > scale * MAX_SECONDS:
                raise geo.InvalidInput("composition_out_of_bounds")
            if first_pts is None:
                first_pts = pts
            if last_pts is not None and pts < last_pts:
                reorder = True
            last_pts = pts
            min_pts = pts if min_pts is None else min(min_pts, pts)
            end = pts + delta
            max_pts_end = end if max_pts_end is None else max(max_pts_end, end)
            decode += delta
            if decode > scale * MAX_SECONDS:
                raise geo.InvalidInput("decode_timeline_too_long")
    if decode == 0 or min_pts is None:
        raise geo.InvalidInput("empty_sample_timeline")
    return {
        "videoTimingSamplesUnverified": count,
        "videoTrackTimescaleUnverified": scale,
        "videoDecodeSpanMsUnverified": decode * 1000 // scale,
        "videoCompositionSpanMsUnverified": (
            (max_pts_end - min_pts) * 1000 // scale),
        "videoCompositionOffsetsPresent": has_ctts,
        "videoCompositionOrderDiffersFromDecodeOrder": reorder,
        "videoSampleTableCountsConsistent": True,
        "videoSamplePayloadMapped": False,
        "videoFrameDecodeVerified": False,
        "videoSampleUtcVerified": False,
        "srtToSampleAlignmentVerified": False,
        "perFramePoseAligned": False,
    }


def _moov(source):
    # Read bounded moov bytes; all compressed video content is skipped.
    path = Path(source)
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > capture.MAX_SOURCE_BYTES:
                raise geo.InvalidInput("invalid_video_source")
            pos = 0
            boxes = 0
            payload = None
            while pos < info.st_size:
                if boxes >= movie.MAX_ATOMS:
                    raise geo.InvalidInput("too_many_movie_atoms")
                n, kind, header = movie._header(stream, pos, info.st_size)
                if kind in (b"moof", b"mfra"):
                    raise geo.InvalidInput("fragmented_mp4_not_supported")
                if kind == b"moov":
                    if payload is not None or n - header > movie.MAX_MOOV:
                        raise geo.InvalidInput("ambiguous_movie_header")
                    stream.seek(pos + header)
                    payload = stream.read(n - header)
                    if len(payload) != n - header:
                        raise geo.InvalidInput("truncated_movie_header")
                pos += n
                boxes += 1
            if payload is None:
                raise geo.InvalidInput("missing_movie_header")
            return payload
    except OSError as error:
        raise geo.InvalidInput("video_source_unavailable") from error


def analyze(media, image, envelope, registry, profile_id, profile_sha256,
            capture_key_file, *, srt=None, expected_srt_sha256=None):
    """Require existing capture/SRT gates; return only unverified time stats."""
    base = movie.inspect(
        media, image, envelope, registry, profile_id,
        profile_sha256, capture_key_file,
        srt=srt, expected_srt_sha256=expected_srt_sha256)
    base["schema"] = SCHEMA
    base["videoSampleTableCountsConsistent"] = False
    base["videoSamplePayloadMapped"] = False
    base["videoFrameDecodeVerified"] = False
    base["videoSampleUtcVerified"] = False
    base["srtToSampleAlignmentVerified"] = False
    base["perFramePoseAligned"] = False
    if not base["movieContainerStructureParsed"]:
        return base
    source = capture._source(media)
    raw = _moov(source)
    if _one(raw, b"mvex", required=False) is not None:
        raise geo.InvalidInput("fragmented_mp4_not_supported")
    video = None
    for kind, payload in _children(raw):
        if kind == b"trak":
            candidate = _video_table(payload)
            if candidate is not None:
                if video is not None:
                    raise geo.InvalidInput("ambiguous_multiple_video_tracks")
                video = candidate
    if video is None:
        raise geo.InvalidInput("no_video_sample_timing")
    # Full source is HMAC-bound before probing and rehashed afterwards.
    sealed_sha = provenance._hex(envelope["sourceMediaSha256"])
    if not hmac.compare_digest(
            provenance._digest_path(source, capture.MAX_SOURCE_BYTES), sealed_sha):
        raise geo.InvalidInput("movie_changed_during_sample_probe")
    base.update(_aggregate(video))
    base["status"] = "relative-video-sample-timing-observed"
    return base


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Isolated relative MP4 DTS/PTS sample-table research gate")
    for name in ("media", "image", "registry", "profile-id", "profile-sha256",
                 "capture-envelope", "capture-key-file", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--srt")
    parser.add_argument("--srt-sha256")
    parser.add_argument("--accept-reviewed-capture", action="store_true")
    args = parser.parse_args(argv)
    if not args.accept_reviewed_capture:
        parser.error("Explicit private reviewed capture required")
    try:
        result = analyze(
            args.media, args.image, geo._read_local_input(args.capture_envelope),
            geo._read_local_input(args.registry), args.profile_id,
            args.profile_sha256, args.capture_key_file,
            srt=args.srt, expected_srt_sha256=args.srt_sha256)
        geo._write_local_output(args.output, result)
    except Exception:
        print("Private video sample timing refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
