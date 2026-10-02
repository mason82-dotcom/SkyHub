"""DJI update_topo parser with fail-closed product identity handling."""
from __future__ import annotations

import math
import time
from typing import Any


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _identity_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)) or float(value) % 1:
        return None
    return int(value)


def _domain(value: Any) -> str | int | None:
    if isinstance(value, bool):
        return None
    return value if isinstance(value, (str, int)) else None


def _product(record: dict[str, Any]) -> dict[str, Any] | None:
    type_ = _identity_int(record.get("type"))
    sub_type = _identity_int(record.get("sub_type"))
    if type_ is None or sub_type is None:
        return None

    product: dict[str, Any] = {"type": type_, "sub_type": sub_type}
    domain = _domain(record.get("domain"))
    if domain is not None:
        product["domain"] = domain

    version = record.get("thing_version")
    if not isinstance(version, str):
        version = record.get("version")
    if isinstance(version, str):
        product["thing_version"] = version
    return product


def parse_dji_topology_update(
    gateway_sn: str,
    payload: Any,
    received_at_ms: int | None = None,
) -> dict[str, Any] | None:
    """Parse one DJI update_topo message.

    Gateway identity must contain numeric type/sub_type. Invalid subdevices are
    skipped rather than persisted with guessed identities.
    """
    root = _record(payload)
    if root is None or root.get("method") != "update_topo":
        return None

    data = _record(root.get("data"))
    if data is None or not isinstance(data.get("sub_devices"), list):
        return None

    gateway_product = _product(data)
    if gateway_product is None:
        return None

    sub_devices: list[dict[str, Any]] = []
    for item in data["sub_devices"]:
        rec = _record(item)
        if rec is None:
            continue
        sn = rec.get("sn")
        product = _product(rec)
        if not isinstance(sn, str) or not sn or product is None:
            continue

        sub: dict[str, Any] = {"sn": sn, "product": product}
        if isinstance(rec.get("index"), str):
            sub["index"] = rec["index"]
        sub_devices.append(sub)

    return {
        "gateway_sn": gateway_sn,
        "product": gateway_product,
        "sub_devices": sub_devices,
        "updated_at_ms": received_at_ms if received_at_ms is not None else int(time.time() * 1000),
    }


def to_public_dji_topology_payload(topology: dict[str, Any]) -> dict[str, Any]:
    """Return only topology fields that are safe for diagnostics."""
    product = topology["product"]

    def public_product(value: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": value["type"],
            "sub_type": value["sub_type"],
        }
        if "domain" in value:
            out["domain"] = value["domain"]
        if value.get("thing_version"):
            out["thing_version"] = value["thing_version"]
        return out

    data = public_product(product)
    data["sub_devices"] = []
    for device in topology.get("sub_devices", []):
        item = {"sn": device["sn"], **public_product(device["product"])}
        if device.get("index"):
            item["index"] = device["index"]
        data["sub_devices"].append(item)
    return {"method": "update_topo", "data": data}
