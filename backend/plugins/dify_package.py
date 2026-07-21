"""Read Dify plugin packages as untrusted metadata-only archives."""

from __future__ import annotations

import hashlib
import io
import stat
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath

MAX_COMPRESSED_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 2_000
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_METADATA_FILE_BYTES = 2 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


class DifyPackageError(ValueError):
    """Stable validation failure raised before manifest interpretation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class DifyPackagePayload:
    source_kind: str
    source_digest: str
    manifest_bytes: bytes
    metadata_files: dict[str, bytes]
    signature_state: str


def read_dify_plugin_payload(content: bytes, *, filename: str) -> DifyPackagePayload:
    """Return manifest metadata without extracting or executing package content."""

    if not content:
        raise DifyPackageError("dify_plugin_empty", "The uploaded plugin file is empty.")
    if len(content) > MAX_COMPRESSED_BYTES:
        raise DifyPackageError(
            "dify_plugin_package_too_large",
            "The uploaded plugin package exceeds the 50 MiB compressed limit.",
        )

    digest = hashlib.sha256(content).hexdigest()
    if filename.lower().endswith(".difypkg") or zipfile.is_zipfile(io.BytesIO(content)):
        return _read_zip_payload(content, digest=digest)
    return DifyPackagePayload(
        source_kind="manifest",
        source_digest=digest,
        manifest_bytes=content,
        metadata_files={"manifest.yaml": content},
        signature_state="unsigned",
    )


def _read_zip_payload(content: bytes, *, digest: str) -> DifyPackagePayload:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except (OSError, zipfile.BadZipFile) as exc:
        raise DifyPackageError(
            "dify_plugin_archive_invalid", "The .difypkg archive is invalid."
        ) from exc

    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise DifyPackageError(
                "dify_plugin_archive_too_many_entries",
                "The .difypkg archive exceeds the 2,000 entry limit.",
            )

        normalized_entries: dict[str, zipfile.ZipInfo] = {}
        normalized_keys: set[str] = set()
        total_uncompressed = 0
        total_compressed = 0
        signature_present = False

        for entry in entries:
            path = _normalize_archive_path(entry.filename)
            key = path.casefold()
            if key in normalized_keys:
                raise DifyPackageError(
                    "dify_plugin_archive_duplicate_path",
                    f'The .difypkg archive contains a duplicate path: "{path}".',
                )
            normalized_keys.add(key)
            normalized_entries[path] = entry

            mode = entry.external_attr >> 16
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise DifyPackageError(
                    "dify_plugin_archive_symlink",
                    f'The .difypkg archive contains a symbolic link: "{path}".',
                )

            total_uncompressed += entry.file_size
            total_compressed += entry.compress_size
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                raise DifyPackageError(
                    "dify_plugin_archive_uncompressed_too_large",
                    "The .difypkg archive exceeds the 200 MiB uncompressed limit.",
                )
            if entry.file_size and entry.compress_size == 0 and not entry.is_dir():
                raise DifyPackageError(
                    "dify_plugin_archive_suspicious_ratio",
                    f'The .difypkg entry "{path}" has an invalid compression ratio.',
                )
            if (
                entry.compress_size
                and entry.file_size / entry.compress_size > MAX_COMPRESSION_RATIO
            ):
                raise DifyPackageError(
                    "dify_plugin_archive_suspicious_ratio",
                    f'The .difypkg entry "{path}" exceeds the compression ratio limit.',
                )
            if _looks_like_signature(path):
                signature_present = True

        if total_compressed and total_uncompressed / total_compressed > MAX_COMPRESSION_RATIO:
            raise DifyPackageError(
                "dify_plugin_archive_suspicious_ratio",
                "The .difypkg archive exceeds the aggregate compression ratio limit.",
            )

        manifest_entry = normalized_entries.get("manifest.yaml") or normalized_entries.get(
            "manifest.yml"
        )
        if manifest_entry is None or manifest_entry.is_dir():
            raise DifyPackageError(
                "dify_plugin_manifest_missing",
                "The .difypkg archive must contain manifest.yaml at its root.",
            )

        metadata_files: dict[str, bytes] = {}
        for path, entry in normalized_entries.items():
            if entry.is_dir() or not path.lower().endswith((".yaml", ".yml")):
                continue
            if entry.file_size > MAX_METADATA_FILE_BYTES:
                if path in {"manifest.yaml", "manifest.yml"}:
                    raise DifyPackageError(
                        "dify_plugin_manifest_too_large",
                        "The Dify manifest exceeds the 2 MiB metadata limit.",
                    )
                continue
            metadata_files[path] = archive.read(entry)

        manifest_path = "manifest.yaml" if "manifest.yaml" in metadata_files else "manifest.yml"
        return DifyPackagePayload(
            source_kind="difypkg",
            source_digest=digest,
            manifest_bytes=metadata_files[manifest_path],
            metadata_files=metadata_files,
            signature_state="present_unverified" if signature_present else "unsigned",
        )


def _normalize_archive_path(raw_path: str) -> str:
    value = unicodedata.normalize("NFC", raw_path.replace("\\", "/"))
    path = PurePosixPath(value)
    if not value or value.startswith("/") or path.is_absolute():
        raise DifyPackageError(
            "dify_plugin_archive_unsafe_path",
            f'The .difypkg archive contains an unsafe path: "{raw_path}".',
        )
    if len(value) >= 2 and value[1] == ":":
        raise DifyPackageError(
            "dify_plugin_archive_unsafe_path",
            f'The .difypkg archive contains an unsafe path: "{raw_path}".',
        )
    if any(part in {"", ".", ".."} for part in path.parts):
        raise DifyPackageError(
            "dify_plugin_archive_unsafe_path",
            f'The .difypkg archive contains an unsafe path: "{raw_path}".',
        )
    return path.as_posix().rstrip("/")


def _looks_like_signature(path: str) -> bool:
    name = PurePosixPath(path).name.casefold()
    return (
        "signature" in {part.casefold() for part in PurePosixPath(path).parts}
        or name.endswith((".sig", ".signature"))
        or name in {"signature", "signatures.json"}
    )
