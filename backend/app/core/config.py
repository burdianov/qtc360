import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_PLACEHOLDER_SECRETS = {"change-me-in-production", "changeme", "secret", ""}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env", env_file_encoding="utf-8", extra="ignore"
    )

    # Database
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "qtc360"
    postgres_user: str = "qtc360"
    postgres_password: str = "qtc360_dev"

    # LibreOffice (fallback, not needed if Gotenberg is running)
    libreoffice_path: str = "soffice"

    # Gotenberg (DOCX→PDF conversion service)
    gotenberg_url: str = "http://localhost:3100"

    # File storage
    upload_dir: str = "./uploads"
    storage_backend: str = "local"  # "local" or "r2"
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "qtc360-files"

    # Auth
    secret_key: str  # REQUIRED — must be set in .env
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # CORS / environment
    environment: str = "development"  # development | production
    allowed_origins: str = "http://localhost:3000"

    @property
    def database_url(self) -> str:
        base = (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        if self.environment == "production":
            return f"{base}?ssl=require"
        return base

    @property
    def upload_dir_abs(self) -> Path:
        return Path(self.upload_dir).expanduser().resolve()

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()

# Fail fast on placeholder/weak SECRET_KEY in production. In development we warn loudly
# but allow startup so first-time setup is not blocked.
if settings.secret_key.strip() in _PLACEHOLDER_SECRETS or len(settings.secret_key) < 32:
    if settings.environment.lower() == "production":
        raise RuntimeError(
            "SECRET_KEY is missing, weak, or set to a placeholder. "
            "Generate a strong secret (e.g. `python -c 'import secrets;print(secrets.token_urlsafe(64))'`) "
            "and set it via the SECRET_KEY environment variable before starting the server."
        )
    else:
        import warnings
        warnings.warn(
            "SECRET_KEY is weak or a known placeholder. Tokens are forgeable. "
            "Set a strong SECRET_KEY before any non-development deployment.",
            stacklevel=2,
        )
