import os
from dataclasses import dataclass, field
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'zarnegaar.db'}"))
    owner_username: str = field(default_factory=lambda: os.getenv("NOOR_OWNER_USERNAME", ""))
    owner_password_hash: str = field(default_factory=lambda: os.getenv("NOOR_OWNER_PASSWORD_HASH", ""))
    origins: tuple = field(default_factory=lambda: tuple(value.strip().rstrip("/") for value in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if value.strip()))
    cookie_secure: bool = field(default_factory=lambda: os.getenv("NOOR_COOKIE_SECURE", "true").lower() != "false")
    session_seconds: int = 8 * 60 * 60
    upload_dir: Path = field(default_factory=lambda: Path(os.getenv("NOOR_UPLOAD_DIR", str(BASE_DIR / 'uploads'))))
    rate_url: str = field(default_factory=lambda: os.getenv("GOLD_RATE_URL", ""))
    rate_token: str = field(default_factory=lambda: os.getenv("GOLD_RATE_TOKEN", ""))
    rate_stale_seconds: int = field(default_factory=lambda: int(os.getenv("GOLD_RATE_STALE_SECONDS", "300")))
    rate_cache_seconds: int = 30
