import pathlib
import unittest

from app.dji.protocol import DJI_CLOUD_API_VERSION


ROOT = pathlib.Path(__file__).resolve().parents[2]


class DjiCloudApiVersionTests(unittest.TestCase):
    def test_protocol_baseline_is_current_project_target(self):
        self.assertEqual(DJI_CLOUD_API_VERSION, "1.16.1")

    def test_project_rules_do_not_pin_old_v114_baseline(self):
        rules = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertIn("Cloud API v1.16.1", rules)
        self.assertNotIn("Cloud-API-Doku v1.14", rules)

    def test_readme_declares_same_target(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("DJI Cloud API v1.16.1", readme)


if __name__ == "__main__":
    unittest.main()
