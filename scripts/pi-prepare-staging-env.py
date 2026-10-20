#!/usr/bin/env python3
"""Prepare *only* local SkyHub Next staging secrets, preserving DJI credentials.

Default is read-only. --apply creates a mode-0600 backup and then replaces
only missing or REPLACE_* VIEW_TOKEN / DB_PASSWORD values in .env.
Never prints secret values; never starts/stops containers.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import tempfile

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
KEYS = ("SKYHUB_VIEW_TOKEN", "SKYHUB_DB_PASSWORD")
DJI = ("SKYHUB_DJI_APP_ID", "SKYHUB_DJI_APP_KEY", "SKYHUB_DJI_APP_LICENSE")
MQTT = ("MQTT_USER", "MQTT_PASSWORD")


def parse_lines(lines: list[str]) -> dict[str, str]:
    items: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if re.fullmatch(r"[A-Z_][A-Z0-9_]*", key.strip()):
            items[key.strip()] = value.strip().strip("'\"")
    return items


def configured(value: str | None) -> bool:
    return bool(value and not value.startswith("REPLACE_"))


def replace_or_append(lines: list[str], key: str, value: str) -> list[str]:
    pattern = re.compile(r"^\\s*" + re.escape(key) + r"\\s*=")
    matching = [i for i, line in enumerate(lines) if pattern.match(line)]
    if len(matching) > 1:
        raise ValueError(f"Ambiguous duplicate key: {key}")
    if matching:
        lines[matching[0]] = key + "=" + value + "\n"
    else:
        lines.append(key + "=" + value + "\n")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create backup, then generate missing/placeholder local secrets")
    args = parser.parse_args()
    if not ENV.exists() or ENV.is_symlink() or not ENV.is_file():
        raise SystemExit("ERROR: local .env file is missing or is a symlink; no changes made.")
    if stat.S_IMODE(ENV.stat().st_mode) & 0o077:
        raise SystemExit("ERROR: .env permissions are too open; set chmod 600 first.")
    lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True)
    values = parse_lines(lines)
    to_replace = [key for key in KEYS if not configured(values.get(key))]
    print("SkyHub Next staging environment (secret values not shown)")
    for key in KEYS + DJI + MQTT:
        print(f"  {key}: {'needs configuration' if not configured(values.get(key)) else 'present'}")
    for key in ("SKYHUB_PILOT_ENABLED", "SKYHUB_BIND_ADDRESS", "SKYHUB_HTTP_PORT"):
        print(f"  {key}: {'present' if key in values else 'default'}")
    if not to_replace:
        print("No local VIEW_TOKEN or DB_PASSWORD changes needed.")
        return 0
    if not args.apply:
        print("Dry-run only. Run again with --apply to generate the two local staging secrets.")
        return 0

    # Backups are intentionally outside the Git working tree.
    backup_root = Path.home() / "Projekte" / "_backups"
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup_dir = Path(tempfile.mkdtemp(prefix="skyhub-env-", dir=backup_root))
    os.chmod(backup_dir, 0o700)
    backup = backup_dir / "skyhub-next.env"
    shutil.copy2(ENV, backup)
    os.chmod(backup, 0o600)

    updated = list(lines)
    for key in to_replace:
        updated = replace_or_append(updated, key, secrets.token_hex(32))
    # Atomic file replace only after a durable, private backup was written.
    fd, temporary = tempfile.mkstemp(prefix=".env-next-", dir=ENV.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.writelines(updated)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, ENV)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Updated keys: " + ", ".join(to_replace))
    print(f"Private backup created at: {backup}")
    print("DJI credentials, MQTT credentials, existing non-placeholder values and services left unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
