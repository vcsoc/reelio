#!/usr/bin/env python3
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class ReleaseTests(unittest.TestCase):
    def test_smoke_check_rejects_ansi_color_zero_and_missing_playback(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "startup.log"
            command = [sys.executable, ROOT / "scripts/check-appimage-smoke.py", log]
            log.write_text("Runtime component check completed preview_available=false backend_available=true missing_count=\\x1b[0m11".replace("\\x1b", "\x1b"))
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            log.write_text("Runtime component check completed preview_available=true backend_available=true missing_count=0")
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_consistent_versions(self):
        result = subprocess.run([sys.executable, ROOT / "scripts/check-release-version.py"], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_wrong_tag_is_rejected(self):
        result = subprocess.run([sys.executable, ROOT / "scripts/check-release-version.py", "v999.0.0"], capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_appimage_is_collected_and_wrong_version_is_ignored(self):
        import json
        version = json.loads((ROOT / "apps/desktop/package.json").read_text())["version"]
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source, destination = base / "source", base / "release"
            source.mkdir()
            filename = f"Reelio_{version}_amd64.AppImage"
            (source / filename).write_bytes(b"appimage")
            (source / "Reelio_999.0.0_amd64.AppImage").write_bytes(b"ignore")
            result = subprocess.run([sys.executable, ROOT / "scripts/collect-release-assets.py", source, destination], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((destination / filename).read_bytes(), b"appimage")
            self.assertEqual(len(list(destination.iterdir())), 2)

    def test_package_manifest_and_no_clobber(self):
        import json
        version = json.loads((ROOT / "apps/desktop/package.json").read_text())["version"]
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source, destination = base / "source", base / "release"
            source.mkdir()
            filename = f"reelio-{version}-1-x86_64.pkg.tar.zst"
            (source / filename).write_bytes(b"package")
            (source / "wrong-version.deb").write_bytes(b"ignore")
            command = [sys.executable, ROOT / "scripts/collect-release-assets.py", source, destination]
            result = subprocess.run(command, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((destination / "SHA256SUMS").read_text(), f"{hashlib.sha256(b'package').hexdigest()}  {filename}\n")
            self.assertEqual(len(list(destination.iterdir())), 2)
            result = subprocess.run(command, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((destination / filename).read_bytes(), b"package")


if __name__ == "__main__":
    unittest.main()
