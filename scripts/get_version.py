#!/usr/bin/env python3
"""Generate version string matching setuptools_scm default format."""

import re
import subprocess
import sys
from datetime import datetime, timezone


def _bump_version(tag: str) -> str:
    """Bump the last numeric segment of a version tag."""
    # Strip leading 'v' or 'V'
    version = tag.lstrip("vV")
    parts = version.split(".")
    if parts and parts[-1].isdigit():
        parts[-1] = str(int(parts[-1]) + 1)
    else:
        parts.append("1")
    return ".".join(parts)


def _git_describe() -> str:
    result = subprocess.run(
        ["git", "describe", "--tags", "--long", "--always", "--abbrev=9"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return "unknown"
    return result.stdout.strip()


def _fallback_version() -> str:
    desc = _git_describe()
    if desc == "unknown":
        return "unknown"

    # Format: v0.1.3-12-g524c003
    match = re.match(r"^[vV]?(.*)-(\d+)-g([0-9a-f]+)$", desc)
    if not match:
        return desc.lstrip("vV")

    tag, distance, node = match.groups()
    next_version = _bump_version(tag)
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{next_version}.dev{distance}+g{node}.d{today}"


def get_version() -> str:
    try:
        from setuptools_scm import get_version as scm_get_version

        return scm_get_version()
    except Exception:
        return _fallback_version()


if __name__ == "__main__":
    print(get_version())
