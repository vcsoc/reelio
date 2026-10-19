#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
reuse=false
case "${1:-}" in
    '') ;;
    --reuse-build) reuse=true ;;
    *) echo "Usage: $0 [--reuse-build]" >&2; exit 2 ;;
esac
if (( $# > 1 )); then
    echo "Usage: $0 [--reuse-build]" >&2
    exit 2
fi
if [[ $(uname -sm) != 'Linux x86_64' ]]; then
    echo 'This package targets x86_64 Arch-based Linux systems.' >&2
    exit 1
fi
for tool in makepkg python3 desktop-file-validate; do
    command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

if [[ $reuse == false ]]; then
    (cd "$repo/apps/desktop" && npm ci && npm run tauri build -- --no-bundle)
fi
binary="$repo/target/release/reelio-desktop"
[[ -x $binary ]] || { echo "Release executable is missing: $binary" >&2; exit 1; }
desktop-file-validate "$repo/packaging/arch/reelio.desktop"

mkdir -p "$repo/target/release/bundle/arch"
stage=$(mktemp -d "$repo/target/arch-package.XXXXXX")
install -m755 "$binary" "$stage/reelio-desktop"
install -m644 "$repo/packaging/arch/reelio.desktop" "$stage/reelio.desktop"
install -m644 "$repo/apps/desktop/src-tauri/icons/128x128.png" "$stage/reelio.png"
install -m644 "$repo/LICENSE" "$stage/LICENSE"
python3 - "$repo" "$stage" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

repo, stage = map(Path, sys.argv[1:])
version = json.loads((repo / 'apps/desktop/src-tauri/tauri.conf.json').read_text())['version']
if not re.fullmatch(r'[0-9][0-9A-Za-z.+_]*', version):
    raise SystemExit('Application version is not a valid Arch package version')
names = ['reelio-desktop', 'reelio.desktop', 'reelio.png', 'LICENSE']
checksums = ' '.join("'" + hashlib.sha256((stage / name).read_bytes()).hexdigest() + "'" for name in names)
template = (repo / 'packaging/arch/PKGBUILD.in').read_text()
(stage / 'PKGBUILD').write_text(template.replace('@VERSION@', version).replace('@CHECKSUMS@', checksums))
PY

# No dependency installation or privileged commands; makepkg checks the host dependencies.
(cd "$stage" && PKGDEST="$repo/target/release/bundle/arch" makepkg --force --clean)
printf '\nArch package output: %s\n' "$repo/target/release/bundle/arch"
