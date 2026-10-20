#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install-user.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class UserInstallTests(unittest.TestCase):
    def test_atomic_updates_retain_previous_binary_and_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "user home"
            binary = base / "binary"
            binary.write_bytes(b"\x7fELFfirst")
            launcher = installer.install(binary, home, ROOT)
            first = launcher.resolve()
            self.assertEqual(first.read_bytes(), b"\x7fELFfirst")
            self.assertEqual(json.loads((first.parent / "receipt.json").read_text())["scope"], "user")
            installer.install(binary, home, ROOT)
            self.assertEqual(launcher.resolve(), first)
            binary.write_bytes(b"\x7fELFsecond")
            installer.install(binary, home, ROOT)
            self.assertNotEqual(launcher.resolve(), first)
            self.assertEqual(first.read_bytes(), b"\x7fELFfirst")
            self.assertEqual(launcher.read_bytes(), b"\x7fELFsecond")
            self.assertIn(installer.MARKER, (home / ".local/share/applications/reelio.desktop").read_text())

    def test_unrelated_launcher_and_desktop_are_preserved(self):
        for target in [".local/bin/reelio", ".local/share/applications/reelio.desktop"]:
            with tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                binary = home / "binary"
                binary.write_bytes(b"\x7fELFtest")
                existing = home / target
                existing.parent.mkdir(parents=True)
                existing.write_text("user custom content")
                with self.assertRaises(ValueError):
                    installer.install(binary, home, ROOT)
                self.assertEqual(existing.read_text(), "user custom content")

    def test_non_executable_payload_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            binary = home / "binary"
            binary.write_text("not a Linux application")
            with self.assertRaises(ValueError):
                installer.install(binary, home, ROOT)
            self.assertFalse((home / ".local").exists())


if __name__ == "__main__":
    unittest.main()
