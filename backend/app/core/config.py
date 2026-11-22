"""Application settings, loaded from environment variables (and an optional local ``.env``)."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Instalytics API"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    log_json: bool = True

    # Comma-separated list of allowed browser origins, e.g. "http://localhost:5173".
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Optional. When set, the readiness probe verifies Redis connectivity.
    redis_url: str | None = None
    redis_timeout_seconds: float = Field(default=2.0, gt=0, le=30)

    # Request limits for the stateless JSON API.
    max_request_body_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_accounts_per_list: int = Field(default=200_000, gt=0)

    # ZIP validation limits (used by the archive module).
    archive_max_bytes: int = Field(default=250 * 1024 * 1024, gt=0)
    archive_max_entries: int = Field(default=10_000, gt=0)
    archive_max_entry_bytes: int = Field(default=200 * 1024 * 1024, gt=0)
    archive_max_total_bytes: int = Field(default=1024 * 1024 * 1024, gt=0)
    archive_max_compression_ratio: int = Field(default=100, gt=1)
    archive_max_json_bytes: int = Field(default=50 * 1024 * 1024, gt=0)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _reject_wildcard(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("Wildcard CORS origins are not allowed; list explicit origins.")
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
