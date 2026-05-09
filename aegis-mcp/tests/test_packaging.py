"""Packaging regressions for aegis-mcp."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

_PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _build_wheel(tmp_path: Path, *extra_flags: str) -> Path:
    wheel_dir = tmp_path / "dist"
    wheel_dir.mkdir()

    cmd = [
        sys.executable,
        "-m",
        "pip",
        "wheel",
        *extra_flags,
        "--no-deps",
        "--wheel-dir",
        str(wheel_dir),
        ".",
    ]
    result = subprocess.run(
        cmd,
        cwd=_PROJECT_ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, (
        f"wheel build failed: {cmd}\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )

    wheels = sorted(wheel_dir.glob("*.whl"))
    assert len(wheels) == 1
    return wheels[0]


def _assert_templates_shipped(wheel_path: Path) -> None:
    with ZipFile(wheel_path) as archive:
        names = set(archive.namelist())

    assert "aegis_mcp/templates/builtin/soap.md" in names
    assert "aegis_mcp/templates/builtin/discharge-summary.md" in names


def test_build_wheel_isolated_offline_includes_templates(
    tmp_path: Path,
) -> None:
    """Default ``pip wheel`` path (isolated build) with network disabled.

    This is the path that originally broke offline before the in-repo
    ``build_backend`` was added: in an isolated build pip creates a fresh
    venv and installs everything in ``build-system.requires`` before
    calling the backend. ``--no-index`` makes the test fail fast if
    anyone re-adds an external backend to ``pyproject.toml`` (e.g.
    ``hatchling``) — without it pip would happily fetch the backend from
    pypi and the test would stay green while the offline workflow had
    silently regressed. The ``--no-build-isolation`` variant below is
    even weaker because it reuses the dev venv.
    """
    wheel = _build_wheel(tmp_path, "--no-index")
    _assert_templates_shipped(wheel)


def test_build_wheel_without_build_isolation_includes_templates(
    tmp_path: Path,
) -> None:
    """Non-isolated build against the dev venv.

    Documents the fast in-venv build path that
    ``scripts/contract-test.sh`` and local iteration rely on.
    """
    wheel = _build_wheel(tmp_path, "--no-build-isolation")
    _assert_templates_shipped(wheel)
