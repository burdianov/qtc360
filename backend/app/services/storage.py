"""Storage service: local filesystem."""

from pathlib import Path

from app.core.config import settings


class _LocalStorage:
    """Stores files on local disk under upload_dir."""

    def __init__(self):
        self._root = settings.upload_dir_abs

    def _resolve_safe(self, key: str) -> Path:
        """Resolve *key* under the upload root, blocking path traversal."""
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


storage = _LocalStorage()
