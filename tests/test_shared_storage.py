"""Static and shell-syntax guards for the opt-in shared MinIO deployment.

These tests never access Docker or change the Raspberry Pi.
"""
from pathlib import Path
import json
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

    def test_external_adoption_overlay_cannot_start_another_minio(self):
        overlay = (ROOT / "docker-compose.storage.external.yml").read_text(encoding="utf-8")
        self.assertIn("name: skyhub-storage-net", overlay)
        self.assertIn("external: true", overlay)
        self.assertIn("SKYHUB_S3_ENDPOINT: http://skyhub-minio:9000", overlay)
        self.assertNotIn("  minio:", overlay)
        self.assertNotIn("ports:", overlay)

    def test_s3_policies_are_bucket_scoped_with_no_public_all_access(self):
        files = sorted((ROOT / "storage/policies").glob("*.json"))
        self.assertEqual(len(files), 4)
        for path in files:
            policy = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(policy["Version"], "2012-10-17")
            for statement in policy["Statement"]:
                self.assertEqual(statement["Effect"], "Allow")
                self.assertNotIn("*", statement["Action"])
                for resource in statement["Resource"]:
                    self.assertTrue(resource.startswith("arn:aws:s3:::skyhub-"))
                    self.assertNotEqual(resource, "arn:aws:s3:::*")
        wpml = json.loads((ROOT / "storage/policies/skyhub-wpml-reader.json").read_text())
        actions = [a for s in wpml["Statement"] for a in s["Action"]]
        self.assertNotIn("s3:PutObject", actions)
        self.assertNotIn("s3:DeleteObject", actions)

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
        for mode in ("plan", "apply", "adopt", "attach", "verify"):
            self.assertIn(mode, help_result.stdout)
        invalid = subprocess.run(["bash", str(SCRIPT), "invalid"], capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)

    def test_helper_avoids_destructive_docker_ops(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('up -d --no-deps minio', text)
        self.assertIn('docker network connect', text)
        self.assertIn("assert_alias_available", text)
        self.assertIn('existing MinIO is not running', text)
        self.assertIn('SkyHub-owned MinIO already exists', text)
        self.assertIn('"--allow-legacy-image"', text)
        for command in ("docker compose down", "docker volume rm", "docker system prune", "docker rm -f"):
            self.assertNotIn(command + "\n", text)
        self.assertNotIn('docker compose up -d --build', text)
        s3wrapper = (ROOT / "scripts/pi-minio-s3-check.sh").read_text(encoding="utf-8")
        self.assertIn("--read-only", s3wrapper)
        self.assertIn("--rm", s3wrapper)
        self.assertIn("--env-file", s3wrapper)
        self.assertNotIn("docker network connect", s3wrapper)
        syntax = subprocess.run(
            ["bash", "-n", str(ROOT / "scripts/pi-minio-s3-check.sh")],
            capture_output=True, text=True
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)


if __name__ == "__main__":
    unittest.main()
