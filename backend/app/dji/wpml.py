"""Safe DJI WPML/KMZ reader ported from FH-Clone validation contracts."""
from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree as ET

MAX_KMZ_INPUT_BYTES = 64 * 1024 * 1024
MAX_KMZ_ENTRIES = 1_000
MAX_KMZ_ENTRY_BYTES = 16 * 1024 * 1024
MAX_KMZ_TOTAL_BYTES = 64 * 1024 * 1024

_TEMPLATE_TYPES = {
    "waypoint": 0,
    "mapping2d": 1,
    "mapping3d": 2,
    "mappingStrip": 4,
}


class WpmlError(ValueError):
    pass


def _zip64_extra(extra: bytes) -> bool:
    pos = 0
    while pos + 4 <= len(extra):
        header_id = int.from_bytes(extra[pos:pos + 2], "little")
        size = int.from_bytes(extra[pos + 2:pos + 4], "little")
        if header_id == 0x0001:
            return True
        pos += 4 + size
    return False


def _normalize_path(path: str) -> str:
    if "\\" in path:
        raise WpmlError("WPML KMZ entry uses backslash path separators")
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        raise WpmlError("WPML KMZ contains an absolute entry path")
    parts = path.split("/")
    if ".." in parts:
        raise WpmlError("WPML KMZ contains a parent-directory entry")
    return "/".join(part for part in parts if part not in ("", "."))


