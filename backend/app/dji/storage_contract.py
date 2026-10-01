"""DJI storage contract helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

STS_DURATION_SECONDS = 3600
STS_EXPIRY_SAFETY_MARGIN_SECONDS = 300


def exposed_sts_ttl(credentials: dict[str, Any], requested_seconds: int = STS_DURATION_SECONDS) -> int:
    """Expose a conservative TTL so Pilot stops using credentials before expiry."""
    actual_seconds = requested_seconds
    expiration = credentials.get("Expiration")
    if isinstance(expiration, datetime):
        now = datetime.now(timezone.utc)
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)
        actual_seconds = max(1, int((expiration - now).total_seconds()))
    return max(1, min(requested_seconds, actual_seconds) - STS_EXPIRY_SAFETY_MARGIN_SECONDS)
