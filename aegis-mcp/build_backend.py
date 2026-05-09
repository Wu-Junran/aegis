"""Minimal PEP 517 backend for offline local builds.

This project only needs pure-Python wheels plus package data under `src/`.
Using an in-repo backend keeps `pip wheel --no-build-isolation` working in an
offline venv without requiring a separately installed build backend package.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import re
import tomllib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
PYPROJECT = ROOT / "pyproject.toml"
SRC = ROOT / "src"
WHEEL_TAG = "py3-none-any"
GENERATOR = "aegis-local-build-backend"


def build_wheel(
    wheel_directory: str,
    config_settings: dict[str, object] | None = None,
    metadata_directory: str | None = None,
) -> str:
    project = _load_project()
    dist_name = _distribution_name(project["name"])
    version = project["version"]
    wheel_name = f"{dist_name}-{version}-{WHEEL_TAG}.whl"
    wheel_path = Path(wheel_directory) / wheel_name

    entries = list(_package_entries())
    entries.extend(_dist_info_entries(project, dist_name, version))

    record_path = f"{_dist_info_dir(dist_name, version)}/RECORD"
    entries.append((record_path, _record_contents(entries, record_path)))

    with ZipFile(wheel_path, "w", compression=ZIP_DEFLATED) as archive:
        for arcname, data in entries:
            archive.writestr(arcname, data)

    return wheel_name


def build_editable(
    wheel_directory: str,
    config_settings: dict[str, object] | None = None,
    metadata_directory: str | None = None,
) -> str:
    project = _load_project()
    dist_name = _distribution_name(project["name"])
    version = project["version"]
    wheel_name = f"{dist_name}-{version}-{WHEEL_TAG}.whl"
    wheel_path = Path(wheel_directory) / wheel_name

    entries = [
        (f"{dist_name}.pth", f"{SRC.resolve()}\n".encode("utf-8")),
        *_dist_info_entries(project, dist_name, version),
    ]

    record_path = f"{_dist_info_dir(dist_name, version)}/RECORD"
    entries.append((record_path, _record_contents(entries, record_path)))

    with ZipFile(wheel_path, "w", compression=ZIP_DEFLATED) as archive:
        for arcname, data in entries:
            archive.writestr(arcname, data)

    return wheel_name


def prepare_metadata_for_build_wheel(
    metadata_directory: str,
    config_settings: dict[str, object] | None = None,
) -> str:
    project = _load_project()
    dist_name = _distribution_name(project["name"])
    version = project["version"]
    dist_info = Path(metadata_directory) / _dist_info_dir(dist_name, version)
    dist_info.mkdir(parents=True, exist_ok=True)

    for arcname, data in _dist_info_entries(project, dist_name, version):
        (Path(metadata_directory) / arcname).write_bytes(data)

    return dist_info.name


def prepare_metadata_for_build_editable(
    metadata_directory: str,
    config_settings: dict[str, object] | None = None,
) -> str:
    return prepare_metadata_for_build_wheel(metadata_directory, config_settings)


def get_requires_for_build_wheel(
    config_settings: dict[str, object] | None = None,
) -> list[str]:
    return []


def get_requires_for_build_editable(
    config_settings: dict[str, object] | None = None,
) -> list[str]:
    return []


def _load_project() -> dict[str, object]:
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    return data["project"]


def _distribution_name(name: str) -> str:
    return re.sub(r"[-_.]+", "_", name)


def _dist_info_dir(dist_name: str, version: str) -> str:
    return f"{dist_name}-{version}.dist-info"


def _package_entries() -> list[tuple[str, bytes]]:
    entries: list[tuple[str, bytes]] = []
    for path in sorted(SRC.rglob("*")):
        if path.is_dir():
            continue
        if "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        entries.append((path.relative_to(SRC).as_posix(), path.read_bytes()))
    return entries


def _dist_info_entries(
    project: dict[str, object],
    dist_name: str,
    version: str,
) -> list[tuple[str, bytes]]:
    dist_info = _dist_info_dir(dist_name, version)
    entries = [
        (f"{dist_info}/METADATA", _metadata_contents(project)),
        (f"{dist_info}/WHEEL", _wheel_contents()),
    ]

    entry_points = _entry_points_contents(project)
    if entry_points is not None:
        entries.append((f"{dist_info}/entry_points.txt", entry_points))

    return entries


def _metadata_contents(project: dict[str, object]) -> bytes:
    lines = [
        "Metadata-Version: 2.1",
        f"Name: {project['name']}",
        f"Version: {project['version']}",
        f"Summary: {project['description']}",
    ]

    requires_python = project.get("requires-python")
    if requires_python:
        lines.append(f"Requires-Python: {requires_python}")

    for requirement in project.get("dependencies", []):
        lines.append(f"Requires-Dist: {requirement}")

    optional = project.get("optional-dependencies", {})
    for extra_name, requirements in optional.items():
        lines.append(f"Provides-Extra: {extra_name}")
        for requirement in requirements:
            lines.append(f"Requires-Dist: {requirement} ; extra == '{extra_name}'")

    lines.append("")
    return "\n".join(lines).encode("utf-8")


def _wheel_contents() -> bytes:
    return (
        "Wheel-Version: 1.0\n"
        f"Generator: {GENERATOR}\n"
        "Root-Is-Purelib: true\n"
        f"Tag: {WHEEL_TAG}\n"
    ).encode("utf-8")


def _entry_points_contents(project: dict[str, object]) -> bytes | None:
    scripts = project.get("scripts", {})
    if not scripts:
        return None

    lines = ["[console_scripts]"]
    for name, target in scripts.items():
        lines.append(f"{name} = {target}")
    lines.append("")
    return "\n".join(lines).encode("utf-8")


def _record_contents(
    entries: list[tuple[str, bytes]],
    record_path: str,
) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")

    for arcname, data in entries:
        digest = hashlib.sha256(data).digest()
        hash_value = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        writer.writerow((arcname, f"sha256={hash_value}", str(len(data))))

    writer.writerow((record_path, "", ""))
    return buffer.getvalue().encode("utf-8")
