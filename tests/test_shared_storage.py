"""Static and shell-syntax guards for the opt-in shared MinIO deployment.

These tests never access Docker or change the Raspberry Pi.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "docker-compose.storage.yml"
ROOT_COMPOSE = ROOT / "docker-compose.yml"
SCRIPT = ROOT / "scripts/pi-minio-network.sh"


class SharedMinioStorageTest(unittest.TestCase):
    def test_overlay_uses_external_network_without_host_ports(self):
        overlay = OVERLAY.read_text(encoding="utf-8")
        self.assertIn("name: skyhub-storage-net", overlay)
        self.assertIn("external: true", overlay)
        self.assertIn("- skyhub-minio", overlay)
        self.assertIn("SKYHUB_S3_ENDPOINT: http://skyhub-minio:9000", overlay)
        self.assertNotIn("ports:", overlay)
        self.assertNotIn("MINIO_ROOT_PASSWORD", overlay)
        self.assertIn("shared_storage:", overlay)

    def test_existing_profile_and_persistent_volume_are_preserved(self):
        compose = ROOT_COMPOSE.read_text(encoding="utf-8")
        self.assertIn('profiles: ["media"]', compose)
        self.assertIn("- minio_data:/data", compose)
        self.assertIn("SKYHUB_MINIO_IMAGE:-minio/minio:RELEASE.2023-09-04T19-57-37Z", compose)

    def test_helper_parses_and_defaults_to_readonly(self):
        syntax = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        help_result = subprocess.run(["bash", str(SCRIPT), "--help"], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        for mode in ("plan", "apply", "attach", "verify"):
            self.assertIn(mode, help_result.stdout)
        invalid = subprocess.run(["bash", str(SCRIPT), "invalid"], capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)

    def test_helper_avoids_destructive_docker_ops(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('up -d --no-deps minio', text)
        self.assertIn('docker network connect', text)
        self.assertIn('"--allow-legacy-image"', text)
        for command in ("docker compose down", "docker volume rm", "docker system prune", "docker rm -f"):
            self.assertNotIn(command + "\n", text)
        self.assertNotIn('docker compose up -d --build', text)


if __name__ == "__main__":
    unittest.main()
