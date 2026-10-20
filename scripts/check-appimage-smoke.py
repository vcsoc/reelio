#!/usr/bin/env python3
"""Require actual backend/playback readiness, not a successful GUI process alone."""
from pathlib import Path
import re
import sys

text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", Path(sys.argv[1]).read_text(errors="replace"))
reports = [line for line in text.splitlines() if "Runtime component check completed" in line]
if not any(all(re.search(r"\b" + field + r"\b", line) for field in ["preview_available=true", "backend_available=true", "missing_count=0"]) for line in reports):
    raise SystemExit("AppImage runtime is not ready: backend, playback and zero missing components are required")
print("AppImage backend and playback runtime verified")
