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


class DjiStorageContractError(ValueError):
    pass


def validate_storage_config_request(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise DjiStorageContractError("storage_config_get data must be an object")
    module = data.get("module")
    if isinstance(module, bool) or module != 0:
        raise DjiStorageContractError("only media storage module 0 is supported")
    return data


def build_sts_response(
    credentials: dict[str, Any],
    *,
    bucket: str,
    endpoint: str,
    object_key_prefix: str,
    provider: str = "minio",
    region: str = "us-east-1",
) -> dict[str, Any]:
    required = ("AccessKeyId", "SecretAccessKey", "SessionToken")
    missing = [key for key in required if not isinstance(credentials.get(key), str) or not credentials[key]]
    if missing:
        raise DjiStorageContractError(f"STS credentials missing: {', '.join(missing)}")
    if provider not in ("ali", "aws", "minio"):
        raise DjiStorageContractError("unsupported storage provider")
    if not isinstance(endpoint, str) or not endpoint.startswith(("http://", "https://")):
        raise DjiStorageContractError("endpoint must use http or https")
    if not isinstance(bucket, str) or not bucket:
        raise DjiStorageContractError("bucket must be non-empty")
    if not isinstance(object_key_prefix, str) or not object_key_prefix:
        raise DjiStorageContractError("object_key_prefix must be non-empty")
    if not isinstance(region, str) or not region:
        raise DjiStorageContractError("region must be non-empty")

    return {
        "bucket": bucket,
        "credentials": {
            "access_key_id": credentials["AccessKeyId"],
            "access_key_secret": credentials["SecretAccessKey"],
            "security_token": credentials["SessionToken"],
            "expire": exposed_sts_ttl(credentials),
        },
        "endpoint": endpoint,
        "object_key_prefix": object_key_prefix,
        "provider": provider,
        "region": region,
    }
