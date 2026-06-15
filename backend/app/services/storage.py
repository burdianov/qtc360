"""Storage service: local filesystem."""

from pathlib import Path

from app.core.config import settings


class _LocalStorage:
    """Stores files on local disk under upload_dir."""

    def __init__(self):
        self._root = settings.upload_dir_abs

    def _resolve_safe(self, key: str) -> Path:
        """Resolve *key* under the upload root, blocking path traversal.

        Requires Python 3.9+ for ``Path.is_relative_to``. The project's
        ``pyproject.toml`` already pins ``requires-python = ">=3.12"``, so this
        is enforced at install time.
        """
        path = (self._root / key).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError(f"Path traversal detected: {key!r}")
        return path

    def save(self, key: str, data: bytes) -> None:
        path = self._resolve_safe(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key: str) -> bytes:
        path = self._resolve_safe(key)
        return path.read_bytes()

    def exists(self, key: str) -> bool:
        path = self._resolve_safe(key)
        return path.exists() and path.is_file()

    def delete(self, key: str) -> None:
        path = self._resolve_safe(key)
        if path.exists() and path.is_file():
            path.unlink()

    def purge_prefix(self, prefix: str) -> int:
        """Delete every file under ``{root}/{prefix}`` and the directory itself
        if empty. Returns the number of files actually removed.

        Safe to call on a missing directory. Path-traversal is rejected via the
        same ``_resolve_safe`` check used elsewhere.
        """
        path = self._resolve_safe(prefix)
        if not path.exists():
            return 0
        if path.is_file():
            raise ValueError(
                f"purge_prefix target {prefix!r} is a file, not a directory"
            )
        # Sanity-check we're inside our root after the resolve.
        if not path.is_relative_to(self._root):
            raise ValueError(f"Path traversal detected in purge_prefix: {prefix!r}")
        count = 0
        for child in path.rglob("*"):
            if child.is_file():
                try:
                    child.unlink()
                    count += 1
                except OSError:
                    pass
        # Best-effort: remove now-empty parent dirs.
        for child in sorted(path.rglob("*"), reverse=True):
            if child.is_dir():
                try:
                    child.rmdir()
                except OSError:
                    pass
        try:
            path.rmdir()
        except OSError:
            pass
        return count


storage = _LocalStorage()
