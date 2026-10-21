#!/usr/bin/env python3
"""Tests use only temporary fixture data; never call Docker, mount or cryptsetup."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('manifest_helper', HERE/'manifest.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
legacy_spec = importlib.util.spec_from_file_location('legacy_guard', HERE/'legacy_guard.py')
legacy = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)


class AcceptancePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)/'source'
        self.root.mkdir()
        (self.root/'file').write_bytes(b'fixture contents')

    def tearDown(self):
        self.temp.cleanup()

    def rows(self):
        return {r['path']: r for r in helper.records(self.root)}

    def test_identical_copy_matches(self):
        copy = Path(self.temp.name)/'restore'
        shutil.copytree(self.root, copy, copy_function=shutil.copy2)
        self.assertEqual(self.rows(), {r['path']: r for r in helper.records(copy)})

    def test_content_tampering_detected(self):
        before = self.rows()
        (self.root/'file').write_bytes(b'fixture contentX')
        self.assertNotEqual(before, self.rows())

    def test_extra_file_detected(self):
        before = self.rows()
        (self.root/'extra').write_bytes(b'')
        self.assertNotEqual(before, self.rows())

    def test_owner_mode_metadata_captured(self):
        before = self.rows()
        (self.root/'file').chmod(0o600)
        self.assertNotEqual(before['file']['mode'], self.rows()['file']['mode'])

    def test_symlink_refused(self):
        (self.root/'link').symlink_to('file')
        with self.assertRaises(RuntimeError): list(helper.records(self.root))

    def test_missing_root_refused(self):
        with self.assertRaises(RuntimeError):
            list(helper.records(self.root/'absent'))

    def test_no_argument_write_guards(self):
        for script in ('backup.sh', 'restore.sh'):
            result = subprocess.run(['bash', str(HERE/script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('NOT EXECUTED', result.stdout)

    def test_all_shell_syntax(self):
        for script in ('preflight.sh', 'backup.sh', 'restore.sh'):
            self.assertEqual(subprocess.run(['bash', '-n', str(HERE/script)]).returncode, 0)

    def test_removed_legacy_containers_allowed(self):
        self.assertEqual(legacy.check_legacy([]), (2, 0))

    def test_stopped_legacy_containers_allowed(self):
        rows = [{'Name': name, 'State': {'Running': False}} for name in legacy.LEGACY]
        self.assertEqual(legacy.check_legacy(rows), (0, 2))

    def test_one_absent_one_stopped_allowed(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {'Running': False}}
        self.assertEqual(legacy.check_legacy([row]), (1, 1))

    def test_running_legacy_container_rejected(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {'Running': True}}
        with self.assertRaises(ValueError): legacy.check_legacy([row])

    def test_unknown_legacy_state_rejected(self):
        row = {'Name': sorted(legacy.LEGACY)[0], 'State': {}}
        with self.assertRaises(ValueError): legacy.check_legacy([row])

    def test_docker_inventory_failure_not_treated_as_absence(self):
        from unittest.mock import patch
        with patch.object(legacy.subprocess, 'check_output',
                          side_effect=subprocess.CalledProcessError(1, 'docker')):
            with self.assertRaises(subprocess.CalledProcessError): legacy.main()


if __name__ == '__main__':
    unittest.main()