def _read_limited(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    out = bytearray()
    with zf.open(info, "r") as src:
        while True:
            chunk = src.read(min(1024 * 1024, limit + 1 - len(out)))
            if not chunk:
                break
            out.extend(chunk)
            if len(out) > limit:
                raise WpmlError(f"WPML KMZ entry exceeds size limit: {info.filename}")
    return bytes(out)


def _parse_xml(raw: bytes, label: str) -> ET.Element:
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise WpmlError(f"{label} contains unsupported DTD/entity declarations")
    try:
        return ET.fromstring(raw.decode("utf-8"))
    except (UnicodeDecodeError, ET.ParseError) as exc:
        raise WpmlError(f"Invalid XML in {label}: {exc}") from exc


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(root: ET.Element, name: str) -> list[ET.Element]:
    return [node for node in root.iter() if _local(node.tag) == name]


def _first(root: ET.Element, name: str) -> ET.Element | None:
    return next((node for node in root.iter() if _local(node.tag) == name), None)


def _text(root: ET.Element, name: str) -> str | None:
    node = _first(root, name)
    if node is None or node.text is None:
        return None
    value = node.text.strip()
    return value or None


def _int_text(root: ET.Element, name: str, *, required: bool = False) -> int | None:
    value = _text(root, name)
    if value is None:
        if required:
            raise WpmlError(f"Missing wpml:{name}")
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise WpmlError(f"Invalid integer wpml:{name}") from exc


def _mission_identity(root: ET.Element) -> tuple[tuple[int, int], tuple[int, int] | None]:
    mission = _first(root, "missionConfig")
    if mission is None:
        raise WpmlError("WPML document requires wpml:missionConfig")

    drone = _first(mission, "droneInfo")
    if drone is None:
        raise WpmlError("WPML missionConfig requires wpml:droneInfo")
    drone_enum = _int_text(drone, "droneEnumValue", required=True)
    drone_sub = _int_text(drone, "droneSubEnumValue") or 0

    payload = _first(mission, "payloadInfo")
    payload_identity = None
    if payload is not None:
        payload_enum = _int_text(payload, "payloadEnumValue", required=True)
        payload_pos = _int_text(payload, "payloadPositionIndex") or 0
        payload_identity = (payload_enum, payload_pos)

    return (drone_enum, drone_sub), payload_identity


def _folder_nodes(root: ET.Element) -> list[ET.Element]:
    return _children(root, "Folder")


def _parse_metadata(template_root: ET.Element, waylines_root: ET.Element) -> dict:
    template_drone, template_payload = _mission_identity(template_root)
    wayline_drone, wayline_payload = _mission_identity(waylines_root)

    if template_drone != wayline_drone:
        raise WpmlError("template.kml and waylines.wpml use different droneInfo")
    if template_payload != wayline_payload:
        raise WpmlError("template.kml and waylines.wpml use different payloadInfo")

    template_types: list[int] = []
    template_type_names: list[str] = []
    template_ids: set[int] = set()
    for folder in _folder_nodes(template_root):
        template_type = _text(folder, "templateType")
        if not template_type:
            raise WpmlError("template.kml Folder requires wpml:templateType")
        template_type_names.append(template_type)
        template_types.append(_TEMPLATE_TYPES.get(template_type, 0))
        template_id = _int_text(folder, "templateId")
        if template_id is not None:
            if not 0 <= template_id <= 65535:
                raise WpmlError("wpml:templateId must be in [0,65535]")
            if template_id in template_ids:
                raise WpmlError("wpml:templateId must be unique in template.kml")
            template_ids.add(template_id)

    if not template_type_names:
        raise WpmlError("template.kml requires at least one Folder")

    wayline_ids: set[int] = set()
    execute_height_modes: list[str] = []
    wayline_folders = _folder_nodes(waylines_root)
    if not wayline_folders:
        raise WpmlError("waylines.wpml requires at least one Folder")
    for folder in wayline_folders:
        execute_mode = _text(folder, "executeHeightMode")
        if not execute_mode:
            raise WpmlError("waylines.wpml Folder requires wpml:executeHeightMode")
        execute_height_modes.append(execute_mode)

        wayline_id = _int_text(folder, "waylineId", required=True)
        if not 0 <= wayline_id <= 65535:
            raise WpmlError("wpml:waylineId must be in [0,65535]")
        if wayline_id in wayline_ids:
            raise WpmlError("wpml:waylineId must be unique in waylines.wpml")
        wayline_ids.add(wayline_id)

        template_id = _int_text(folder, "templateId")
        if template_id is not None and template_ids and template_id not in template_ids:
            raise WpmlError(f"waylines.wpml references missing templateId {template_id}")

    drone_enum, drone_sub = template_drone
    payload_keys = []
    if template_payload is not None:
        payload_enum, payload_pos = template_payload
        payload_keys.append(f"1-{payload_enum}-{payload_pos}")

    return {
        "drone_model_key": f"0-{drone_enum}-{drone_sub}",
        "payload_model_keys": payload_keys,
        "template_types": template_types,
        "template_type_names": template_type_names,
        "wayline_ids": sorted(wayline_ids),
        "execute_height_modes": execute_height_modes,
    }


def read_wpml_kmz(
    data: bytes,
    *,
    max_entries: int = MAX_KMZ_ENTRIES,
    max_entry_bytes: int = MAX_KMZ_ENTRY_BYTES,
    max_total_bytes: int = MAX_KMZ_TOTAL_BYTES,
) -> dict:
    if len(data) > MAX_KMZ_INPUT_BYTES:
        raise WpmlError("WPML KMZ input exceeds size limit")

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise WpmlError("Invalid WPML KMZ archive") from exc

    with zf:
        infos = zf.infolist()
        if len(infos) > max_entries:
            raise WpmlError("WPML KMZ contains too many entries")

        normalized: set[str] = set()
        extracted: dict[str, bytes] = {}
        entries: list[dict] = []
        total_uncompressed = 0

        for info in infos:
            raw_path = info.filename
            is_directory = info.is_dir() or raw_path.endswith("/")
            path = _normalize_path(raw_path)
            if not path or is_directory:
                continue
            if path in normalized:
                raise WpmlError(f"Duplicate WPML KMZ entry path: {path}")
            normalized.add(path)

            if info.flag_bits & 0x1:
                raise WpmlError(f"Encrypted WPML KMZ entry is not supported: {path}")
            if _zip64_extra(info.extra):
                raise WpmlError(f"ZIP64 WPML KMZ entry is not supported: {path}")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise WpmlError(f"Unsupported WPML KMZ compression method: {path}")
            if info.file_size > max_entry_bytes:
                raise WpmlError(f"WPML KMZ entry exceeds size limit: {path}")

            total_uncompressed += info.file_size
            if total_uncompressed > max_total_bytes:
                raise WpmlError("WPML KMZ exceeds total size limit")

            content = _read_limited(zf, info, max_entry_bytes)
            total_uncompressed += len(content) - info.file_size
            if total_uncompressed > max_total_bytes:
                raise WpmlError("WPML KMZ exceeds total size limit")
            extracted[path] = content
            entries.append({
                "path": path,
                "compressed_size": info.compress_size,
                "uncompressed_size": len(content),
                "compression_method": info.compress_type,
            })

        template = extracted.get("wpmz/template.kml")
        waylines = extracted.get("wpmz/waylines.wpml")
        if template is None:
            raise WpmlError("WPML KMZ requires wpmz/template.kml")
        if waylines is None:
            raise WpmlError("WPML KMZ requires wpmz/waylines.wpml")

        template_root = _parse_xml(template, "wpmz/template.kml")
        waylines_root = _parse_xml(waylines, "wpmz/waylines.wpml")
        metadata = _parse_metadata(template_root, waylines_root)
        resources = sorted(path for path in extracted if path.startswith("wpmz/res/"))

        return {
            "entries": entries,
            "resources": resources,
            "metadata": metadata,
        }
