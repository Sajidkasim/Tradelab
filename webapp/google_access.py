"""Google through Supabase PKCE; server-owned identities and revocable sessions.

No provider tokens, verifier or workspace selector reaches browser storage.
The verified Google subject (never editable user metadata) owns each journal.
"""
import base64
from datetime import timedelta
import hashlib
import hmac
import re
from secrets import token_hex, token_urlsafe
from threading import RLock
from time import monotonic
from urllib.parse import urlencode

import httpx
import sqlalchemy as sa

from .personal_access import SESSION_SECONDS, now_utc

metadata = sa.MetaData()
identities = sa.Table('primus_google_identities', metadata,
    sa.Column('key', sa.String(32), primary_key=True),
    sa.Column('subject', sa.String(64), unique=True),
    sa.Column('owner_email', sa.String(254)),
    sa.Column('active', sa.Boolean, nullable=False, default=True))
sessions = sa.Table('primus_google_sessions', metadata,
    sa.Column('token_hash', sa.String(64), primary_key=True),
    sa.Column('key', sa.String(32), sa.ForeignKey(identities.c.key), nullable=False),
    sa.Column('version', sa.String(64), nullable=False),
    sa.Column('expires_at', sa.DateTime, nullable=False))


class LoginError(Exception):
    """Deliberately carries no provider response or credentials."""


def harden_tables(database, tables):
    """Only the backend DB role may read journal/auth tables through Supabase.

    Schema qualification also works for member databases. RLS has no browser
    policies: anon/authenticated roles cannot use the Supabase data API to skip
    our private HTTP routes. This never modifies Supabase's own auth schema.
    """
    if database.is_sqlite:
        return
    schema = database.engine.get_execution_options().get('schema_translate_map', {}).get(None) or 'public'
    quote = database.engine.dialect.identifier_preparer.quote
    with database.engine.begin() as connection:
        roles = set(connection.execute(sa.text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).scalars())
        for table in tables:
            name = f'{quote(schema)}.{quote(table.name)}'
            connection.exec_driver_sql(f'ALTER TABLE {name} ENABLE ROW LEVEL SECURITY')
            connection.exec_driver_sql(f'REVOKE ALL ON TABLE {name} FROM PUBLIC')
            for role in sorted(roles):
                connection.exec_driver_sql(f'REVOKE ALL ON TABLE {name} FROM {quote(role)}')


def google_identity(user):
    # identity_data belongs to the provider. user_metadata is user-editable.
    matches = [item.get('identity_data', {}) for item in user.get('identities', [])
               if item.get('provider') == 'google']
    if len(matches) != 1 or not user.get('email_confirmed_at'):
        raise LoginError()
    identity = matches[0]
    email = str(identity.get('email', '')).strip().lower()
    subject = identity.get('sub')
    if (identity.get('email_verified') is not True or not isinstance(subject, str)
            or not 1 <= len(subject) <= 255
            or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email)
            or email != str(user.get('email', '')).strip().lower()):
        raise LoginError()
    return email, hashlib.sha256(f'google:{subject}'.encode()).hexdigest()


