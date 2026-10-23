#!/usr/bin/env python3
"""Read-only bounded MP4/MOV timebase and pinned SRT shape assessment.

Structural facts only. Neither BMFF movie times nor SRT cue times establish
camera UTC, DJI origin, frame correspondence, GNSS/AGL or gimbal synchronization.
No video frames are decoded, and no text/telemetry values are exported.
"""
import argparse
import hmac
import os
from pathlib import Path
import re
import stat
import sys

import thermal_capture_calibration_offline as capture
import thermal_person_geolocation as geo
import thermal_person_provenance_offline as provenance

SCHEMA = "skyhub-thermal-dji-video-timebase-probe-v1"
MAX_ATOMS = 128
MAX_MOOV = 1_048_576
MAX_SRT_BYTES = 131_072
MAX_SRT_CUES = 512
MAX_SRT_LINES = 4096
SRT_TIME = re.compile(
    r"^(\d{2}):([0-5]\d):([0-5]\d),(\d{3}) --> "
    r"(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$")
SRT_EXT = ".srt"


def _header(stream, offset, end):
    """Read only 8-16 atom-header bytes; reject bounds/overflows."""
    if offset + 8 > end:
        raise geo.InvalidInput("invalid_movie_atom")
    stream.seek(offset)
    initial = stream.read(8)
    if len(initial) != 8:
        raise geo.InvalidInput("truncated_movie_atom")
    size = int.from_bytes(initial[:4], "big")
    name = initial[4:]
    header = 8
    if size == 1:
        if offset + 16 > end:
            raise geo.InvalidInput("invalid_movie_atom")
        extension = stream.read(8)
        if len(extension) != 8:
            raise geo.InvalidInput("truncated_movie_atom")
        size = int.from_bytes(extension, "big")
        header = 16
    # Size zero (extending to EOF) is intentionally not interpreted here.
    if size < header or size > end - offset:
        raise geo.InvalidInput("invalid_movie_atom")
    return size, name, header


def _mvhd(movie):
    """Parse timebase/duration as untrusted container metadata only."""
    if len(movie) < 20:
        raise geo.InvalidInput("invalid_movie_header")
    version = movie[0]
    if version == 0:
        if len(movie) < 20:
            raise geo.InvalidInput("invalid_movie_header")
        scale = int.from_bytes(movie[12:16], "big")
        duration = int.from_bytes(movie[16:20], "big")
        sentinel = 0xffffffff
    elif version == 1:
        if len(movie) < 32:
            raise geo.InvalidInput("invalid_movie_header")
        scale = int.from_bytes(movie[20:24], "big")
        duration = int.from_bytes(movie[24:32], "big")
        sentinel = 0xffffffffffffffff
    else:
        raise geo.InvalidInput("unknown_movie_header_version")
    if not 1 <= scale <= 1_000_000_000 or duration == sentinel:
        raise geo.InvalidInput("invalid_movie_timebase")
    milliseconds = duration * 1000 // scale
    if milliseconds > 604_800_000:
        raise geo.InvalidInput("implausible_container_duration")
    return milliseconds


def _moov_payload(data):
    """Walk moov's direct children only; never descend to private metadata."""
    offset = 0
    mvhd = None
    tracks = 0
    atoms = 0
    size = len(data)
    while offset < size:
        if atoms >= MAX_ATOMS or offset + 8 > size:
            raise geo.InvalidInput("too_many_or_truncated_movie_atoms")
        n = int.from_bytes(data[offset:offset+4], "big")
        tag = data[offset+4:offset+8]
        header = 8
        if n == 1:
            header = 16
            if offset + 16 > size:
                raise geo.InvalidInput("invalid_movie_atom")
            n = int.from_bytes(data[offset+8:offset+16], "big")
        if n < header or n > size - offset:
            raise geo.InvalidInput("invalid_movie_atom")
        if tag == b"mvhd":
            if mvhd is not None:
                raise geo.InvalidInput("duplicate_movie_header")
            mvhd = _mvhd(data[offset+header:offset+n])
        elif tag == b"trak":
            tracks += 1
            if tracks > 64:
                raise geo.InvalidInput("too_many_tracks")
        offset += n
        atoms += 1
    if mvhd is None:
        raise geo.InvalidInput("missing_movie_timebase")
    return mvhd, tracks


