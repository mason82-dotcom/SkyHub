"""Offline safety guards for the optional AGPL HiveMind simulator lab."""
from __future__ import annotations

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "simulators" / "hivemind"


class HivemindReferenceLabTest(unittest.TestCase):
    def test_reference_is_pinned_and_not_vendored(self):
        prepare = (LAB / "prepare.sh").read_text()
        self.assertIn("be269a3458ff6b2602d9a4dae14df278946cf7c1", prepare)
        self.assertIn("https://github.com/cdmiltd/hivemind-simulator.git", prepare)
        self.assertIn("git -C \"$SOURCE\" rev-parse HEAD", prepare)
        self.assertFalse((LAB / ".upstream").exists(), "Do not commit third-party AGPL sources")
        ignore = (ROOT / ".gitignore").read_text()
        for name in (".upstream/", ".m2-cache/", "lab.env"):
            self.assertIn("simulators/hivemind/" + name, ignore)

    def test_overlay_no_host_broker_or_prod_mounts(self):
        overlay = (LAB / "compose.lab.yml").read_text()
        self.assertIn('internal: true', overlay)
        self.assertIn('MQTT_BROKER_URL: mqtt://hivemind-broker:1884', overlay)
        self.assertIn('127.0.0.1:19090:9090', overlay)
        self.assertIn('SKYHUB_TRACK_RECORDING_ENABLED: "false"', overlay)
        self.assertIn('SKYHUB_PILOT_ENABLED: "false"', overlay)
        self.assertNotRegex(overlay, r'(?m)^\s*-\s*["\x27]?(?:1883|1884|4000|4001):')
        self.assertNotIn("network_mode: host", overlay)
        self.assertNotIn("/var/run/docker.sock", overlay)
        self.assertNotIn("uas-network", overlay)

    def test_wrapper_guards_project_and_secrets(self):
        wrapper = (LAB / "lab.sh").read_text()
        self.assertIn('PROJECT="skyhub-hivemind-lab"', wrapper)
        self.assertIn("MQTT_BROKER_URL=mqtt://hivemind-broker:1884", wrapper)
        self.assertIn("SKYHUB_HTTP_PORT=14001", wrapper)
        self.assertIn("docker compose --project-name", wrapper)
        self.assertIn('if [[ -e "$ENV_FILE" ]]', wrapper)
        self.assertIn("openssl rand -hex 32", wrapper)
        self.assertNotIn("down -v", wrapper)

    def test_lab_broker_anonymous_only_inside_lab(self):
        conf = (LAB / "mosquitto.conf").read_text()
        self.assertIn("listener 1884 0.0.0.0", conf)
        self.assertIn("allow_anonymous true", conf)
        self.assertIn("persistence false", conf)
        self.assertIn('No broker port', (LAB / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
