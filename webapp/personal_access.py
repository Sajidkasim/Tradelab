"""Single-owner password access, throttling and revocable server-side sessions.

Only a salted Argon2id hash is configured on the server. Passwords, session
tokens and hashes are never stored in journal backups or sent to the browser.
"""
from collections import deque
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import math
from secrets import token_urlsafe
from threading import Lock
from time import monotonic

from argon2 import PasswordHasher, extract_parameters, Type
from argon2.exceptions import VerificationError, InvalidHashError
import sqlalchemy as sa

HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, type=Type.ID)
SESSION_SECONDS = 7 * 24 * 3600
metadata = sa.MetaData()
sessions = sa.Table('primus_personal_sessions', metadata,
    sa.Column('token_hash', sa.String(64), primary_key=True),
    sa.Column('version', sa.String(64), nullable=False),
    sa.Column('expires_at', sa.DateTime, nullable=False))


def hash_password(password):
    if not 16 <= len(password) <= 128:
        raise ValueError('Choose a password or passphrase between 16 and 128 characters.')
    return HASHER.hash(password)


def validate_hash(encoded):
    try:
        parameters = extract_parameters(encoded)
    except (InvalidHashError, ValueError, TypeError):
        raise ValueError('Configure PRIMUSLAB_PASSWORD_HASH using the password setup helper.') from None
    if (parameters.type is not Type.ID or not 19456 <= parameters.memory_cost <= 131072
            or not 2 <= parameters.time_cost <= 6 or not 1 <= parameters.parallelism <= 4
            or parameters.salt_len < 16 or parameters.hash_len < 32):
        raise ValueError('Use the Argon2id hash produced by the password setup helper.')


def auth_version(encoded, secret):
    return hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()


class Throttled(Exception):
    def __init__(self, retry_after):
        self.retry_after = retry_after


class PasswordGate:
    """One owner, one process: at most five password checks per minute.

    The lock also bounds Argon2 memory use to one verification at a time. Keep
    the deployment at one worker/instance so attempts cannot bypass this limit.
    """
    def __init__(self, encoded, clock=monotonic):
        validate_hash(encoded)
        self.encoded, self.clock = encoded, clock
        self.attempts, self.lock = deque(), Lock()

    def check(self, password):
        with self.lock:
            now = self.clock()
            while self.attempts and self.attempts[0] <= now - 60:
                self.attempts.popleft()
            if len(self.attempts) >= 5:
                raise Throttled(max(1, math.ceil(60 - (now - self.attempts[0]))))
            self.attempts.append(now)
            try:
                valid = HASHER.verify(self.encoded, password)
            except (VerificationError, InvalidHashError):
                return False
            if valid:
                self.attempts.clear()
            return valid


def now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PersonalSessions:
    def __init__(self, database, version):
        self.database, self.version = database, version
        metadata.create_all(database.engine)

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def issue(self):
        token = token_urlsafe(48)
        now = now_utc()
        with self.database.engine.begin() as connection:
            connection.execute(sessions.delete().where(sa.or_(sessions.c.expires_at <= now, sessions.c.version != self.version)))
            connection.execute(sessions.insert().values(token_hash=self.digest(token), version=self.version,
                                                        expires_at=now + timedelta(seconds=SESSION_SECONDS)))
        return token

    def valid(self, token):
        if not isinstance(token, str) or not 40 <= len(token) <= 100:
            return False
        with self.database.engine.connect() as connection:
            return connection.scalar(sa.select(sessions.c.token_hash).where(
                sessions.c.token_hash == self.digest(token), sessions.c.version == self.version,
                sessions.c.expires_at > now_utc())) is not None

    def revoke(self, token):
        if not isinstance(token, str):
            return
        with self.database.engine.begin() as connection:
            connection.execute(sessions.delete().where(sessions.c.token_hash == self.digest(token)))
