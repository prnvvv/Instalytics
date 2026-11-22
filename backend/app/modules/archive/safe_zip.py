"""Secure, read-only access to ZIP archives.

Archives are validated up front and members are read into memory with hard size caps. Nothing is
ever extracted to disk, so member names cannot cause path traversal; they are only dictionary keys.
"""

from __future__ import annotations

import io
import os
import stat
import struct
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import BinaryIO

from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits
from app.modules.archive.paths import is_metadata_path, safe_member_path

ArchiveSource = bytes | str | os.PathLike[str] | BinaryIO

_EOCD_SIGNATURE = b"PK\x05\x06"
_EOCD_MIN_SIZE = 22
_MAX_EOCD_SEARCH = 65_535 + _EOCD_MIN_SIZE
_ZIP64_ENTRY_MARKER = 0xFFFF
_ZIP64_SIZE_MARKER = 0xFFFFFFFF
_UNIX_CREATE_SYSTEM = 3
_SUPPORTED_COMPRESSION = {
    zipfile.ZIP_STORED,
    zipfile.ZIP_DEFLATED,
    zipfile.ZIP_BZIP2,
    zipfile.ZIP_LZMA,
}
# Upper bound on central-directory bytes per entry (name + extra + comment + 46-byte header).
_MAX_CENTRAL_BYTES_PER_ENTRY = 1024


@dataclass(frozen=True)
class ArchiveMember:
    path: str
    size: int
    compressed_size: int


@dataclass(frozen=True)
class ArchiveReport:
    entry_count: int
    total_uncompressed_bytes: int
    members: tuple[ArchiveMember, ...]


class SafeZip:
    """Context manager that validates a ZIP on entry and reads members with size caps.

    Raises :class:`ArchiveError` for any violation of the configured :class:`ArchiveLimits`.
    """

    def __init__(self, source: ArchiveSource, limits: ArchiveLimits | None = None) -> None:
        self._source = source
        self._limits = limits or ArchiveLimits()
        self._file: BinaryIO | None = None
        self._owns_file = False
        self._zip: zipfile.ZipFile | None = None
        self._infos: dict[str, zipfile.ZipInfo] = {}
        self._bytes_read = 0
        self.report = ArchiveReport(0, 0, ())

    @property
    def members(self) -> tuple[ArchiveMember, ...]:
        return self.report.members

    def __enter__(self) -> SafeZip:
        try:
            self._open()
        except BaseException:
            self.close()
            raise
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()
            self._zip = None
        if self._file is not None and self._owns_file:
            self._file.close()
        self._file = None

    def read(self, path: str, *, max_bytes: int | None = None) -> bytes:
        """Read one member fully into memory, never more than ``max_bytes`` (default: the
        per-entry limit) and never more than the archive-wide uncompressed budget."""
        if self._zip is None:
            raise RuntimeError("SafeZip is not open.")
        info = self._infos.get(path)
        if info is None:
            raise ArchiveError("member_not_found", "File not found in archive.")
        limit = min(max_bytes or self._limits.max_entry_bytes, self._limits.max_entry_bytes)
        if info.file_size > limit:
            raise ArchiveError("entry_too_large", "A file in the archive is too large.")
        if self._bytes_read + info.file_size > self._limits.max_total_bytes:
            raise ArchiveError("total_too_large", "Archive contents are too large.")
        try:
            with self._zip.open(info) as member:
                data = member.read(limit + 1)
        except (zipfile.BadZipFile, zlib.error, EOFError, OSError, NotImplementedError) as exc:
            raise ArchiveError("corrupted_archive", "Archive is corrupted.") from exc
        except RuntimeError as exc:  # raised for encrypted members
            raise ArchiveError("encrypted_entry", "Encrypted archives are not supported.") from exc
        if len(data) > limit:
            raise ArchiveError("entry_too_large", "A file in the archive is too large.")
        self._bytes_read += len(data)
        return data

    # -- internals ---------------------------------------------------------------------------

    def _open(self) -> None:
        limits = self._limits
        self._file = self._to_file(self._source)
        size = _file_size(self._file)
        if size > limits.max_archive_bytes:
            raise ArchiveError("archive_too_large", "Archive file is too large.")
        _precheck_central_directory(self._file, size, limits)
        try:
            self._zip = zipfile.ZipFile(self._file)
        except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, OSError, ValueError) as exc:
            raise ArchiveError("not_a_zip", "File is not a valid ZIP archive.") from exc
        self._validate(self._zip, size)

    def _to_file(self, source: ArchiveSource) -> BinaryIO:
        if isinstance(source, bytes):
            self._owns_file = True
            return io.BytesIO(source)
        if isinstance(source, str | os.PathLike):
            try:
                handle = Path(source).open("rb")  # noqa: SIM115 - closed in SafeZip.close()
            except OSError as exc:
                raise ArchiveError("not_a_zip", "Archive could not be opened.") from exc
            self._owns_file = True
            return handle
        return source

    def _validate(self, archive: zipfile.ZipFile, archive_size: int) -> None:
        limits = self._limits
        infos = archive.infolist()
        if len(infos) > limits.max_entries:
            raise ArchiveError("too_many_entries", "Archive contains too many files.")

        seen: set[str] = set()
        members: list[ArchiveMember] = []
        total = 0
        for info in infos:
            path = safe_member_path(info.filename, limits)
            key = path.lower()
            if key in seen:
                raise ArchiveError("duplicate_entry", "Archive contains duplicate file paths.")
            seen.add(key)

            if info.flag_bits & 0x1:
                raise ArchiveError("encrypted_entry", "Encrypted archives are not supported.")
            if info.create_system == _UNIX_CREATE_SYSTEM and stat.S_ISLNK(info.external_attr >> 16):
                raise ArchiveError("symlink_entry", "Archive contains symbolic links.")
            if info.is_dir():
                continue
            if info.compress_type not in _SUPPORTED_COMPRESSION:
                raise ArchiveError("unsupported_compression", "Unsupported compression method.")
            if not is_metadata_path(path) and _extension(path) not in limits.allowed_extensions:
                raise ArchiveError("unsupported_file_type", "Archive contains unsupported files.")

            if info.file_size > limits.max_entry_bytes:
                raise ArchiveError("entry_too_large", "A file in the archive is too large.")
            total += info.file_size
            if total > limits.max_total_bytes:
                raise ArchiveError("total_too_large", "Archive contents are too large.")
            if _ratio_exceeded(info.file_size, info.compress_size, limits):
                raise ArchiveError("suspicious_compression", "Archive compression is suspicious.")

            self._infos[path] = info
            members.append(ArchiveMember(path, info.file_size, info.compress_size))

        if _ratio_exceeded(total, archive_size, limits):
            raise ArchiveError("suspicious_compression", "Archive compression is suspicious.")
        self.report = ArchiveReport(len(infos), total, tuple(members))


