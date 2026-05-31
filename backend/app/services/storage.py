"""Storage abstraction: local filesystem (dev) or Cloudflare R2 (production)."""
import io
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


class _R2Storage:
    """Stores files in Cloudflare R2 (S3-compatible)."""

    def __init__(self):
        import boto3
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        self._bucket = settings.r2_bucket_name

    def save(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)

    def read(self, key: str) -> bytes:
        resp = self._client.get_object(Bucket=self._bucket, Key=key)
        return resp["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except self._client.exceptions.NoSuchKey:
            return False
        except Exception:
            return False

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


def _create_storage():
    if settings.storage_backend == "r2":
        return _R2Storage()
    return _LocalStorage()


storage = _create_storage()
