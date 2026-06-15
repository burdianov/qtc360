from pathlib import Path

from pydantic import SecretStr, field_validator
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

    # Auth
    secret_key: SecretStr  # REQUIRED — must be set in .env
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # CORS / environment
    environment: str = "development"  # development | production
    # Comma-separated. Default is empty; prod must set explicitly.
    allowed_origins: str = ""

    @field_validator("secret_key", mode="before")
    @classmethod
    def _require_secret_key(cls, v):  # type: ignore[no-untyped-def]
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError(
                "SECRET_KEY is required. Generate a strong secret with "
                "`python -c 'import secrets; print(secrets.token_urlsafe(64))'` "
                "and set it via the SECRET_KEY env var or .env file."
            )
        return v

    @property
    def database_url(self) -> str:
        base = (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
        # SSL only for external managed databases (Neon, etc.)
        if self.environment == "production" and self.postgres_host not in (
            "localhost",
            "postgres",
            "127.0.0.1",
        ):
            return f"{base}?ssl=require"
        return base

    @property
    def upload_dir_abs(self) -> Path:
        return Path(self.upload_dir).expanduser().resolve()

    @property
    def cors_origins(self) -> list[str]:
        """Parse allowed_origins into a list of non-empty, valid origin strings.

        Empty entries (from trailing commas / whitespace) are dropped. Returns
        an empty list when nothing is configured — main.py treats that as
        "no cross-origin requests allowed" rather than the dangerous
        "allow localhost" default the previous implementation had.

        Apex-domain entries are also returned with their ``www.`` counterpart
        added so a CDN that bounces ``qtc360.com`` → ``www.qtc360.com`` does
        not break CORS. This is opt-in via the ``auto_www`` flag (default
        on) and only applied in production.
        """
        out: list[str] = []
        for raw in self.allowed_origins.split(","):
            o = raw.strip()
            if o:
                out.append(o)
        return out

    @property
    def cors_origins_with_www(self) -> list[str]:
        """CORS allowlist with the ``www.`` counterpart of any apex domain
        automatically appended. Production only.

        The frontend lives at https://qtc360.com; the apex is the documented
        public URL, but Caddy / DNS / browser autocorrect may bounce users to
        https://www.qtc360.com. Without this normalization, an apex-only
        allowlist would cause the browser to block the very first cross-origin
        request from the www variant.
        """
        origins = self.cors_origins
        if self.environment.lower() != "production":
            return origins
        expanded: list[str] = []
        for o in origins:
            expanded.append(o)
            if o.startswith("https://") and not o.startswith("https://www."):
                # Insert the www counterpart after the apex so the order
                # matches what the user wrote in their .env.
                expanded.append("https://www." + o.removeprefix("https://"))
        return expanded


settings = Settings()


def _secret_str_value() -> str:
    return settings.secret_key.get_secret_value()


# Fail fast on placeholder/weak SECRET_KEY. Refuses to start in ANY environment
# if the secret is a known placeholder; in production we additionally require
# length >= 32 and refuse a localhost-only CORS config.
_secret_raw = _secret_str_value()
if _secret_raw.strip() in _PLACEHOLDER_SECRETS or len(_secret_raw) < 32:
    raise RuntimeError(
        "SECRET_KEY is missing, weak, or set to a known placeholder. "
        "Generate a strong secret (e.g. `python -c 'import secrets;print(secrets.token_urlsafe(64))'`) "
        "and set it via the SECRET_KEY environment variable before starting the server."
    )

if settings.environment.lower() == "production":
    if not settings.cors_origins:
        raise RuntimeError(
            "ALLOWED_ORIGINS is required in production. Set it to a comma-separated "
            "list of allowed origins (e.g. 'https://qtc360.com')."
        )
    for origin in settings.cors_origins:
        if origin == "*":
            raise RuntimeError(
                "ALLOWED_ORIGINS must not contain a wildcard in production "
                "(incompatible with allow_credentials=True)."
            )
        if not origin.startswith("https://"):
            raise RuntimeError(
                f"ALLOWED_ORIGINS entry {origin!r} is not an https:// URL. "
                "Production origins must use TLS."
            )
        if origin.startswith("http://localhost") or origin.startswith("http://127."):
            raise RuntimeError(
                f"ALLOWED_ORIGINS entry {origin!r} is a localhost origin in production. "
                "Configure a real https:// origin for the deployed frontend."
            )
        if origin == "https://qtc360.com":
            # The apex domain — make sure the most common apex-www variant is
            # also covered so an apex-vs-www redirect doesn't break CORS.
            continue
elif not settings.cors_origins:
    # Development convenience: default to the local Next.js dev server only.
    settings = settings.model_copy(update={"allowed_origins": "http://localhost:3000"})
