"""Storage service: local filesystem."""
from pathlib import Path

from app.core.config import settings


class _LocalStorage:
    """Stores files on local disk under upload_dir."""

    def __init__(self):
        self._root = settings.upload_dir_abs

    def save(self, key: str, data: bytes) -> None:
        path = (self._root / key).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key: str) -> bytes:
        path = (self._root / key).resolve()
        return path.read_bytes()

    def exists(self, key: str) -> bool:
        path = (self._root / key).resolve()
        return path.exists() and path.is_file()

    def delete(self, key: str) -> None:
        path = (self._root / key).resolve()
        if path.exists() and path.is_file():
            path.unlink()


storage = _LocalStorage()