def validate_archive(source: ArchiveSource, limits: ArchiveLimits | None = None) -> ArchiveReport:
    """Validate an archive without reading any member contents."""
    with SafeZip(source, limits) as archive:
        return archive.report


def _extension(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    dot = name.rfind(".")
    return name[dot:].lower() if dot > 0 else ""


def _ratio_exceeded(uncompressed: int, compressed: int, limits: ArchiveLimits) -> bool:
    if uncompressed < limits.ratio_check_min_bytes:
        return False
    return uncompressed / max(compressed, 1) > limits.max_compression_ratio


def _file_size(file: BinaryIO) -> int:
    position = file.tell()
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(position)
    return size


def _precheck_central_directory(file: BinaryIO, size: int, limits: ArchiveLimits) -> None:
    """Reject absurd entry counts before zipfile parses (and allocates) the central directory."""
    tail_length = min(size, _MAX_EOCD_SEARCH)
    file.seek(size - tail_length)
    tail = file.read(tail_length)
    file.seek(0)

    index = tail.rfind(_EOCD_SIGNATURE)
    if index < 0 or len(tail) - index < _EOCD_MIN_SIZE:
        raise ArchiveError("not_a_zip", "File is not a valid ZIP archive.")
    total_entries, central_size = struct.unpack_from("<HI", tail, index + 10)
    if total_entries == _ZIP64_ENTRY_MARKER or central_size == _ZIP64_SIZE_MARKER:
        # ZIP64 records carry the real values; with our (smaller) limits that means "too many".
        if limits.max_entries < _ZIP64_ENTRY_MARKER:
            raise ArchiveError("too_many_entries", "Archive contains too many files.")
        return
    if total_entries > limits.max_entries or (
        central_size > limits.max_entries * _MAX_CENTRAL_BYTES_PER_ENTRY
    ):
        raise ArchiveError("too_many_entries", "Archive contains too many files.")
