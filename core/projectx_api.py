"""Read-only ProjectX Gateway client for TopstepX.

Only these endpoints are implemented, on purpose:
    POST /api/Auth/loginKey        authenticate with username + API key
    POST /api/Account/search       list accounts
    POST /api/Trade/search         half-turn fills for an account and date range
    POST /api/Contract/search      look up contracts (id, tick size, tick value)
    POST /api/History/retrieveBars historical OHLCV bars

There is deliberately NO order placement, modification or cancellation here.

Credentials come from the environment (PROJECTX_USERNAME, PROJECTX_API_KEY),
typically via a .env file loaded with python-dotenv. They are never logged.

    client = ProjectXClient.from_env()
    accounts = client.accounts()
    fills = client.fills(account_id, start, end)          # -> DataFrame for fills_to_trades
    bars = client.bars("CON.F.US.MES.Z26", start, end, unit=Unit.MINUTE, unit_number=1)
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import IntEnum
from typing import Any, Optional

import pandas as pd

try:
    import requests
except ImportError:  # pragma: no cover - requests is in requirements.txt
    requests = None  # type: ignore

TOPSTEPX_BASE = "https://api.topstepx.com"
TOPSTEPX_USER_HUB = "https://rtc.topstepx.com/hubs/user"
TOPSTEPX_MARKET_HUB = "https://rtc.topstepx.com/hubs/market"
MAX_BARS_PER_REQUEST = 20_000


class Unit(IntEnum):
    SECOND = 1
    MINUTE = 2
    HOUR = 3
    DAY = 4
    WEEK = 5
    MONTH = 6


class ProjectXError(RuntimeError):
    pass


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class ProjectXClient:
    username: str
    api_key: str
    base_url: str = TOPSTEPX_BASE
    session: Any = None                 # a requests.Session or anything with .post()
    timeout: float = 30.0
    max_retries: int = 4
    _token: Optional[str] = None
    _token_time: float = 0.0

    @classmethod
    def from_env(cls, base_url: str = TOPSTEPX_BASE) -> "ProjectXClient":
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except ImportError:
            pass
        u, k = os.getenv("PROJECTX_USERNAME"), os.getenv("PROJECTX_API_KEY")
        if not u or not k:
            # Streamlit Community Cloud keeps secrets in st.secrets rather than the environment
            try:
                import streamlit as st  # noqa: WPS433
                u = u or st.secrets.get("PROJECTX_USERNAME")
                k = k or st.secrets.get("PROJECTX_API_KEY")
            except Exception:  # noqa: BLE001
                pass
        if not u or not k:
            raise ProjectXError("Set PROJECTX_USERNAME and PROJECTX_API_KEY in your .env file")
        return cls(username=u, api_key=k, base_url=base_url)

    # ---- transport -------------------------------------------------------
    def _http(self):
        if self.session is None:
            if requests is None:
                raise ProjectXError("pip install requests")
            self.session = requests.Session()
        return self.session

    def _post(self, path: str, body: dict, auth: bool = True) -> dict:
        url = f"{self.base_url}{path}"
        headers = {"accept": "text/plain", "Content-Type": "application/json"}
        delay = 1.0
        for attempt in range(self.max_retries + 1):
            if auth:
                headers["Authorization"] = f"Bearer {self.token()}"
            resp = self._http().post(url, json=body, headers=headers, timeout=self.timeout)
            status = getattr(resp, "status_code", 200)
            if status == 401 and auth and attempt == 0:
                self._token = None                      # expired: re-authenticate once
                continue
            if status == 429 or status >= 500:
                if attempt < self.max_retries:
                    time.sleep(delay); delay *= 2
                    continue
                raise ProjectXError(f"{path} failed with HTTP {status} after retries")
            if status >= 400:
                raise ProjectXError(f"{path} failed with HTTP {status}")
            data = resp.json()
            if not data.get("success", False):
                raise ProjectXError(f"{path}: errorCode={data.get('errorCode')} {data.get('errorMessage')}")
            return data
        raise ProjectXError(f"{path}: gave up")

    def token(self) -> str:
        # tokens are long-lived; refresh proactively after 12h
        if self._token and time.time() - self._token_time < 12 * 3600:
            return self._token
        data = self._post("/api/Auth/loginKey", {"userName": self.username, "apiKey": self.api_key}, auth=False)
        self._token = data["token"]
        self._token_time = time.time()
        return self._token

    # ---- endpoints -------------------------------------------------------
    def accounts(self, only_active: bool = True) -> pd.DataFrame:
        data = self._post("/api/Account/search", {"onlyActiveAccounts": only_active})
        return pd.DataFrame(data.get("accounts", []))

    def contracts(self, search_text: str, live: bool = False) -> pd.DataFrame:
        data = self._post("/api/Contract/search", {"searchText": search_text, "live": live})
        return pd.DataFrame(data.get("contracts", []))

    def fills_raw(self, account_id: int, start: datetime, end: Optional[datetime] = None,
                  chunk_days: int = 30) -> list[dict]:
        """All fills between start and end, fetched in date chunks."""
        end = end or datetime.now(timezone.utc)
        out: list[dict] = []
        cur = start
        while cur < end:
            nxt = min(cur + timedelta(days=chunk_days), end)
            data = self._post("/api/Trade/search", {"accountId": int(account_id),
                                                    "startTimestamp": _iso(cur),
                                                    "endTimestamp": _iso(nxt)})
            out.extend(data.get("trades", []))
            cur = nxt
        # de-duplicate on id in case chunk edges overlap
        seen, uniq = set(), []
        for t in out:
            if t.get("id") not in seen:
                seen.add(t.get("id")); uniq.append(t)
        return uniq

    def fills(self, account_id: int, start: datetime, end: Optional[datetime] = None,
              contract_symbols: Optional[dict[str, str]] = None) -> pd.DataFrame:
        """Fills as a DataFrame ready for core.fills_to_trades.pair_fills."""
        from .fills_to_trades import fills_from_projectx, root_symbol
        raw = self.fills_raw(account_id, start, end)
        ids = {str(t.get("contractId")) for t in raw}
        mapping = dict(contract_symbols or {})
        for cid in ids:
            mapping.setdefault(cid, root_symbol(cid))
        return fills_from_projectx(raw, mapping, account_id=account_id)

    def bars(self, contract_id: str, start: datetime, end: datetime, unit: Unit = Unit.MINUTE,
             unit_number: int = 1, live: bool = False, include_partial: bool = False) -> pd.DataFrame:
        """OHLCV bars, automatically chunked so no request asks for > 20,000 bars.
        Returns columns t (UTC), o, h, l, c, v sorted ascending."""
        per_bar = {Unit.SECOND: 1, Unit.MINUTE: 60, Unit.HOUR: 3600, Unit.DAY: 86400,
                   Unit.WEEK: 7 * 86400, Unit.MONTH: 30 * 86400}[unit] * unit_number
        span = timedelta(seconds=per_bar * (MAX_BARS_PER_REQUEST - 1))
        frames = []
        cur = start
        while cur < end:
            nxt = min(cur + span, end)
            data = self._post("/api/History/retrieveBars", {
                "contractId": contract_id, "live": live, "startTime": _iso(cur), "endTime": _iso(nxt),
                "unit": int(unit), "unitNumber": int(unit_number), "limit": MAX_BARS_PER_REQUEST,
                "includePartialBar": include_partial})
            rows = data.get("bars", [])
            if rows:
                frames.append(pd.DataFrame(rows))
            cur = nxt
        if not frames:
            return pd.DataFrame(columns=["t", "o", "h", "l", "c", "v"])
        df = pd.concat(frames, ignore_index=True)
        df["t"] = pd.to_datetime(df["t"], utc=True)
        df = df.drop_duplicates("t").sort_values("t").reset_index(drop=True)
        return df[["t", "o", "h", "l", "c", "v"]]

    def check(self) -> dict:
        """Cheap connectivity check for a settings page. Never returns the key."""
        try:
            accts = self.accounts()
            return {"ok": True, "accounts": int(len(accts)), "user": self.username}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "user": self.username}
