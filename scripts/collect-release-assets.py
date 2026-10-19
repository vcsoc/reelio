#!/usr/bin/env python3
"""Collect only version-matching installer assets and produce updater SHA256SUMS."""
import hashlib
import json
from pathlib import Path
import re
import sys

source, destination = map(Path, sys.argv[1:3])
version = json.loads((Path(__file__).resolve().parent.parent / "apps/desktop/package.json").read_text())["version"]
pattern = re.compile(r"(?:reelio-" + re.escape(version) + r"-[1-9][0-9]*-x86_64\.pkg\.tar\.zst|Reelio_" + re.escape(version) + r"_(?:amd64\.deb|(?:x64|aarch64)\.dmg|x64-setup\.exe))")
destination.mkdir(parents=True, exist_ok=True)
checksums = []
for path in sorted(source.rglob("*")):
    if not path.is_file() or not pattern.fullmatch(path.name):
        continue
    digest = hashlib.sha256()
    with path.open("rb") as reader, (destination / path.name).open("xb") as writer:
        while data := reader.read(1024 * 1024):
            digest.update(data)
            writer.write(data)
    checksums.append(f"{digest.hexdigest()}  {path.name}\n")
if not checksums:
    raise SystemExit("No version-matching release packages found")
with (destination / "SHA256SUMS").open("x") as writer:
    writer.writelines(checksums)
print(f"Prepared {len(checksums)} packages and SHA256SUMS")
