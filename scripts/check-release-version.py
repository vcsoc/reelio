#!/usr/bin/env python3
"""Reject release tags/version files that cannot describe the same build."""
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
cargo = (root / "Cargo.toml").read_text()
match = re.search(r'(?m)^version = "([0-9]+\.[0-9]+\.[0-9]+)"$', cargo)
if not match:
    raise SystemExit("Cannot determine workspace version")
version = match.group(1)
for relative in ("apps/desktop/package.json", "apps/desktop/package-lock.json", "apps/desktop/src-tauri/tauri.conf.json"):
    data = json.loads((root / relative).read_text())
    if data["version"] != version:
        raise SystemExit(f"Version mismatch: {relative}")
    if "packages" in data and data["packages"][""]["version"] != version:
        raise SystemExit("Lockfile root version mismatch")
revision = re.search(r"(?m)^pkgrel=([1-9][0-9]*)$", (root / "packaging/arch/PKGBUILD.in").read_text())
if not revision:
    raise SystemExit("Invalid package revision")
if len(sys.argv) > 1 and sys.argv[1] not in (f"v{version}", f"v{version}-{revision.group(1)}"):
    raise SystemExit("Release tag differs from the application/package version")
print(f"Consistent release version: {version}-{revision.group(1)}")
