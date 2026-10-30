"""Fail-closed configuration, separate from the existing Streamlit deployment."""
from dataclasses import dataclass, field
import os
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database: str = field(repr=False)
    owner_email: str
    secret: str = field(repr=False)
    public_url: str
    local: bool = False
    password_hash: str = field(default="", repr=False)
    assets: Path = Path(__file__).resolve().parents[1] / "frontend" / "dist"
    auth_mode: str = "password"
    supabase_url: str = ""
    supabase_key: str = field(default="", repr=False)
    lab_path: str = ""
    legacy_host: str = ""
    custom_host: str = ""
    site_preview: bool = False

    @property
    def google_required(self):
        return self.auth_mode == "google"

    @property
    def password_required(self):
        # Local preview can exercise the same gate with an isolated test password.
        # Public hosting always requires a configured password.
        return not self.google_required and (not self.local or bool(self.password_hash))

    def validate(self):
        if self.site_preview and (not self.local or self.lab_path != '/lab'):
            raise ValueError('The new Home and Journal draft requires a separate local /lab preview.')
        if self.lab_path not in ('', '/lab'):
            raise ValueError('PRIMUSLAB_LAB_PATH must be empty or /lab.')
        if self.legacy_host:
            import re
            if not re.fullmatch(r'[a-z0-9-]+\.onrender\.com', self.legacy_host):
                raise ValueError('Use the existing onrender.com hostname for the legacy redirect.')
        if self.custom_host:
            import re
            if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', self.custom_host):
                raise ValueError('Use a plain custom domain hostname, without a URL or wildcard.')
        if self.auth_mode not in ("password", "google"):
            raise ValueError("Choose password or google for PRIMUSLAB_AUTH_MODE.")
        if self.google_required:
            import re
            if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co", self.supabase_url):
                raise ValueError("Configure the Supabase project HTTPS URL.")
            if not self.supabase_key or len(self.secret) < 32:
                raise ValueError("Configure the Supabase publishable key and session secret.")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", self.owner_email):
                raise ValueError("Configure the existing journal owner's Google email.")
            if any('REPLACE_' in value or 'YOUR_' in value for value in (self.supabase_key, self.secret)):
                raise ValueError('Replace the sign-in setup placeholders.')
        url = urlsplit(self.public_url)
        if url.path not in ("", "/") or url.query or url.fragment or url.username:
            raise ValueError("PRIMUSLAB_PUBLIC_URL must be an origin without a path.")
        if self.local:
            if url.hostname not in ("127.0.0.1", "localhost", "::1") or url.scheme != "http":
                raise ValueError("Local preview must use a loopback HTTP URL.")
            if not self.database.endswith(".db"):
                raise ValueError("Local preview requires a separate SQLite file.")
        else:
            if url.scheme != "https" or not url.hostname or url.hostname in ("127.0.0.1", "localhost", "::1"):
                raise ValueError("Hosted PrimusLab requires its HTTPS public URL.")
            if not self.database.startswith(("postgresql://", "postgres://", "postgresql+psycopg://")):
                raise ValueError("Hosted PrimusLab requires persistent PostgreSQL storage.")
            if not self.google_required and (not self.password_hash or len(self.secret) < 32):
                raise ValueError("Configure a personal password hash and a session secret of at least 32 characters.")
            if any('REPLACE_' in value or 'YOUR_' in value for value in (self.database, self.secret, self.password_hash)):
                raise ValueError('Replace the setup placeholders in the host secret settings.')
        if self.password_required:
            from .personal_access import validate_hash
            validate_hash(self.password_hash)


def from_env():
    load_dotenv()
    local = os.getenv("PRIMUSLAB_WEB_LOCAL_ONLY") == "1"
    # Never fall back to the existing local journal or cloud secrets in preview mode.
    settings = Settings(
        database=os.getenv("PRIMUSLAB_WEB_PREVIEW_DB", "data/primus-web-preview.db") if local else os.getenv("TRADELAB_DB_URL", ""),
        owner_email=os.getenv("PRIMUSLAB_OWNER_EMAIL", "local@primuslab.invalid" if local else ""),
        secret=token_urlsafe(48) if local else os.getenv("PRIMUSLAB_SESSION_SECRET", ""),
        public_url=os.getenv("PRIMUSLAB_PUBLIC_URL", "http://127.0.0.1:8100" if local else ""),
        local=local, password_hash=os.getenv("PRIMUSLAB_PASSWORD_HASH", ""),
        auth_mode=os.getenv("PRIMUSLAB_AUTH_MODE", "password"),
        supabase_url=os.getenv("PRIMUSLAB_SUPABASE_URL", "").rstrip('/'),
        supabase_key=os.getenv("PRIMUSLAB_SUPABASE_PUBLISHABLE_KEY", ""),
        lab_path=os.getenv("PRIMUSLAB_LAB_PATH", ""),
        legacy_host=os.getenv("PRIMUSLAB_LEGACY_HOST", ""),
        custom_host=os.getenv("PRIMUSLAB_CUSTOM_HOST", ""))
    settings.validate()
    return settings
