"""DJI Cloud API wire-level contracts used by SkyHub.

This module is a security-reviewed Python interpretation of protocol constants
and value domains from the retired MIT-licensed DJI Cloud API Demo. It does not
import the demo's server, authentication, storage, controller, or control code.

Reference snapshot:
  dji-sdk/DJI-Cloud-API-Demo@bef525cb92772b06786c1e033719a6fa1b94bcc5
"""
from __future__ import annotations

import re
from typing import Final

SERIAL_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9]+$")
PAYLOAD_INDEX_PATTERN: Final[re.Pattern[str]] = re.compile(r"^\d+-\d+-\d+$")

LIVE_URL_TYPES: Final[dict[int, str]] = {
    0: "agora",
    1: "rtmp",
    2: "rtsp",
    3: "gb28181",
    4: "whip",
}

VIDEO_QUALITIES: Final[dict[int, str]] = {
    0: "auto",
    1: "smooth",
    2: "standard_definition",
    3: "high_definition",
    4: "ultra_hd",
}

VIDEO_TYPES: Final[frozenset[str]] = frozenset({
    "zoom",
    "wide",
    "thermal",
    "normal",
    "ir",
})

SKYHUB_ALLOWED_SERVICE_METHODS: Final[frozenset[str]] = frozenset({
    "live_start_push",
    "live_stop_push",
})

DJI_INBOUND_SUBSCRIPTIONS: Final[tuple[str, ...]] = (
    "sys/product/+/status",
    "thing/product/+/osd",
    "thing/product/+/state",
    "thing/product/+/events",
    "thing/product/+/requests",
    "thing/product/+/services_reply",
)

_TOPIC_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("status", re.compile(r"^sys/product/(?P<sn>[A-Za-z0-9]+)/status$")),
    ("state", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/state$")),
    ("services_reply", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/services_reply$")),
    ("osd", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/osd$")),
    ("requests", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/requests$")),
    ("events", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/events$")),
    ("property_set_reply", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/property/set_reply$")),
    ("drc_up", re.compile(r"^thing/product/(?P<sn>[A-Za-z0-9]+)/drc/up$")),
)


class DjiProtocolValueError(ValueError):
    pass


def validate_serial(value: str) -> str:
    if not isinstance(value, str) or not SERIAL_PATTERN.fullmatch(value):
        raise DjiProtocolValueError("invalid DJI serial number")
    return value


def validate_payload_index(value: str) -> str:
    if not isinstance(value, str) or not PAYLOAD_INDEX_PATTERN.fullmatch(value):
        raise DjiProtocolValueError("invalid DJI payload_index")
    return value


def validate_video_quality(value: int) -> int:
    if isinstance(value, bool) or value not in VIDEO_QUALITIES:
        raise DjiProtocolValueError("invalid DJI video_quality")
    return value


def build_video_id(
    drone_sn: str,
    payload_index: str,
    *,
    video_type: str = "normal",
    video_index: int = 0,
) -> str:
    validate_serial(drone_sn)
    validate_payload_index(payload_index)
    if video_type not in VIDEO_TYPES:
        raise DjiProtocolValueError("invalid DJI video type")
    if isinstance(video_index, bool) or not isinstance(video_index, int) or video_index < 0:
        raise DjiProtocolValueError("invalid DJI video index")
    return f"{drone_sn}/{payload_index}/{video_type}-{video_index}"


def classify_topic(topic: str) -> tuple[str, str] | None:
    if not isinstance(topic, str):
        return None
    for kind, pattern in _TOPIC_PATTERNS:
        match = pattern.fullmatch(topic)
        if match:
            return kind, match.group("sn")
    return None


def _thing_topic(sn: str, suffix: str) -> str:
    return f"thing/product/{validate_serial(sn)}/{suffix}"


def service_topic(sn: str) -> str:
    return _thing_topic(sn, "services")


def events_reply_topic(sn: str) -> str:
    return _thing_topic(sn, "events_reply")


def requests_reply_topic(sn: str) -> str:
    return _thing_topic(sn, "requests_reply")


def status_reply_topic(sn: str) -> str:
    return f"sys/product/{validate_serial(sn)}/status_reply"


def ensure_allowed_service_method(method: str) -> str:
    if method not in SKYHUB_ALLOWED_SERVICE_METHODS:
        raise DjiProtocolValueError(f"DJI service method not enabled in SkyHub: {method}")
    return method