def scan_movie(path):
    """Sparse top-level atom walk, reading at most 1 MiB of moov bytes."""
    path = Path(path)
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            meta = os.fstat(stream.fileno())
            if not stat.S_ISREG(meta.st_mode) or not 16 <= meta.st_size <= capture.MAX_SOURCE_BYTES:
                raise geo.InvalidInput("unsupported_movie_file")
            offset = 0
            boxes = 0
            saw_ftyp = False
            mvhd = None
            tracks = 0
            while offset < meta.st_size:
                if boxes >= MAX_ATOMS:
                    raise geo.InvalidInput("too_many_movie_atoms")
                size, kind, header = _header(stream, offset, meta.st_size)
                if boxes == 0 and kind != b"ftyp":
                    raise geo.InvalidInput("ftyp_required")
                if kind == b"ftyp":
                    if saw_ftyp or boxes != 0 or size > 4096 or size < header + 8:
                        raise geo.InvalidInput("invalid_ftyp")
                    brand = stream.read(4)
                    if len(brand) != 4 or not all(32 <= b <= 126 for b in brand):
                        raise geo.InvalidInput("invalid_ftyp")
                    saw_ftyp = True
                elif kind == b"moov":
                    if mvhd is not None or size - header > MAX_MOOV:
                        raise geo.InvalidInput("invalid_or_oversized_moov")
                    stream.seek(offset + header)
                    data = stream.read(size - header)
                    if len(data) != size - header:
                        raise geo.InvalidInput("truncated_moov")
                    mvhd, tracks = _moov_payload(data)
                offset += size  # skip mdat and all other atom bodies
                boxes += 1
            if not saw_ftyp or mvhd is None:
                raise geo.InvalidInput("incomplete_movie_structure")
            return {"movieNominalDurationMsUnverified": mvhd,
                    "movieTrackCount": tracks,
                    "movieTopLevelAtomCount": boxes}
    except OSError as error:
        raise geo.InvalidInput("movie_unavailable") from error


