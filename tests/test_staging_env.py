"""Local staging secret preparation must never expose or overwrite DJI keys."""
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/pi-prepare-staging-env.py"


class StagingEnvTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.project = self.root / "project"
        scripts = self.project / "scripts"
        scripts.mkdir(parents=True)
        shutil.copyfile(SOURCE, scripts / SOURCE.name)
        self.script = scripts / SOURCE.name
        self.envfile = self.project / ".env"
        self.original = (
            "# Sample private file, not a real credential\n"
            "SKYHUB_VIEW_TOKEN=REPLACE_WITH_RANDOM_TOKEN\n"
            "SKYHUB_DB_PASSWORD=REPLACE_WITH_RANDOM_PASSWORD\n"
            "SKYHUB_DJI_APP_ID=KEEP_APP_ID\n"
            "SKYHUB_DJI_APP_KEY=KEEP_APP_KEY\n"
            "SKYHUB_DJI_APP_LICENSE=KEEP_LICENSE\n"
            "MQTT_USER=REPLACE_WITH_MQTT_ACCOUNT\n"
            "MQTT_PASSWORD=REPLACE_WITH_MQTT_PASSWORD\n"
            "SKYHUB_PILOT_ENABLED=false\n"
            "SKYHUB_HTTP_PORT=4001"
        )
        self.envfile.write_text(self.original)
        os.chmod(self.envfile, 0o600)

    def run_script(self, *args):
        env=os.environ.copy()
        env["HOME"] = str(self.home)
        return subprocess.run([sys.executable, str(self.script), *args],
                              text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=env)

    def test_dry_run_changes_nothing(self):
        result=self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.envfile.read_text(), self.original)
        self.assertNotIn("KEEP_LICENSE", result.stdout)
        self.assertFalse((self.home / "Projekte/_backups").exists())

    def test_apply_backs_up_and_generates_only_missing_non_dji_secrets(self):
        result=self.run_script("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        text=self.envfile.read_text()
        self.assertIn("SKYHUB_DJI_APP_ID=KEEP_APP_ID",text)
        self.assertIn("SKYHUB_DJI_APP_KEY=KEEP_APP_KEY",text)
        self.assertIn("SKYHUB_DJI_APP_LICENSE=KEEP_LICENSE",text)
        self.assertIn("MQTT_USER=REPLACE_WITH_MQTT_ACCOUNT",text)
        self.assertIn("SKYHUB_PILOT_ENABLED=false",text)
        self.assertIn("SKYHUB_HTTP_PORT=4001",text)
        for key in ("SKYHUB_VIEW_TOKEN","SKYHUB_DB_PASSWORD"):
            self.assertRegex(text,rf"{key}=[a-f0-9]{{64}}")
        self.assertEqual(stat.S_IMODE(self.envfile.stat().st_mode),0o600)
        self.assertNotIn("KEEP_LICENSE",result.stdout)
        backup=list((self.home / "Projekte/_backups").glob("skyhub-env-*/skyhub-next.env"))
        self.assertEqual(len(backup),1)
        self.assertEqual(backup[0].read_text(),self.original)
        self.assertEqual(stat.S_IMODE(backup[0].stat().st_mode),0o600)
        # Do not rekey live credentials or overwrite the first private backup.
        result2=self.run_script("--apply")
        self.assertEqual(result2.returncode,0,result2.stderr)
        self.assertEqual(self.envfile.read_text(),text)
        self.assertEqual(len(list((self.home / "Projekte/_backups").glob("skyhub-env-*/skyhub-next.env"))),1)

    def test_refuses_world_readable_env(self):
        os.chmod(self.envfile,0o644)
        result=self.run_script("--apply")
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.envfile.read_text(),self.original)

    def test_refuses_symlink_env(self):
        real=self.project/"real.env"
        self.envfile.rename(real)
        self.envfile.symlink_to(real)
        result=self.run_script("--apply")
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(real.read_text(),self.original)


if __name__ == "__main__":
    unittest.main()
