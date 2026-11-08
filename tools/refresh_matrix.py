"""Refresh the Matrix snapshot from scheduled jobs, outside web requests."""
import argparse
import math
import os
from datetime import datetime, timedelta, timezone

import requests

FRED = "https://api.stlouisfed.org/fred/series/observations"
CFTC = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
NASDAQ_CFTC_CODE = "209742"


def observations(series, limit=14):
    response = requests.get(FRED, params={
        "api_key": os.environ["FRED_API_KEY"], "series_id": series,
        "file_type": "json", "sort_order": "desc", "limit": limit,
    }, timeout=12)
    if not response.ok:
        raise ValueError(f"FRED returned HTTP {response.status_code}")
    rows = []
    for item in response.json()["observations"]:
        if item["value"] != ".":
            value = float(item["value"])
            if math.isfinite(value):
                rows.append((item["date"], value))
    if not rows:
        raise ValueError("No valid observations")
    return rows


def cftc_position():
    response = requests.get(CFTC, params={
        "cftc_contract_market_code": NASDAQ_CFTC_CODE,
        "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": 1,
    }, timeout=12)
    if not response.ok:
        raise ValueError(f"CFTC returned HTTP {response.status_code}")
    row = response.json()[0]
    if row.get('cftc_contract_market_code') != NASDAQ_CFTC_CODE or 'NASDAQ' not in row.get('market_and_exchange_names', '').upper():
        raise ValueError('CFTC did not return the Nasdaq futures market. Previous snapshot retained.')
    net = int(row["asset_mgr_positions_long"]) - int(row["asset_mgr_positions_short"])
    pct = 100 * net / int(row["open_interest_all"])
    return {"id": "cot", "value": f"{pct:+.1f}%",
            "detail": f"CFTC · Nasdaq-100 E-mini · {row['report_date_as_yyyy_mm_dd'][:10]} · Net asset manager contracts / open interest"}


def update_row(rows, reading):
    return [row for row in rows if row["id"] != reading["id"]] + [reading]


def refresh_fred(snapshot):
    changed = False
    sources = {
        "DGS10": ("tickers", "dgs10", lambda v: f"{v:.2f}%"),
        "WALCL": ("swing", "fed", lambda v: f"${v / 1_000_000:.2f}T"),
        "CPILFESL": ("swing", "cpi", None),
        "T10Y2Y": ("intraday", "curve", None),
        "T10YIE": ("addons", "breakeven", lambda v: f"{v:.2f}%"),
    }
    if os.getenv("MATRIX_ENABLE_ICE_SPREAD") == "1":
        sources["BAMLH0A0HYM2"] = ("swing", "credit", lambda v: f"{v * 100:.0f} bp")
    for series, (group, identifier, format_value) in sources.items():
        try:
            rows = observations(series)
            date, latest = rows[0]
            detail = f"FRED · {series} · {date}"
            if identifier == "cpi":
                prior_year = next(value for day, value in rows if day[:7] == f"{int(date[:4]) - 1}{date[4:7]}")
                value = f"{(latest / prior_year - 1) * 100:.2f}%"
            elif identifier == "curve":
                value = f"{(latest - rows[1][1]) * 100:+.0f} bp"
            else:
                value = format_value(latest)
            reading = {"id": identifier, "value": value, "detail": detail}
            if identifier == "dgs10" and len(rows) >= 2:
                delta = round((latest - rows[1][1]) * 100)
                reading.update(change=f"{delta:+d} bp", direction="up" if delta > 0 else "down" if delta < 0 else "flat")
            if group in ("swing", "intraday"):
                desk = snapshot.setdefault(group, {})
                desk["metrics"] = update_row(desk.get("metrics", []), reading)
            else:
                snapshot[group] = update_row(snapshot.get(group, []), reading)
            if identifier == "dgs10" and len(rows) >= 6:
                desk = snapshot.setdefault("intraday", {})
                desk["metrics"] = update_row(desk.get("metrics", []), {
                    "id": "yield", "value": f"{(latest - rows[5][1]) * 100:+.0f} bp",
                    "detail": f"{detail} · Five observation intervals",
                })
            changed = True
        except (requests.RequestException, ValueError, KeyError, IndexError, StopIteration, ZeroDivisionError) as error:
            print(f"Skipped {series} ({type(error).__name__})")
    return changed


def economic_calendar():
    today = datetime.now(timezone.utc).date()
    response = requests.get("https://financialmodelingprep.com/stable/economic-calendar", params={
        "country": "US", "from": today.isoformat(),
        "to": (today + timedelta(days=7)).isoformat(), "apikey": os.environ["MATRIX_FMP_API_KEY"],
    }, timeout=12)
    if not response.ok:
        raise SystemExit(f"FMP calendar returned HTTP {response.status_code}")
    rows = response.json()
    if not isinstance(rows, list):
        raise SystemExit("FMP did not return a calendar. Previous snapshot retained.")
    return [
        {field: row.get(field) for field in ("date", "event", "actual", "estimate", "unit")}
        for row in sorted(rows, key=lambda row: row.get("date") or "")
        if row.get("country") == "US" and row.get("impact", "").lower() == "high"
        and row.get("date") and row.get("event")
    ][:40]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", choices=("fred", "cot", "calendar"))
    source = parser.parse_args().source
    database_url=os.getenv('MATRIX_DB_URL')
    if database_url:
        import psycopg
        connection=psycopg.connect(database_url.replace('postgresql+psycopg://','postgresql://'),connect_timeout=15)
        # Serialize all refresh writers so overlapping manual/scheduled runs cannot lose sections.
        connection.execute('SELECT pg_advisory_xact_lock(748291)')
        row=connection.execute("SELECT snapshot FROM public.macro_scorecard WHERE id='matrix'").fetchone()
        snapshot=row[0] if row else {}
    else:
        connection=None
        snapshot=None
    url = os.getenv("MATRIX_SUPABASE_URL", "").rstrip("/") + "/rest/v1/macro_scorecard"
    key = os.getenv("MATRIX_SUPABASE_SERVICE_KEY", "")
    headers = {"apikey": key}
    if key.count(".") == 2:
        headers["Authorization"] = f"Bearer {key}"
    if snapshot is None:
        response = requests.get(url, params={"id": "eq.matrix", "select": "snapshot"}, headers=headers, timeout=15)
        response.raise_for_status()
        rows = response.json()
        snapshot = rows[0]["snapshot"] if rows else {}
    if source == "fred":
        changed = refresh_fred(snapshot)
    elif source == "cot":
        desk = snapshot.setdefault("swing", {})
        desk["metrics"] = update_row(desk.get("metrics", []), cftc_position())
        changed = True
    else:
        snapshot["calendar"] = economic_calendar()
        snapshot["calendarAsOf"] = datetime.now(timezone.utc).isoformat()
        changed = True
    if not changed:
        raise SystemExit("No observations refreshed. Previous snapshot retained.")
    snapshot["asOf"] = datetime.now(timezone.utc).isoformat()
    if connection:
        from psycopg.types.json import Jsonb
        try:
            connection.execute("INSERT INTO public.macro_scorecard(id,snapshot) VALUES ('matrix',%s) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",(Jsonb(snapshot),))
            connection.commit()
        finally:
            connection.close()
        return
    response = requests.post(url, headers={**headers, "Prefer": "resolution=merge-duplicates"},
                             json={"id": "matrix", "snapshot": snapshot}, timeout=15)
    response.raise_for_status()


if __name__ == "__main__":
    main()