def _srt_clock(value):
    hours, minutes, seconds, millis = (int(x) for x in value)
    if hours > 23:
        raise geo.InvalidInput("invalid_srt_time")
    return (((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)


def inspect_srt(path, expected_sha256):
    """Read only independently SHA256-pinned local SRT, discard all cue text."""
    expected = provenance._hex(expected_sha256)
    p = Path(path)
    if not p.is_absolute() or p.suffix.lower() != SRT_EXT:
        raise geo.InvalidInput("invalid_srt_path")
    pinned = provenance._digest_path(p, MAX_SRT_BYTES)
    if not hmac.compare_digest(pinned, expected):
        raise geo.InvalidInput("unapproved_srt_bytes")
    try:
        fd = os.open(p, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            raw = stream.read(MAX_SRT_BYTES + 1)
            if not raw or len(raw) > MAX_SRT_BYTES:
                raise geo.InvalidInput("invalid_srt_size")
    except OSError as error:
        raise geo.InvalidInput("srt_unavailable") from error
    if not hmac.compare_digest(
        provenance._digest_path(p, MAX_SRT_BYTES), expected):
        raise geo.InvalidInput("srt_changed_during_read")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError as error:
        raise geo.InvalidInput("invalid_srt_encoding") from error
    if "\x00" in text:
        raise geo.InvalidInput("invalid_srt_format")
    normalized = text.replace("\r\n", "\n")
    if len(normalized.splitlines()) > MAX_SRT_LINES:
        raise geo.InvalidInput("too_many_srt_lines")
    chunks = re.split(r"\n[ \t]*\n+", normalized.strip())
    if not 1 <= len(chunks) <= MAX_SRT_CUES:
        raise geo.InvalidInput("invalid_srt_cue_count")
    last_end = -1
    first_start = None
    for index, chunk in enumerate(chunks, 1):
        lines = chunk.split("\n")
        if (not 3 <= len(lines) <= 24 or lines[0] != str(index)
                or not any(line.strip() for line in lines[2:])):
            raise geo.InvalidInput("invalid_srt_cue")
        match = SRT_TIME.fullmatch(lines[1].strip())
        if not match:
            raise geo.InvalidInput("invalid_srt_timecode")
        start = _srt_clock(match.groups()[:4])
        end = _srt_clock(match.groups()[4:])
        if start >= end or start < last_end:
            raise geo.InvalidInput("nonmonotonic_srt_timecode")
        if first_start is None:
            first_start = start
        last_end = end
    return {
        "srtPinnedBytesVerified": True,
        "srtCueCount": len(chunks),
        "srtRelativeSpanMsUnverified": last_end - first_start,
        "srtCueTimecodesMonotonic": True,
    }


def inspect(media, image, envelope, registry, profile_id, profile_sha256,
            capture_key_file, *, srt=None, expected_srt_sha256=None):
    # Existing independent manual-review HMAC and camera profile gate FIRST.
    payload, _profile = capture.verify_capture(
        envelope, media, image, registry, profile_id, profile_sha256,
        capture_key_file)
    source = capture._source(media)
    movie = source.suffix.lower() in (".mp4", ".mov")
    if (srt is None) != (expected_srt_sha256 is None):
        raise geo.InvalidInput("srt_and_pinned_digest_required_together")
    if not movie and srt is not None:
        raise geo.InvalidInput("srt_requires_movie_source")
    result = {
        "schema": SCHEMA,
        "status": "movie-header-observed" if movie else "unsupported-media-format",
        "captureEnvelopeIntegrityVerified": True,
        "movieContainerStructureParsed": False,
        "movieNominalDurationMsUnverified": None,
        "movieTrackCount": 0, "movieTopLevelAtomCount": 0,
        "srtPinnedBytesVerified": False, "srtCueCount": 0,
        "srtRelativeSpanMsUnverified": None,
        "srtCueTimecodesMonotonic": False,
        "djiSensorOriginVerified": False,
        "movieClockUtcVerified": False,
        "srtVideoAlignmentVerified": False,
        "frameTimestampUtcVerified": False,
        "telemetryTimebaseVerified": False,
        "positionVerified": False, "altitudeAglVerified": False,
        "gimbalPoseVerified": False, "geolocationVerified": False,
        "accuracyMetersVerified": False,
        "flightControlReady": False, "searchAndRescueReady": False,
    }
    if movie:
        result.update(scan_movie(source))
        result["movieContainerStructureParsed"] = True
        if srt is not None:
            result.update(inspect_srt(srt, expected_srt_sha256))
        # Refuse TOCTOU mutation after structure and optionally SRT parsing.
        if not hmac.compare_digest(
            provenance._digest_path(source, capture.MAX_SOURCE_BYTES),
            payload["sourceMediaSha256"]):
            raise geo.InvalidInput("movie_changed_during_probe")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Private MP4/MOV/SRT structural timebase only; no DJI telemetry")
    parser.add_argument("--media", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--profile-sha256", required=True)
    parser.add_argument("--capture-envelope", required=True)
    parser.add_argument("--capture-key-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--srt")
    parser.add_argument("--srt-sha256")
    parser.add_argument("--accept-reviewed-capture", action="store_true")
    args = parser.parse_args(argv)
    if not args.accept_reviewed_capture:
        parser.error("Explicit manually reviewed capture opt-in required")
    try:
        result = inspect(
            args.media, args.image, geo._read_local_input(args.capture_envelope),
            geo._read_local_input(args.registry), args.profile_id,
            args.profile_sha256, args.capture_key_file,
            srt=args.srt, expected_srt_sha256=args.srt_sha256,
        )
        geo._write_local_output(args.output, result)
    except Exception:
        # Deliberate generic error: never leak SRT/GPS values, paths or hashes.
        print("Offline movie timebase check refused", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
