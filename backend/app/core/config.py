from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # LibreOffice
    libreoffice_path: str = "soffice"

    # File storage
    upload_dir: str = "./uploads"

    # Auth
    secret_key: str  # REQUIRED — must be set in .env
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
