"""Fail-closed configuration, separate from the existing Streamlit deployment."""
from dataclasses import dataclass
import os
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database: str
    owner_email: str
    secret: str
    public_url: str
    local: bool = False
    google_id: str = ""
    google_secret: str = ""
    assets: Path = Path(__file__).resolve().parents[1] / "frontend" / "dist"

    def validate(self):
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
            if not self.google_id or not self.google_secret or len(self.secret) < 32:
                raise ValueError("Configure Google sign-in and a session secret of at least 32 characters.")
            if any('REPLACE_' in value or 'YOUR_' in value for value in (self.database, self.secret, self.google_id, self.google_secret)):
                raise ValueError('Replace the setup placeholders in the host secret settings.')
            if not self.google_id.endswith('.apps.googleusercontent.com'):
                raise ValueError('Use the Google OAuth web client ID from Google Cloud.')
        if not self.owner_email:
            raise ValueError("Configure PRIMUSLAB_OWNER_EMAIL.")


def from_env():
    load_dotenv()
    local = os.getenv("PRIMUSLAB_WEB_LOCAL_ONLY") == "1"
    # Never fall back to the existing local journal or cloud secrets in preview mode.
    settings = Settings(
        database=os.getenv("PRIMUSLAB_WEB_PREVIEW_DB", "data/primus-web-preview.db") if local else os.getenv("TRADELAB_DB_URL", ""),
        owner_email="local@primuslab.invalid" if local else os.getenv("PRIMUSLAB_OWNER_EMAIL", ""),
        secret=token_urlsafe(48) if local else os.getenv("PRIMUSLAB_SESSION_SECRET", ""),
        public_url=os.getenv("PRIMUSLAB_PUBLIC_URL", "http://127.0.0.1:8100" if local else ""),
        local=local, google_id=os.getenv("GOOGLE_CLIENT_ID", ""), google_secret=os.getenv("GOOGLE_CLIENT_SECRET", ""))
    settings.validate()
    return settings
