"""DJI Cloud API configuration request contract."""
from __future__ import annotations

from typing import Any


class DjiConfigContractError(ValueError):
    pass


def validate_config_request(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise DjiConfigContractError("config data must be an object")
    if data.get("config_type") != "json":
        raise DjiConfigContractError("config_type must be json")
    if data.get("config_scope") != "product":
        raise DjiConfigContractError("config_scope must be product")
    return data


def build_product_config(
    *,
    ntp_server_host: str,
    app_id: str,
    app_key: str,
    app_license: str,
    ntp_server_port: int = 123,
) -> dict[str, Any]:
    if not isinstance(ntp_server_host, str) or not ntp_server_host:
        raise DjiConfigContractError("ntp_server_host must be non-empty")
    if isinstance(ntp_server_port, bool) or not isinstance(ntp_server_port, int):
        raise DjiConfigContractError("ntp_server_port must be an integer")
    if not 1 <= ntp_server_port <= 65535:
        raise DjiConfigContractError("ntp_server_port out of range")
    for field, value in (
        ("app_id", app_id),
        ("app_key", app_key),
        ("app_license", app_license),
    ):
        if not isinstance(value, str):
            raise DjiConfigContractError(f"{field} must be a string")
    return {
        "ntp_server_host": ntp_server_host,
        "ntp_server_port": ntp_server_port,
        "app_id": app_id,
        "app_key": app_key,
        "app_license": app_license,
    }
