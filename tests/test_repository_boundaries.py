"""Guard the boundary between the active SkyHub Next app and archived stacks.

Static-only checks. They never start Compose, connect to MQTT or alter the Pi.
"""
from __future__ import annotations

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ROOT / "stacks" / "legacy-skyhub"
ACL_SNAPSHOT = LEGACY / "running-emqx" / "acl.conf"
HARDENER = ROOT / "scripts" / "pi-emqx-harden.js"
CI = ROOT / ".github" / "workflows" / "ci.yml"

# The only two approved source-level references into the historical snapshot:
# * EMQX rollback reads the archived ACL from the observed old container.
# * CI syntax-checks one archived migration script but must not execute it.
ALLOWED_ARCHIVE_REFERENCES = {
    "scripts/pi-emqx-harden.js": {"stacks/legacy-skyhub/running-emqx/acl.conf"},
    ".github/workflows/ci.yml": {"stacks/legacy-skyhub/scripts/migrate-env.sh"},
}

ARCHIVE_PATH = re.compile(r"stacks/legacy-skyhub/[A-Za-z0-9_./-]+")
SOURCE_EXTENSIONS = {".js", ".jsx", ".mjs", ".py", ".sh", ".html", ".css", ".json", ".yml", ".yaml"}


def active_files() -> list[Path]:
    paths = []
    for folder in ("backend", "frontend", "scripts", "tests", ".github/workflows"):
        for path in (ROOT / folder).rglob("*"):
            if path.is_file() and path.suffix in SOURCE_EXTENSIONS:
                paths.append(path)
    return paths + [ROOT / "docker-compose.yml", ROOT / "backend/Dockerfile"]


class RepositoryBoundariesTest(unittest.TestCase):
    def test_archived_stack_has_no_undocumented_source_consumers(self) -> None:
        seen = {}
        for path in active_files():
            relative = path.relative_to(ROOT).as_posix()
            refs = set(ARCHIVE_PATH.findall(path.read_text(encoding="utf-8")))
            if refs:
                seen[relative] = refs
                self.assertEqual(
                    ALLOWED_ARCHIVE_REFERENCES.get(relative),
                    refs,
                    f"Unexpected active-to-legacy dependency in {relative}: {sorted(refs)}",
                )
        self.assertEqual(ALLOWED_ARCHIVE_REFERENCES, seen)

    def test_historical_acl_is_retained_for_existing_rollback(self) -> None:
        self.assertTrue(ACL_SNAPSHOT.is_file())
        acl = ACL_SNAPSHOT.read_text(encoding="utf-8")
        # Historical ACL is deliberately insecure; never deploy as a default.
        self.assertIn("{allow, all}.", acl)
        self.assertIn(
            "stacks/legacy-skyhub/running-emqx/acl.conf",
            HARDENER.read_text(encoding="utf-8"),
        )

    def test_frontend_has_single_static_entrypoint(self) -> None:
        self.assertTrue((ROOT / "frontend/public/index.html").is_file())
        self.assertTrue((ROOT / "frontend/public/pilot-login.html").is_file())
        self.assertFalse((ROOT / "frontend/src/App.jsx").exists())
        dockerfile = (ROOT / "backend/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY frontend/public /app/frontend/public", dockerfile)
        self.assertNotIn("frontend/src", dockerfile)

    def test_active_compose_is_not_legacy(self) -> None:
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertRegex(compose, r"(?m)^name:\s*skyhub-next\s*$")
        self.assertNotRegex(compose, r"(?m)^\s*emqx:\s*$")
        self.assertIn("SKYHUB_HTTP_PORT:-4001", compose)
        self.assertIn("SKYHUB_MQTT_REQUIRED_PORT", compose)

    def test_ci_does_not_start_archived_stack_or_operational_scripts(self) -> None:
        workflow = CI.read_text(encoding="utf-8")
        self.assertIn("sh -n stacks/legacy-skyhub/scripts/migrate-env.sh", workflow)
        self.assertNotIn("docker compose up", workflow)
        self.assertNotIn("pi-emqx-harden.js apply", workflow)
        self.assertNotIn("pi-caddy-lan-dashboard.sh apply", workflow)


if __name__ == "__main__":
    unittest.main()
