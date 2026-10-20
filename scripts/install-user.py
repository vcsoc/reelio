#!/usr/bin/env python3
"""Install a verified Reelio executable for this user, without elevation."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

MARKER = "# Managed by Reelio user installer"


def sha256(path: Path) -> str:
    with path.open("rb") as reader:
        digest = hashlib.sha256()
        while chunk := reader.read(1024 * 1024):
            digest.update(chunk)
        return digest.hexdigest()


def install(binary: Path, home: Path, repo: Path) -> Path:
    binary = binary.resolve(strict=True)
    with binary.open("rb") as reader:
        magic = reader.read(4)
    if not binary.is_file() or magic != b"\x7fELF":
        raise ValueError("Use a verified Linux Reelio executable or AppImage")
    version = json.loads((repo / "apps/desktop/package.json").read_text())["version"]
    revision = re.search(r"^pkgrel=([1-9][0-9]*)$", (repo / "packaging/arch/PKGBUILD.in").read_text(), re.M).group(1)
    label = f"{version}-{revision}"
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+-[1-9][0-9]*", label):
        raise ValueError("Invalid source package version")
    if any(char in str(home) for char in "\n\r\t"):
        raise ValueError("Home path cannot contain desktop-entry control characters")
    root = home / ".local/opt/reelio"
    launcher = home / ".local/bin/reelio"
    desktop = home / ".local/share/applications/reelio.desktop"
    current = root / "current"
    if launcher.exists() or launcher.is_symlink():
        if not launcher.is_symlink() or os.readlink(launcher) != str(current / "reelio"):
            raise ValueError(f"Refusing to replace an unrelated launcher: {launcher}")
    if desktop.exists() and MARKER not in desktop.read_text():
        raise ValueError(f"Refusing to replace an unrelated desktop entry: {desktop}")
    if current.exists() and not current.is_symlink():
        raise ValueError("Refusing to replace an unrelated current directory")
    if current.is_symlink() and (current.resolve().parent != root or not (current / "receipt.json").is_file()):
        raise ValueError("Refusing to replace an unrelated current installation")
    root.mkdir(parents=True, exist_ok=True)
    # Stage immutable executables; never overwrite an executable used by a running app.
    with tempfile.TemporaryDirectory(prefix=".install-", dir=root) as staging:
        stage = Path(staging)
        shutil.copyfile(binary, stage / "reelio")
        digest = sha256(stage / "reelio")
        with (stage / "reelio").open("rb") as reader:
            os.fsync(reader.fileno())
        os.chmod(stage / "reelio", 0o755)
        shutil.copyfile(repo / "apps/desktop/src-tauri/icons/128x128.png", stage / "reelio.png")
        (stage / "receipt.json").write_text(json.dumps({"source_package": label, "sha256": digest, "scope": "user"}) + "\n")
        slot = root / f"{label}-{digest[:16]}"
        if slot.exists():
            if sha256(slot / "reelio") != digest:
                raise ValueError("Existing version slot failed integrity verification")
        else:
            os.rename(stage, slot)
        for link, target in [(current, slot), (launcher, current / "reelio")]:
            link.parent.mkdir(parents=True, exist_ok=True)
            temporary = stage / "link" if stage.exists() else root / (".link-" + os.urandom(12).hex())
            temporary.symlink_to(target)
            os.replace(temporary, link)
    desktop.parent.mkdir(parents=True, exist_ok=True)
    executable = str(launcher).replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$").replace("%", "%%")
    content = f'{MARKER}\n[Desktop Entry]\nType=Application\nName=Reelio\nComment=Local-first media container editor\nExec="{executable}" %F\nIcon={current}/reelio.png\nTerminal=false\nCategories=AudioVideo;Video;\nStartupWMClass=reelio\nMimeType=application/x-reelio;\n'
    with tempfile.NamedTemporaryFile(mode="w", dir=desktop.parent, delete=False) as writer:
        writer.write(content)
        temp = Path(writer.name)
    os.chmod(temp, 0o644)
    os.replace(temp, desktop)
    return launcher


if __name__ == "__main__":
    if os.geteuid() == 0:
        raise SystemExit("Run as your normal user; this installer never needs sudo or Polkit")
    repo = Path(__file__).resolve().parent.parent
    binary = Path(sys.argv[1]) if len(sys.argv) == 2 else repo / "target/release/reelio-desktop"
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python3 scripts/install-user.py [verified-executable-or-AppImage]")
    try:
        launcher = install(binary, Path.home(), repo)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
    print(f"Installed for this user: {launcher}\nExisting work is not closed. Reopen Reelio when safe; future app updates need no password.")
