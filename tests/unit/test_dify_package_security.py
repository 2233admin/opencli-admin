from __future__ import annotations

import io
import stat
import zipfile

import pytest

from backend.plugins import dify_package
from backend.plugins.dify_package import DifyPackageError, read_dify_plugin_payload


def _package(entries: list[tuple[str, bytes, int | None]]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content, mode in entries:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            if mode is not None:
                info.external_attr = mode << 16
            archive.writestr(info, content)
    return output.getvalue()


def _manifest() -> bytes:
    return b"""version: 1.0.0
type: plugin
author: example
name: safe
plugins:
  tools:
    - provider/tool.yaml
meta:
  version: 0.0.2
"""


def test_reads_manifest_from_difypkg_without_extracting() -> None:
    payload = read_dify_plugin_payload(
        _package(
            [
                ("manifest.yaml", _manifest(), None),
                ("provider/tool.yaml", b"identity:\n  name: safe\n", None),
                ("main.py", b"raise RuntimeError('must never run')\n", None),
            ]
        ),
        filename="safe.difypkg",
    )

    assert payload.source_kind == "difypkg"
    assert payload.manifest_bytes == _manifest()
    assert "main.py" not in payload.metadata_files
    assert set(payload.metadata_files) == {"manifest.yaml", "provider/tool.yaml"}


@pytest.mark.parametrize(
    "unsafe_path",
    ["../manifest.yaml", "/manifest.yaml", "C:/manifest.yaml", "a/../manifest.yaml"],
)
def test_rejects_zip_slip_and_absolute_paths(unsafe_path: str) -> None:
    with pytest.raises(DifyPackageError, match="unsafe path") as error:
        read_dify_plugin_payload(
            _package([(unsafe_path, _manifest(), None)]), filename="unsafe.difypkg"
        )
    assert error.value.code == "dify_plugin_archive_unsafe_path"


def test_rejects_symlinks() -> None:
    with pytest.raises(DifyPackageError) as error:
        read_dify_plugin_payload(
            _package([("manifest.yaml", b"target", stat.S_IFLNK | 0o777)]),
            filename="symlink.difypkg",
        )
    assert error.value.code == "dify_plugin_archive_symlink"


def test_rejects_duplicate_normalized_paths() -> None:
    with pytest.raises(DifyPackageError) as error:
        read_dify_plugin_payload(
            _package(
                [
                    ("manifest.yaml", _manifest(), None),
                    ("MANIFEST.YAML", _manifest(), None),
                ]
            ),
            filename="duplicate.difypkg",
        )
    assert error.value.code == "dify_plugin_archive_duplicate_path"


def test_rejects_suspicious_compression_ratio() -> None:
    with pytest.raises(DifyPackageError) as error:
        read_dify_plugin_payload(
            _package([("manifest.yaml", b"a" * 500_000, None)]),
            filename="ratio.difypkg",
        )
    assert error.value.code == "dify_plugin_archive_suspicious_ratio"


def test_rejects_entry_and_uncompressed_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_package, "MAX_ENTRIES", 1)
    with pytest.raises(DifyPackageError) as entries_error:
        read_dify_plugin_payload(
            _package([("manifest.yaml", _manifest(), None), ("provider/a.yaml", b"a: b", None)]),
            filename="entries.difypkg",
        )
    assert entries_error.value.code == "dify_plugin_archive_too_many_entries"

    monkeypatch.setattr(dify_package, "MAX_ENTRIES", 2_000)
    monkeypatch.setattr(dify_package, "MAX_UNCOMPRESSED_BYTES", 8)
    with pytest.raises(DifyPackageError) as size_error:
        read_dify_plugin_payload(
            _package([("manifest.yaml", _manifest(), None)]),
            filename="large.difypkg",
        )
    assert size_error.value.code == "dify_plugin_archive_uncompressed_too_large"


def test_rejects_compressed_upload_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_package, "MAX_COMPRESSED_BYTES", 4)
    with pytest.raises(DifyPackageError) as error:
        read_dify_plugin_payload(b"12345", filename="manifest.yaml")
    assert error.value.code == "dify_plugin_package_too_large"
