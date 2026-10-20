#!/usr/bin/env python3
"""Include third-party notices and source-package provenance in the AppImage."""
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
notices = root / "target/appimage-notices"
notices.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root / "LICENSE", notices / "Reelio-LICENSE")
for directory in [Path("/usr/share/doc"), Path("/usr/share/common-licenses"), Path("/usr/share/licenses")]:
    if not directory.is_dir():
        continue
    for path in directory.rglob("*"):
        if path.is_file() and (path.name == "copyright" or directory.name != "doc"):
            target = notices / directory.name / path.relative_to(directory)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
if shutil.which("dpkg-query"):
    result = subprocess.run(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n"], check=True, capture_output=True, text=True)
    (notices / "ubuntu-package-sources.tsv").write_text(result.stdout)
(notices / "README.txt").write_text("Reelio is MIT licensed. Bundled system/media libraries retain their own copyrights and licenses. The included notices and source-package/version list identify their Ubuntu packages. Corresponding source and packaging/build instructions are available from https://launchpad.net/ubuntu/+source/<source-package> and Ubuntu source repositories (apt-get source source-package=source-version). FFmpeg/FFprobe executables are external requirements, not bundled backends.\n")
config = {"bundle": {"linux": {"appimage": {"files": {"/usr/share/doc/reelio/third-party": str(notices)}}}}}
(root / "target/appimage-bundle.json").write_text(json.dumps(config))
print("Prepared AppImage third-party notices and source-package provenance")