class GoogleAccess:
    def __init__(self, database, config):
        self.database, self.config = database, config
        self.lock, self.attempts = RLock(), {}
        self.version = hmac.new(config.secret.encode(), f'google:{config.supabase_url}'.encode(), hashlib.sha256).hexdigest()
        self.client = httpx.Client(timeout=15, follow_redirects=False)
        metadata.create_all(database.engine)
        harden_tables(database, metadata.sorted_tables)
        insert = (__import__('sqlalchemy.dialects.sqlite', fromlist=['insert']).insert if database.is_sqlite else
                  __import__('sqlalchemy.dialects.postgresql', fromlist=['insert']).insert)
        owner = config.owner_email.strip().lower()
        with database.engine.begin() as connection:
            connection.execute(insert(identities).values(key='owner', owner_email=owner, active=True)
                               .on_conflict_do_nothing(index_elements=['key']))
            saved = connection.scalar(sa.select(identities.c.owner_email).where(identities.c.key == 'owner'))
            if saved != owner:
                raise ValueError('The configured owner does not match this journal. Restore the original owner email.')

    def start(self, previous=None):
        with self.lock:
            now = monotonic()
            self.attempts = {key: value for key, value in self.attempts.items() if value[1] > now}
            self.attempts.pop(previous, None)
            if len(self.attempts) >= 200:
                raise LoginError()
            attempt, verifier = token_urlsafe(32), token_urlsafe(48)
            self.attempts[attempt] = (verifier, now + 600)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        # Fixed callback; an attacker cannot supply an external return URL.
        query = urlencode({'provider': 'google', 'redirect_to': self.config.public_url.rstrip('/') + '/auth/callback',
                           'code_challenge': challenge, 'code_challenge_method': 's256',
                           'scopes': 'openid email profile', 'prompt': 'select_account'})
        return attempt, self.config.supabase_url + '/auth/v1/authorize?' + query

    def exchange(self, attempt, code):
        with self.lock:
            pending = self.attempts.pop(attempt, None) if isinstance(attempt, str) else None
        if not pending or pending[1] <= monotonic() or not isinstance(code, str) or not 1 <= len(code) <= 2048:
            raise LoginError()
        try:
            result = self.client.post(self.config.supabase_url + '/auth/v1/token?grant_type=pkce',
                headers={'apikey': self.config.supabase_key}, json={'auth_code': code, 'code_verifier': pending[0]})
            result.raise_for_status()
            token = result.json()['access_token']
            user = self.client.get(self.config.supabase_url + '/auth/v1/user',
                headers={'apikey': self.config.supabase_key, 'Authorization': 'Bearer ' + token})
            user.raise_for_status()
            return google_identity(user.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise LoginError() from None

    def join(self, email, subject):
        with self.lock, self.database.engine.begin() as connection:
            existing = connection.execute(sa.select(identities).where(identities.c.subject == subject)).mappings().first()
            if existing:
                if not existing['active']:
                    raise LoginError()
                return existing['key']
            owner = connection.execute(sa.select(identities).where(identities.c.key == 'owner')).mappings().one()
            if email == owner['owner_email']:
                if owner['subject'] is not None or not owner['active']:
                    raise LoginError()
                changed = connection.execute(identities.update().where(identities.c.key == 'owner', identities.c.subject.is_(None))
                                             .values(subject=subject))
                if changed.rowcount != 1:
                    raise LoginError()
                return 'owner'
            key = token_hex(16)
            connection.execute(identities.insert().values(key=key, subject=subject, active=True))
            return key

    def registered(self, key):
        with self.database.engine.connect() as connection:
            return connection.scalar(sa.select(identities.c.key).where(identities.c.key == key, identities.c.active.is_(True),
                                                                     identities.c.subject.is_not(None))) is not None

    def issue(self, key):
        if not self.registered(key):
            raise LoginError()
        token = token_urlsafe(48)
        with self.database.engine.begin() as connection:
            connection.execute(sessions.delete().where(sa.or_(sessions.c.expires_at <= now_utc(), sessions.c.version != self.version)))
            connection.execute(sessions.insert().values(token_hash=hashlib.sha256(token.encode()).hexdigest(), key=key,
                version=self.version, expires_at=now_utc() + timedelta(seconds=SESSION_SECONDS)))
        return token

    def member(self, token):
        if not isinstance(token, str) or not 40 <= len(token) <= 100:
            raise LoginError()
        with self.database.engine.connect() as connection:
            key = connection.scalar(sa.select(sessions.c.key).join(identities).where(
                sessions.c.token_hash == hashlib.sha256(token.encode()).hexdigest(),
                sessions.c.version == self.version, sessions.c.expires_at > now_utc(), identities.c.active.is_(True)))
        if not key:
            raise LoginError()
        return {'key': key, 'name': 'My journal', 'slot': 0, 'owner': key == 'owner'}

    def revoke(self, token):
        if isinstance(token, str):
            with self.database.engine.begin() as connection:
                connection.execute(sessions.delete().where(sessions.c.token_hash == hashlib.sha256(token.encode()).hexdigest()))

    def close(self):
        self.client.close()
