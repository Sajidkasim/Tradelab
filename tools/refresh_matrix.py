"""Refresh the Matrix v2 multi-asset macro snapshot (FRED, CFTC COT, Markets, Seasonality, Calendar)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
import io
import math
import os
import re
from zoneinfo import ZoneInfo

import requests

FRED = "https://api.stlouisfed.org/fred/series/observations"
CFTC_FIN = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
CFTC_DISAGG = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"
# Keep CFTC alias for existing tests and callers
CFTC = CFTC_FIN
NASDAQ_CFTC_CODE = "209742"
NY = ZoneInfo("America/New_York")

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PrimusTraderMatrix/2.0; +https://primustrader.co.uk)",
    "Accept": "application/json",
}

COT_MARKETS = (
    {"id": "nq", "symbol": "NQ", "name": "Nasdaq-100 E-mini", "code": "209742", "feed": "fin", "match": "NASDAQ"},
    {"id": "es", "symbol": "ES", "name": "S&P 500 E-mini", "code": "13874A", "feed": "fin", "match": "S&P"},
    {"id": "xau", "symbol": "XAU", "name": "Gold (COMEX)", "code": "088691", "feed": "disagg", "match": "GOLD"},
    {"id": "dxy", "symbol": "DXY", "name": "US Dollar Index", "code": "098662", "feed": "fin", "match": "USD"},
    {"id": "eurusd", "symbol": "EURUSD", "name": "Euro FX", "code": "099741", "feed": "fin", "match": "EURO"},
    {"id": "gbpusd", "symbol": "GBPUSD", "name": "British Pound", "code": "096742", "feed": "fin", "match": "POUND"},
)

MARKET_SYMBOLS = {
    "nq": ("NQ=F", "NQ1!", "Nasdaq-100 Futures", 2),
    "es": ("ES=F", "ES1!", "S&P 500 Futures", 2),
    "xau": ("GC=F", "Gold", "COMEX Gold Futures", 2),
    "dxy": ("DX-Y.NYB", "DXY", "US Dollar Index", 2),
    "eurusd": ("EURUSD=X", "EURUSD", "Euro / US Dollar", 4),
    "gbpusd": ("GBPUSD=X", "GBPUSD", "British Pound / USD", 4),
    "vix": ("^VIX", "VIX", "CBOE Volatility Index", 2),
    "vxv": ("^VIX3M", "VIX3M", "CBOE 3M Volatility", 2),
}

MAG7_SYMBOLS = (
    ("NVDA", "Nvidia"),
    ("AAPL", "Apple"),
    ("MSFT", "Microsoft"),
    ("AMZN", "Amazon"),
    ("META", "Meta"),
    ("GOOGL", "Alphabet"),
    ("TSLA", "Tesla"),
    ("SMH", "Semis ETF"),
)

TIER1_NEWS = re.compile(r"\b(?:CPI|FOMC|NFP|Non-?Farm|Payroll|PCE|Powell|Rate Decision|Interest Rate)\b", re.IGNORECASE)
MARKET_MOVER_NEWS = re.compile(
    r"\b(?:CPI|PPI|FOMC|NFP|Non-?Farm|Payroll|Jobs|JOLTS|GDP|PCE|Retail Sales|Unemployment|Initial Claims|Jobless|Fed|Powell|ISM|PMI|Consumer Confidence|Consumer Sentiment|Durable Goods|Rate Decision|Minutes)\b",
    re.IGNORECASE,
)
HAWKISH_IF_HOT = re.compile(r"\b(?:CPI|PPI|PCE|Inflation|Payroll|NFP|Jobs|Retail Sales|GDP|ISM|PMI|Wages|Hourly Earnings)\b", re.IGNORECASE)
DOVISH_IF_HOT = re.compile(r"\b(?:Unemployment|Initial Claims|Jobless)\b", re.IGNORECASE)


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def _fmt_price(value, decimals=2):
    if value is None or not math.isfinite(value):
        return "—"
    if decimals >= 4:
        return f"{value:.4f}"
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    return f"{value:.2f}"


def _spark(values, limit=20):
    clean = [round(float(v), 4) for v in values if v is not None and math.isfinite(float(v))]
    return clean[-limit:]


def observations(series, limit=30):
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        raise ValueError("FRED_API_KEY not configured")
    response = requests.get(FRED, params={
        "api_key": api_key, "series_id": series,
        "file_type": "json", "sort_order": "desc", "limit": limit,
    }, timeout=12)
    if not response.ok:
        raise ValueError(f"FRED returned HTTP {response.status_code}")
    rows = []
    for item in response.json().get("observations", []):
        if item.get("value") not in (None, "", "."):
            value = float(item["value"])
            if math.isfinite(value):
                rows.append((item["date"], value))
    if not rows:
        raise ValueError("No valid observations")
    return rows


def cftc_position():
    """Fetch latest Nasdaq-100 E-mini COT reading (backward-compatible helper)."""
    response = requests.get(CFTC, params={
        "cftc_contract_market_code": NASDAQ_CFTC_CODE,
        "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": 1,
    }, timeout=12)
    if not response.ok:
        raise ValueError(f"CFTC returned HTTP {response.status_code}")
    rows = response.json()
    if not rows:
        raise ValueError("CFTC returned no Nasdaq rows")
    row = rows[0]
    if row.get("cftc_contract_market_code") != NASDAQ_CFTC_CODE or "NASDAQ" not in row.get("market_and_exchange_names", "").upper():
        raise ValueError("CFTC did not return the Nasdaq futures market. Previous snapshot retained.")
    net = int(row["asset_mgr_positions_long"]) - int(row["asset_mgr_positions_short"])
    pct = 100 * net / int(row["open_interest_all"])
    return {
        "id": "cot",
        "value": f"{pct:+.1f}%",
        "detail": f"CFTC · Nasdaq-100 E-mini · {row['report_date_as_yyyy_mm_dd'][:10]} · Net asset manager contracts / open interest",
    }


def fetch_cot_market(spec):
    """Fetch 52 weeks of CFTC institutional positioning for one market."""
    url = CFTC_FIN if spec["feed"] == "fin" else CFTC_DISAGG
    long_field = "asset_mgr_positions_long" if spec["feed"] == "fin" else "m_money_positions_long_all"
    short_field = "asset_mgr_positions_short" if spec["feed"] == "fin" else "m_money_positions_short_all"

    response = requests.get(url, params={
        "cftc_contract_market_code": spec["code"],
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": 52,
    }, timeout=15)
    if not response.ok:
        raise ValueError(f"CFTC HTTP {response.status_code} for {spec['symbol']}")
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"No CFTC rows for {spec['symbol']}")

    parsed = []
    for row in rows:
        if row.get("cftc_contract_market_code") != spec["code"]:
            continue
        if spec["match"] not in str(row.get("market_and_exchange_names", "")).upper():
            continue
        try:
            long_pos = int(float(row[long_field]))
            short_pos = int(float(row[short_field]))
            oi = int(float(row["open_interest_all"]))
        except (KeyError, TypeError, ValueError):
            continue
        if oi <= 0:
            continue
        net = long_pos - short_pos
        net_pct = 100.0 * net / oi
        total = long_pos + short_pos
        long_pct = (100.0 * long_pos / total) if total > 0 else 50.0
        parsed.append({
            "date": str(row.get("report_date_as_yyyy_mm_dd", ""))[:10],
            "long": long_pos,
            "short": short_pos,
            "oi": oi,
            "net": net,
            "netPct": round(net_pct, 1),
            "longPct": round(long_pct, 1),
            "shortPct": round(100.0 - long_pct, 1),
        })

    if not parsed:
        raise ValueError(f"No valid CFTC rows for {spec['symbol']}")

    latest = parsed[0]
    prev = parsed[1] if len(parsed) >= 2 else latest
    wow_contracts = latest["net"] - prev["net"]
    wow_pct = round(latest["netPct"] - prev["netPct"], 1)
    nets = [item["netPct"] for item in parsed]
    lo, hi = min(nets), max(nets)
    percentile = round(100.0 * (latest["netPct"] - lo) / (hi - lo)) if hi > lo else 50
    spark = _spark([item["netPct"] for item in reversed(parsed[:16])], limit=16)

    return {
        "id": spec["id"],
        "symbol": spec["symbol"],
        "name": spec["name"],
        "reportDate": latest["date"],
        "longPct": latest["longPct"],
        "shortPct": latest["shortPct"],
        "netPct": latest["netPct"],
        "netContracts": latest["net"],
        "wowContracts": wow_contracts,
        "wowPct": wow_pct,
        "percentile52w": int(_clamp(percentile, 0, 100)),
        "spark": spark,
        "group": "Asset Managers" if spec["feed"] == "fin" else "Managed Money",
    }


def refresh_cot_all(snapshot):
    """Refresh institutional COT positioning across all 6 tracked markets concurrently."""
    existing = {item.get("id"): item for item in snapshot.get("cotBoard", []) if isinstance(item, dict)}

    def _load(spec):
        try:
            return spec["id"], fetch_cot_market(spec), True
        except (requests.RequestException, ValueError, KeyError, IndexError) as error:
            print(f"Skipped COT {spec['symbol']} ({type(error).__name__}: {error})")
            return spec["id"], existing.get(spec["id"]), False

    board = []
    changed = False
    with ThreadPoolExecutor(max_workers=6) as pool:
        for _, entry, ok in pool.map(_load, COT_MARKETS):
            if entry:
                board.append(entry)
            if ok:
                changed = True

    if board:
        snapshot["cotBoard"] = board
        nq_cot = next((item for item in board if item["id"] == "nq"), None)
        if nq_cot:
            desk = snapshot.setdefault("swing", {})
            desk["metrics"] = update_row(desk.get("metrics", []), {
                "id": "cot",
                "value": f"{nq_cot['netPct']:+.1f}%",
                "numValue": nq_cot["netPct"],
                "spark": nq_cot["spark"],
                "detail": f"CFTC · Nasdaq-100 E-mini · {nq_cot['reportDate']} · {nq_cot['percentile52w']}th pct (52w) · WoW {nq_cot['wowContracts']:+,d}",
            })
    return changed


def update_row(rows, reading):
    return [row for row in rows if row.get("id") != reading["id"]] + [reading]


def refresh_fred(snapshot):
    changed = False
    raw = snapshot.setdefault("_raw", {})
    sources = {
        "DGS10": ("tickers", "dgs10", lambda v: f"{v:.2f}%"),
        "WALCL": ("swing", "fed", lambda v: f"${v / 1_000_000:.2f}T"),
        "CPILFESL": ("swing", "cpi", None),
        "T10Y2Y": ("intraday", "curve", None),
        "T10YIE": ("addons", "breakeven", lambda v: f"{v:.2f}%"),
        "DFII10": ("raw", "real10y", lambda v: f"{v:.2f}%"),
        "DGS2": ("raw", "dgs2", lambda v: f"{v:.2f}%"),
        "PCEPILFE": ("raw", "pce", None),
        "VIXCLS": ("raw", "vix_fred", lambda v: f"{v:.2f}"),
        "VXVCLS": ("raw", "vxv_fred", lambda v: f"{v:.2f}"),
        "WTREGEN": ("raw", "tga", None),
        "RRPONTSYD": ("raw", "rrp", None),
        "NFCI": ("raw", "nfci", lambda v: f"{v:+.2f}"),
        "UNRATE": ("raw", "unrate", lambda v: f"{v:.1f}%"),
        "ICSA": ("raw", "claims", lambda v: f"{v / 1000:.0f}K"),
        "DTWEXBGS": ("raw", "dxy_fred", lambda v: f"{v:.2f}"),
    }
    if os.getenv("MATRIX_DISABLE_ICE_SPREAD") != "1":
        sources["BAMLH0A0HYM2"] = ("swing", "credit", lambda v: f"{v * 100:.0f} bp")

    fetched_series = {}

    def _fetch_fred_one(series):
        try:
            return series, observations(series)
        except (requests.RequestException, ValueError, KeyError, IndexError) as error:
            print(f"Skipped {series} ({type(error).__name__})")
            return series, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for series, rows in pool.map(_fetch_fred_one, sources.keys()):
            if rows:
                fetched_series[series] = rows

    for series, (group, identifier, format_value) in sources.items():
        if series not in fetched_series:
            continue
        try:
            rows = fetched_series[series]
            date, latest = rows[0]
            detail = f"FRED · {series} · {date}"
            spark = _spark([v for _, v in reversed(rows[:20])], limit=20)
            num_value = latest

            if identifier in ("cpi", "pce"):
                target_ym = f"{int(date[:4]) - 1}{date[4:7]}"
                prior_year = next((value for day, value in rows if day[:7] == target_ym), None)
                if prior_year is None and len(rows) >= 13:
                    prior_year = rows[12][1]
                if prior_year is None or prior_year <= 0:
                    raise ValueError("Missing prior-year inflation observation")
                yoy = (latest / prior_year - 1) * 100
                num_value = round(yoy, 2)
                value = f"{yoy:.2f}%"
                prior_yoy = None
                if len(rows) > 13:
                    p_date, p_val = rows[1]
                    p_ym = f"{int(p_date[:4]) - 1}{p_date[4:7]}"
                    p_yr = next((v for d, v in rows if d[:7] == p_ym), rows[13][1] if len(rows) > 13 else None)
                    if p_yr and p_yr > 0:
                        prior_yoy = round((p_val / p_yr - 1) * 100, 2)
                raw[identifier] = {"value": num_value, "prev": prior_yoy, "date": date}
                if prior_yoy is not None:
                    diff = round(num_value - prior_yoy, 2)
                    trend_word = "Cooling" if diff < 0 else "Heating" if diff > 0 else "Flat"
                    detail = f"{detail} · {trend_word} ({diff:+.2f}% vs prior)"
            elif identifier == "curve":
                delta_bp = (latest - rows[1][1]) * 100 if len(rows) >= 2 else 0.0
                value = f"{delta_bp:+.0f} bp"
                raw["curve"] = {"level": round(latest, 3), "deltaBp": round(delta_bp, 1), "date": date, "spark": spark}
                detail = f"{detail} · Level {latest:+.2f}%"
            elif format_value is not None:
                value = format_value(latest)
                raw[identifier] = {
                    "value": round(latest, 4),
                    "prev": round(rows[1][1], 4) if len(rows) >= 2 else round(latest, 4),
                    "prev5": round(rows[5][1], 4) if len(rows) >= 6 else round(rows[-1][1], 4),
                    "date": date,
                    "spark": spark,
                }
            else:
                value = f"{latest:.2f}"
                raw[identifier] = {
                    "value": round(latest, 4),
                    "prev": round(rows[1][1], 4) if len(rows) >= 2 else round(latest, 4),
                    "date": date,
                    "spark": spark,
                }

            if group != "raw":
                reading = {"id": identifier, "value": value, "detail": detail, "numValue": round(num_value, 4), "spark": spark}
                if identifier == "dgs10" and len(rows) >= 2:
                    delta = round((latest - rows[1][1]) * 100)
                    reading.update(change=f"{delta:+d} bp", direction="up" if delta > 0 else "down" if delta < 0 else "flat")
                    raw["dgs10"] = {
                        "value": round(latest, 3),
                        "delta1dBp": delta,
                        "delta5dBp": round((latest - rows[5][1]) * 100) if len(rows) >= 6 else 0,
                        "date": date,
                        "spark": spark,
                    }
                if identifier == "credit" and len(rows) >= 2:
                    delta = round((latest - rows[1][1]) * 100)
                    reading.update(change=f"{delta:+d} bp", direction="up" if delta > 0 else "down" if delta < 0 else "flat")
                    raw["credit"] = {"bp": round(latest * 100), "deltaBp": delta, "date": date, "spark": spark}
                if identifier == "breakeven":
                    raw["breakeven"] = {"value": round(latest, 2), "date": date, "spark": spark}

                if group in ("swing", "intraday"):
                    desk = snapshot.setdefault(group, {})
                    desk["metrics"] = update_row(desk.get("metrics", []), reading)
                else:
                    snapshot[group] = update_row(snapshot.get(group, []), reading)

                if identifier == "dgs10" and len(rows) >= 6:
                    delta5 = (latest - rows[5][1]) * 100
                    desk = snapshot.setdefault("intraday", {})
                    desk["metrics"] = update_row(desk.get("metrics", []), {
                        "id": "yield",
                        "value": f"{delta5:+.0f} bp",
                        "numValue": round(delta5, 1),
                        "spark": spark,
                        "detail": f"{detail} · Five observation intervals",
                    })
            changed = True
        except (requests.RequestException, ValueError, KeyError, IndexError, StopIteration, ZeroDivisionError) as error:
            print(f"Skipped {series} ({type(error).__name__})")

    # Compute True Fed Net Liquidity = WALCL (M$) - WTREGEN (M$) - RRPONTSYD (B$ * 1000)
    if "WALCL" in fetched_series and "WTREGEN" in fetched_series and "RRPONTSYD" in fetched_series:
        walcl = fetched_series["WALCL"][0][1]          # millions
        tga = fetched_series["WTREGEN"][0][1]          # millions
        rrp = fetched_series["RRPONTSYD"][0][1] * 1000  # billions -> millions
        net_liq_t = (walcl - tga - rrp) / 1_000_000.0
        # 4-week comparison
        walcl_p = fetched_series["WALCL"][min(4, len(fetched_series["WALCL"]) - 1)][1]
        tga_p = fetched_series["WTREGEN"][min(4, len(fetched_series["WTREGEN"]) - 1)][1]
        rrp_p = fetched_series["RRPONTSYD"][min(4, len(fetched_series["RRPONTSYD"]) - 1)][1] * 1000
        prev_liq_t = (walcl_p - tga_p - rrp_p) / 1_000_000.0
        delta_b = round((net_liq_t - prev_liq_t) * 1000)
        # Approximate sparkline across WALCL observations
        liq_spark = _spark([
            round((w - tga - rrp) / 1_000_000.0, 3)
            for _, w in reversed(fetched_series["WALCL"][:16])
        ], limit=16)
        raw["netLiquidity"] = {"valueT": round(net_liq_t, 2), "delta4wB": delta_b, "spark": liq_spark}
        desk = snapshot.setdefault("swing", {})
        desk["metrics"] = update_row(desk.get("metrics", []), {
            "id": "fed",
            "value": f"${net_liq_t:.2f}T",
            "change": f"{delta_b:+d}B 4w",
            "direction": "up" if delta_b > 0 else "down" if delta_b < 0 else "flat",
            "numValue": round(net_liq_t, 2),
            "spark": liq_spark,
            "detail": f"Fed Net Liquidity (WALCL − TGA − RRP) · {fetched_series['WALCL'][0][0]} · {delta_b:+d}B vs 4w",
        })

    # Populate VIX impulse and VIX/VXV structure from FRED if live Yahoo hasn't filled them yet
    if "VIXCLS" in fetched_series and len(fetched_series["VIXCLS"]) >= 4:
        vix_rows = fetched_series["VIXCLS"]
        v_now, v_3d = vix_rows[0][1], vix_rows[3][1]
        v_imp = ((v_now / v_3d) - 1) * 100 if v_3d > 0 else 0.0
        v_spark = _spark([v for _, v in reversed(vix_rows[:20])], limit=20)
        raw["vix"] = {"value": round(v_now, 2), "impulse3d": round(v_imp, 1), "date": vix_rows[0][0], "spark": v_spark}
        desk = snapshot.setdefault("intraday", {})
        desk["metrics"] = update_row(desk.get("metrics", []), {
            "id": "impulse",
            "value": f"{v_imp:+.1f}%",
            "numValue": round(v_imp, 1),
            "spark": v_spark,
            "detail": f"FRED · VIXCLS · {vix_rows[0][0]} · Three-session change",
        })
        if not any(t.get("id") == "vix" for t in snapshot.get("tickers", [])):
            v_delta = v_now - vix_rows[1][1]
            snapshot["tickers"] = update_row(snapshot.get("tickers", []), {
                "id": "vix", "value": f"{v_now:.2f}",
                "change": f"{v_delta:+.2f} pts",
                "direction": "up" if v_delta > 0 else "down" if v_delta < 0 else "flat",
                "spark": v_spark,
                "detail": f"FRED · VIXCLS · {vix_rows[0][0]}",
            })

    if "VIXCLS" in fetched_series and "VXVCLS" in fetched_series:
        v_now = fetched_series["VIXCLS"][0][1]
        vxv_now = fetched_series["VXVCLS"][0][1]
        if vxv_now > 0:
            ratio = round(v_now / vxv_now, 2)
            raw["volStructure"] = {"ratio": ratio, "vix": round(v_now, 2), "vxv": round(vxv_now, 2)}
            state = "Contango (Calm)" if ratio < 0.95 else "Backwardation (Stress)" if ratio >= 1.0 else "Flat / Watch"
            snapshot["addons"] = update_row(snapshot.get("addons", []), {
                "id": "volatility",
                "value": f"{ratio:.2f}×",
                "numValue": ratio,
                "detail": f"{state} · VIX {v_now:.1f} / VXV {vxv_now:.1f}",
            })

    return changed


STOOQ_MAP = {
    "NQ=F": "nq.f",
    "ES=F": "es.f",
    "GC=F": "gc.f",
    "DX-Y.NYB": "dx.f",
    "EURUSD=X": "eurusd",
    "GBPUSD=X": "gbpusd",
    "^VIX": "^vix",
    "NVDA": "nvda.us",
    "AAPL": "aapl.us",
    "MSFT": "msft.us",
    "AMZN": "amzn.us",
    "META": "meta.us",
    "GOOGL": "googl.us",
    "TSLA": "tsla.us",
    "SMH": "smh.us",
}


def _stooq_chart(symbol, interval="1d"):
    stooq_sym = STOOQ_MAP.get(symbol)
    if not stooq_sym:
        raise ValueError(f"No Stooq mapping for {symbol}")
    stooq_int = "m" if interval == "1mo" else "d"
    response = requests.get(
        "https://stooq.com/q/d/l/",
        params={"s": stooq_sym, "i": stooq_int},
        headers=HTTP_HEADERS,
        timeout=10,
    )
    if not response.ok or "Date,Open,High,Low,Close" not in response.text[:120]:
        raise ValueError(f"Stooq unavailable for {symbol}")
    points = []
    for row in csv.DictReader(io.StringIO(response.text)):
        try:
            dt = datetime.strptime(row["Date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            close = float(row["Close"])
            if math.isfinite(close):
                points.append((int(dt.timestamp()), close))
        except (KeyError, ValueError, TypeError):
            continue
    if not points:
        raise ValueError(f"No Stooq points for {symbol}")
    limit = 125 if interval == "1mo" else 140
    points = points[-limit:]
    return {"regularMarketPrice": points[-1][1], "chartPreviousClose": points[-2][1] if len(points) >= 2 else points[-1][1]}, points


def _yahoo_chart(symbol, range_="3mo", interval="1d"):
    last_err = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            url = f"https://{host}/v8/finance/chart/{symbol}"
            response = requests.get(url, params={"range": range_, "interval": interval}, headers=HTTP_HEADERS, timeout=8)
            if not response.ok:
                last_err = ValueError(f"Yahoo HTTP {response.status_code} for {symbol}")
                continue
            payload = response.json()
            result = (payload.get("chart") or {}).get("result") or []
            if not result:
                last_err = ValueError(f"Empty Yahoo result for {symbol}")
                continue
            node = result[0]
            meta = node.get("meta") or {}
            timestamps = node.get("timestamp") or []
            closes = ((node.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
            points = []
            for ts, close in zip(timestamps, closes):
                if close is not None and math.isfinite(float(close)):
                    points.append((int(ts), float(close)))
            if points:
                return meta, points
        except (requests.RequestException, ValueError, KeyError, TypeError) as err:
            last_err = err
    try:
        return _stooq_chart(symbol, interval=interval)
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raise last_err or ValueError(f"No market data for {symbol}")


def refresh_markets(snapshot):
    """Fetch live quotes, moving-average trends, Mag 7 breadth, VIX structure, Fear & Greed, and 10Y seasonality concurrently."""
    changed = False
    raw = snapshot.setdefault("_raw", {})
    market_quotes = snapshot.setdefault("markets", {})
    now_date = datetime.now(NY).strftime("%Y-%m-%d %H:%M ET")

    def _load_market(item):
        key, (yahoo_sym, label, name, decimals) = item
        try:
            meta, points = _yahoo_chart(yahoo_sym, range_="6mo", interval="1d")
            return key, label, name, decimals, meta, points
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            print(f"Skipped market {yahoo_sym} ({type(error).__name__})")
            return key, label, name, decimals, None, None

    def _load_mag7(item):
        sym, company = item
        try:
            meta, points = _yahoo_chart(sym, range_="1mo", interval="1d")
            closes = [p[1] for p in points]
            latest = float(meta.get("regularMarketPrice") or closes[-1])
            prev_close = closes[-2] if len(closes) >= 2 else float(meta.get("chartPreviousClose") or latest)
            chg_pct = ((latest / prev_close) - 1) * 100 if prev_close else 0.0
            return {
                "symbol": sym,
                "name": company,
                "price": _fmt_price(latest, 2),
                "changePct": round(chg_pct, 2),
                "change": f"{chg_pct:+.2f}%",
                "direction": "up" if chg_pct > 0.05 else "down" if chg_pct < -0.05 else "flat",
            }
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            print(f"Skipped breadth {sym} ({type(error).__name__})")
            return None

    current_month = datetime.now(NY).month
    month_label = datetime.now(NY).strftime("%B")

    def _load_seasonality(key):
        yahoo_sym, label, _, _ = MARKET_SYMBOLS[key]
        try:
            _, points = _yahoo_chart(yahoo_sym, range_="10y", interval="1mo")
            by_month = {m: [] for m in range(1, 13)}
            for i in range(1, len(points)):
                ts, close = points[i]
                prev = points[i - 1][1]
                if prev <= 0:
                    continue
                ret = ((close / prev) - 1) * 100
                m = datetime.fromtimestamp(ts, tz=timezone.utc).month
                by_month[m].append(ret)
            cur = by_month.get(current_month, [])
            if not cur:
                return key, None
            wins = sum(1 for r in cur if r > 0)
            return key, {
                "id": key,
                "symbol": label,
                "month": month_label,
                "winRate": round(100 * wins / len(cur)),
                "avgReturn": round(sum(cur) / len(cur), 2),
                "samples": len(cur),
                "monthlyAvg": [
                    round(sum(by_month[m]) / len(by_month[m]), 2) if by_month[m] else 0.0
                    for m in range(1, 13)
                ],
            }
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            print(f"Skipped seasonality {yahoo_sym} ({type(error).__name__})")
            return key, None

    def _load_fear_greed():
        try:
            fg = requests.get(
                "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                headers=HTTP_HEADERS,
                timeout=6,
            )
            if fg.ok:
                fg_data = fg.json().get("fear_and_greed") or {}
                score = round(float(fg_data.get("score")))
                rating = str(fg_data.get("rating") or "").title() or "Neutral"
                return score, rating
        except (requests.RequestException, ValueError, KeyError, TypeError):
            pass
        return None

    with ThreadPoolExecutor(max_workers=10) as pool:
        mkt_futures = [pool.submit(_load_market, item) for item in MARKET_SYMBOLS.items()]
        mag7_futures = [pool.submit(_load_mag7, item) for item in MAG7_SYMBOLS]
        seas_futures = [pool.submit(_load_seasonality, key) for key in ("nq", "es", "xau", "dxy", "eurusd", "gbpusd")]
        fg_future = pool.submit(_load_fear_greed)

        for fut in mkt_futures:
            key, label, name, decimals, meta, points = fut.result()
            if not points:
                continue
            closes = [p[1] for p in points]
            latest = float(meta.get("regularMarketPrice") or closes[-1])
            prev_close = closes[-2] if len(closes) >= 2 else float(meta.get("chartPreviousClose") or latest)
            chg_pct = ((latest / prev_close) - 1) * 100 if prev_close else 0.0
            chg_pts = latest - prev_close
            sma20 = sum(closes[-20:]) / min(len(closes), 20)
            sma50 = sum(closes[-50:]) / min(len(closes), 50)
            trend = "bullish" if latest > sma20 and sma20 >= sma50 else "bearish" if latest < sma20 and sma20 <= sma50 else "mixed"
            spark = _spark(closes[-20:], limit=20)

            entry = {
                "id": key,
                "symbol": label,
                "name": name,
                "price": round(latest, decimals),
                "displayPrice": _fmt_price(latest, decimals),
                "changePct": round(chg_pct, 2),
                "change": f"{chg_pts:+.2f} pts" if key == "vix" else f"{chg_pct:+.2f}%",
                "direction": "up" if chg_pct > 0.02 else "down" if chg_pct < -0.02 else "flat",
                "sma20": round(sma20, decimals),
                "sma50": round(sma50, decimals),
                "trend": trend,
                "spark": spark,
                "detail": f"Market quote · {now_date}",
            }
            market_quotes[key] = entry

            if key in ("nq", "es", "xau", "vix", "dxy"):
                snapshot["tickers"] = update_row(snapshot.get("tickers", []), {
                    "id": key,
                    "value": entry["displayPrice"],
                    "change": entry["change"],
                    "direction": entry["direction"],
                    "spark": spark,
                    "detail": name,
                })

            if key == "vix" and len(closes) >= 4:
                v_imp = ((latest / closes[-4]) - 1) * 100 if closes[-4] > 0 else 0.0
                raw["vix"] = {"value": round(latest, 2), "impulse3d": round(v_imp, 1), "date": now_date, "spark": spark}
                desk = snapshot.setdefault("intraday", {})
                desk["metrics"] = update_row(desk.get("metrics", []), {
                    "id": "impulse",
                    "value": f"{v_imp:+.1f}%",
                    "numValue": round(v_imp, 1),
                    "spark": spark,
                    "detail": f"VIX 3-session change · {now_date}",
                })
            changed = True

        mag7_rows = [row for fut in mag7_futures if (row := fut.result()) is not None]
        seasonality = {}
        for fut in seas_futures:
            key, val = fut.result()
            if val:
                seasonality[key] = val
                changed = True
        fg_res = fg_future.result()

    # VIX / VIX3M structure from live quotes
    if "vix" in market_quotes and "vxv" in market_quotes and market_quotes["vxv"]["price"] > 0:
        v_now = market_quotes["vix"]["price"]
        vxv_now = market_quotes["vxv"]["price"]
        ratio = round(v_now / vxv_now, 2)
        raw["volStructure"] = {"ratio": ratio, "vix": v_now, "vxv": vxv_now}
        state = "Contango (Calm)" if ratio < 0.95 else "Backwardation (Stress)" if ratio >= 1.0 else "Flat / Watch"
        snapshot["addons"] = update_row(snapshot.get("addons", []), {
            "id": "volatility",
            "value": f"{ratio:.2f}×",
            "numValue": ratio,
            "detail": f"{state} · VIX {v_now:.1f} / VIX3M {vxv_now:.1f}",
        })

    if mag7_rows:
        core7 = [r for r in mag7_rows if r["symbol"] != "SMH"]
        green_count = sum(1 for r in core7 if r["changePct"] > 0)
        avg_pct = sum(r["changePct"] for r in core7) / len(core7) if core7 else 0.0
        snapshot["mag7"] = {
            "items": mag7_rows,
            "greenCount": green_count,
            "total": len(core7),
            "avgChangePct": round(avg_pct, 2),
            "label": (
                "Strong Tech Tailwind" if green_count >= 6 else
                "Constructive Breadth" if green_count >= 4 else
                "Tech Headwind" if green_count <= 2 else "Mixed Breadth"
            ),
        }
        snapshot["tickers"] = update_row(snapshot.get("tickers", []), {
            "id": "mag7",
            "value": f"{green_count}/{len(core7)} Green",
            "change": f"{avg_pct:+.2f}%",
            "direction": "up" if avg_pct > 0.05 else "down" if avg_pct < -0.05 else "flat",
            "detail": "Mag 7 equal-weight breadth",
        })
        changed = True

    if seasonality:
        snapshot["seasonality"] = {"month": month_label, "monthIndex": current_month, "assets": seasonality}

    if fg_res:
        score, rating = fg_res
        raw["fearGreed"] = {"score": score, "rating": rating, "source": "CNN Fear & Greed"}
        snapshot["addons"] = update_row(snapshot.get("addons", []), {
            "id": "sentiment",
            "value": f"{score} / 100",
            "numValue": score,
            "detail": f"{rating} · CNN Fear & Greed",
        })
        changed = True

    return changed


def _parse_num(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace("%", "").replace(",", "").replace("K", "").replace("M", "").strip())
    except ValueError:
        return None


def _tag_calendar_event(row):
    title = str(row.get("event") or row.get("name") or "").strip()
    actual_n = _parse_num(row.get("actual"))
    est_n = _parse_num(row.get("estimate"))
    surprise = None
    nq_impact = "watch"
    if actual_n is not None and est_n is not None:
        diff = actual_n - est_n
        tol = max(0.05, abs(est_n) * 0.02)
        if abs(diff) <= tol:
            surprise = "inline"
            nq_impact = "neutral"
        elif diff > 0:
            surprise = "beat"
            if HAWKISH_IF_HOT.search(title):
                nq_impact = "bearish"
            elif DOVISH_IF_HOT.search(title):
                nq_impact = "bullish"
        else:
            surprise = "miss"
            if HAWKISH_IF_HOT.search(title):
                nq_impact = "bullish"
            elif DOVISH_IF_HOT.search(title):
                nq_impact = "bearish"
    return {
        "date": row.get("date") or row.get("scheduled_at") or "",
        "event": title,
        "actual": row.get("actual"),
        "estimate": row.get("estimate"),
        "unit": row.get("unit") or "",
        "tier1": bool(TIER1_NEWS.search(title)),
        "surprise": surprise,
        "nqImpact": nq_impact,
        "source": row.get("source") or "FMP",
    }


def economic_calendar():
    """Fetch upcoming US high-impact releases (FMP primary, official BLS/BEA/Fed fallback)."""
    fmp_key = os.environ.get("MATRIX_FMP_API_KEY", "").strip()
    if fmp_key:
        today = datetime.now(timezone.utc).date()
        response = requests.get("https://financialmodelingprep.com/stable/economic-calendar", params={
            "country": "US", "from": (today - timedelta(days=1)).isoformat(),
            "to": (today + timedelta(days=14)).isoformat(), "apikey": fmp_key,
        }, timeout=12)
        if response.ok:
            rows = response.json()
            if isinstance(rows, list):
                filtered = [
                    _tag_calendar_event({**row, "source": "FMP"})
                    for row in sorted(rows, key=lambda r: r.get("date") or "")
                    if row.get("country") == "US"
                    and (row.get("impact", "").lower() == "high" or MARKET_MOVER_NEWS.search(str(row.get("event", ""))))
                    and row.get("date") and row.get("event")
                ]
                if filtered:
                    return filtered[:40]
        elif not os.getenv("MATRIX_ALLOW_OFFICIAL_FALLBACK", "1") == "1":
            raise SystemExit(f"FMP calendar returned HTTP {response.status_code}")

    # Free official BLS + BEA + Federal Reserve schedule fallback
    try:
        from webapp.economic_calendar import monthly_schedule
        today_ny = datetime.now(NY).date()
        schedule = monthly_schedule(today_ny)
        events = [
            _tag_calendar_event({
                "date": ev.get("scheduled_at", ""),
                "event": ev.get("name", ""),
                "source": ev.get("source", "Official"),
            })
            for ev in schedule.get("events", [])
            if MARKET_MOVER_NEWS.search(str(ev.get("name", "")))
        ]
        return events[:40]
    except Exception:
        return []


def _bias_label(score):
    if score >= 70:
        return "Strong Bullish"
    if score >= 57:
        return "Bullish"
    if score <= 30:
        return "Strong Bearish"
    if score <= 43:
        return "Bearish"
    return "Neutral"


def _hydrate_raw_from_existing(snapshot, raw):
    """Populate missing _raw fields from already-stored ticker/desk/addon metrics (e.g. when FRED ran in CI)."""
    def _find(rows, item_id):
        return next((r for r in (rows or []) if isinstance(r, dict) and r.get("id") == item_id), None)

    if "dgs10" not in raw:
        t = _find(snapshot.get("tickers"), "dgs10")
        y = _find((snapshot.get("intraday") or {}).get("metrics"), "yield")
        val = _parse_num(t.get("value")) if t else None
        d5 = _parse_num((y or {}).get("value", "").replace("bp", "")) if y else None
        if val is not None or d5 is not None:
            raw["dgs10"] = {"value": val, "delta5dBp": round(d5) if d5 is not None else 0}
    if "cpi" not in raw:
        c = _find((snapshot.get("swing") or {}).get("metrics"), "cpi")
        val = _parse_num(c.get("value")) if c else None
        if val is not None:
            raw["cpi"] = {"value": val}
    if "breakeven" not in raw:
        b = _find(snapshot.get("addons"), "breakeven")
        val = _parse_num(b.get("value")) if b else None
        if val is not None:
            raw["breakeven"] = {"value": val}
    if "credit" not in raw:
        cr = _find((snapshot.get("swing") or {}).get("metrics"), "credit")
        val = _parse_num((cr or {}).get("value", "").replace("bp", "")) if cr else None
        if val is not None:
            raw["credit"] = {"bp": round(val)}
    if "netLiquidity" not in raw:
        f = _find((snapshot.get("swing") or {}).get("metrics"), "fed")
        val = _parse_num((f or {}).get("value", "").replace("$", "").replace("T", "")) if f else None
        if val is not None:
            raw["netLiquidity"] = {"valueT": val, "delta4wB": 0}


def recompute_scores(snapshot):
    """Compute transparent EdgeFinder multi-asset scores (6 markets) and dynamic NQ intraday sizing gate."""
    raw = dict(snapshot.get("_raw") or {})
    _hydrate_raw_from_existing(snapshot, raw)
    markets = snapshot.get("markets") or {}
    cot_by_id = {c["id"]: c for c in snapshot.get("cotBoard", []) if isinstance(c, dict) and c.get("id")}
    seasonality = (snapshot.get("seasonality") or {}).get("assets") or {}
    mag7 = snapshot.get("mag7") or {}

    # Shared macro readings
    dgs10 = raw.get("dgs10") or {}
    real10y = raw.get("real10y") or {}
    cpi = raw.get("cpi") or {}
    pce = raw.get("pce") or {}
    breakeven = raw.get("breakeven") or {}
    net_liq = raw.get("netLiquidity") or {}
    credit = raw.get("credit") or {}
    nfci = raw.get("nfci") or {}
    vix = raw.get("vix") or {}
    vol_struct = raw.get("volStructure") or {}

    # Compute Risk-On composite Fear & Greed if CNN wasn't fetched
    if not any(a.get("id") == "sentiment" for a in snapshot.get("addons", [])):
        fg_score = 50
        v_val = vix.get("value")
        if v_val is not None:
            fg_score += 18 if v_val < 15 else 8 if v_val < 19 else -12 if v_val > 25 else -5 if v_val > 21 else 0
        if vol_struct.get("ratio") is not None:
            fg_score += 8 if vol_struct["ratio"] < 0.93 else -14 if vol_struct["ratio"] >= 1.0 else 0
        if mag7.get("total"):
            fg_score += round((mag7["greenCount"] / mag7["total"] - 0.5) * 24)
        if credit.get("bp") is not None:
            fg_score += 8 if credit["bp"] < 340 else -12 if credit["bp"] > 450 else 0
        fg_score = int(_clamp(round(fg_score), 5, 95))
        fg_label = (
            "Extreme Greed" if fg_score >= 75 else "Greed" if fg_score >= 58 else
            "Extreme Fear" if fg_score <= 25 else "Fear" if fg_score <= 42 else "Neutral"
        )
        snapshot["addons"] = update_row(snapshot.get("addons", []), {
            "id": "sentiment",
            "value": f"{fg_score} / 100",
            "numValue": fg_score,
            "detail": f"{fg_label} · Composite Risk Meter",
        })

    # Macro pillar helper scores (-2..+2) from a RISK-ON / NQ perspective
    # 1) Rates & Real Yields
    rates_score = 0
    rates_parts = []
    if dgs10.get("delta5dBp") is not None:
        d5 = dgs10["delta5dBp"]
        rates_score += 1 if d5 <= -6 else -1 if d5 >= 6 else 0
        rates_parts.append(f"10Y 5d {d5:+d}bp")
    if real10y.get("value") is not None:
        r_now = real10y["value"]
        r_prev5 = real10y.get("prev5", r_now)
        r_diff = round((r_now - r_prev5) * 100)
        rates_score += 1 if r_diff <= -5 else -1 if r_diff >= 5 else 0
        rates_parts.append(f"Real 10Y {r_now:.2f}%")
    rates_score = int(_clamp(rates_score, -2, 2))
    rates_reading = " · ".join(rates_parts) if rates_parts else "Pending"

    # 2) Inflation & Fed Policy
    infl_score = 0
    infl_parts = []
    if cpi.get("value") is not None:
        infl_parts.append(f"Core CPI {cpi['value']:.2f}%")
        if cpi.get("prev") is not None:
            infl_score += 1 if cpi["value"] < cpi["prev"] else -1 if cpi["value"] > cpi["prev"] else 0
        else:
            infl_score += 1 if cpi["value"] <= 2.6 else -1 if cpi["value"] >= 3.2 else 0
    if pce.get("value") is not None:
        infl_parts.append(f"Core PCE {pce['value']:.2f}%")
        if pce.get("prev") is not None:
            infl_score += 1 if pce["value"] < pce["prev"] else -1 if pce["value"] > pce["prev"] else 0
    elif breakeven.get("value") is not None:
        infl_parts.append(f"10Y BE {breakeven['value']:.2f}%")
        infl_score += 1 if breakeven["value"] <= 2.30 else -1 if breakeven["value"] >= 2.55 else 0
    infl_score = int(_clamp(infl_score, -2, 2))
    infl_reading = " · ".join(infl_parts) if infl_parts else "Pending"

    # 3) Liquidity & Credit
    liq_score = 0
    liq_parts = []
    if net_liq.get("valueT") is not None:
        d4 = net_liq.get("delta4wB", 0)
        liq_score += 1 if d4 > 25 else -1 if d4 < -25 else 0
        liq_parts.append(f"Net Liq ${net_liq['valueT']:.2f}T ({d4:+d}B)")
    if credit.get("bp") is not None:
        bp = credit["bp"]
        liq_score += 1 if bp < 350 else -1 if bp > 430 else 0
        liq_parts.append(f"HY {bp}bp")
    elif nfci.get("value") is not None:
        liq_score += 1 if nfci["value"] < -0.2 else -1 if nfci["value"] > 0.1 else 0
        liq_parts.append(f"NFCI {nfci['value']:+.2f}")
    liq_score = int(_clamp(liq_score, -2, 2))
    liq_reading = " · ".join(liq_parts) if liq_parts else "Pending"

    # 4) Volatility & Risk Appetite
    vol_score = 0
    vol_parts = []
    v_val = vix.get("value")
    if v_val is not None:
        vol_score += 1 if v_val < 18 else -1 if v_val >= 22 else 0
        vol_parts.append(f"VIX {v_val:.1f}")
    if vol_struct.get("ratio") is not None:
        rt = vol_struct["ratio"]
        vol_score += 1 if rt < 0.95 else -1 if rt >= 1.0 else 0
        vol_parts.append(f"VIX/3M {rt:.2f}×")
    if mag7.get("total"):
        vol_parts.append(f"Mag7 {mag7['greenCount']}/{mag7['total']}")
    vol_score = int(_clamp(vol_score, -2, 2))
    vol_reading = " · ".join(vol_parts) if vol_parts else "Pending"

    # Build scored roster across all 6 markets
    asset_specs = (
        ("nq", "NQ", "Nasdaq-100 Futures", "Index", 1, 1, 1, 1),
        ("es", "ES", "S&P 500 Futures", "Index", 1, 1, 1, 1),
        ("xau", "XAU", "Gold Futures (XAUUSD)", "Metals", 1, 0, 1, 0),
        ("dxy", "DXY", "US Dollar Index", "FX", -1, -1, -1, -1),
        ("eurusd", "EURUSD", "Euro / US Dollar", "FX", 1, 1, 1, 1),
        ("gbpusd", "GBPUSD", "British Pound / USD", "FX", 1, 1, 1, 1),
    )

    assets = []
    for key, sym, name, category, r_sign, i_sign, l_sign, v_sign in asset_specs:
        cot = cot_by_id.get(key)
        mkt = markets.get(key)
        seas = seasonality.get(key)

        # Pillar 1: COT Positioning (-2..+2)
        cot_score = 0
        cot_read = "Pending"
        cot_note = "Awaiting weekly CFTC report"
        if cot:
            pct = cot["netPct"]
            wow = cot["wowPct"]
            cot_score = (1 if pct > 5 else -1 if pct < -5 else 0) + (1 if wow >= 1.0 else -1 if wow <= -1.0 else 0)
            cot_score = int(_clamp(cot_score, -2, 2))
            cot_read = f"{pct:+.1f}% ({cot['percentile52w']}th pct)"
            cot_note = f"{cot['group']} · {cot['longPct']:.0f}%L / {cot['shortPct']:.0f}%S · WoW {cot['wowContracts']:+,d}"

        # Pillar 2: Rates & Real Yields
        p_rates = int(_clamp(rates_score * r_sign, -2, 2))
        rates_note = (
            "Rising yields support USD" if key == "dxy" and p_rates > 0 else
            "Falling real yields tailwind" if p_rates > 0 else
            "Yield pressure headwind" if p_rates < 0 else "Neutral rate regime"
        )

        # Pillar 3: Inflation & Fed
        if key == "xau":
            # Gold likes cooling real rates / sticky inflation hedge or dovish Fed
            p_infl = 1 if (breakeven.get("value") or 0) >= 2.3 else infl_score
            p_infl = int(_clamp(p_infl, -2, 2))
            infl_note = "Inflation hedge / dovish tailwind" if p_infl > 0 else "Disinflation pressure" if p_infl < 0 else "Balanced inflation"
        else:
            p_infl = int(_clamp(infl_score * i_sign, -2, 2))
            infl_note = (
                "Hotter inflation supports hawkish USD" if key == "dxy" and p_infl > 0 else
                "Cooling inflation supports risk" if p_infl > 0 else
                "Sticky inflation hawkish headwind" if p_infl < 0 else "Balanced inflation"
            )

        # Pillar 4: Liquidity & Credit
        p_liq = int(_clamp(liq_score * l_sign, -2, 2))
        liq_note = "Expanding liquidity / tight credit" if p_liq > 0 else "Tightening liquidity" if p_liq < 0 else "Neutral liquidity"

        # Pillar 5: Volatility & Risk Regime
        if key == "xau":
            # Gold benefits from elevated VIX / defensive demand
            p_vol = 1 if (v_val is not None and v_val >= 20) else 0
            vol_note = "Safe-haven demand active" if p_vol > 0 else "Calm risk environment"
        else:
            p_vol = int(_clamp(vol_score * v_sign, -2, 2))
            if key == "nq" and mag7.get("total"):
                if mag7["greenCount"] >= 6:
                    p_vol = int(_clamp(p_vol + 1, -2, 2))
                elif mag7["greenCount"] <= 1:
                    p_vol = int(_clamp(p_vol - 1, -2, 2))
            vol_note = (
                "Risk-off bid for USD" if key == "dxy" and p_vol > 0 else
                "Low vol / contango tailwind" if p_vol > 0 else
                "Elevated vol / defensive tape" if p_vol < 0 else "Balanced volatility"
            )

        # Pillar 6: Price Trend & Historical Seasonality
        p_trend = 0
        trend_parts = []
        if mkt:
            p_trend += 1 if mkt["trend"] == "bullish" else -1 if mkt["trend"] == "bearish" else 0
            trend_parts.append(f"Trend {mkt['trend'].title()}")
        if seas:
            p_trend += 1 if seas["winRate"] >= 65 else -1 if seas["winRate"] <= 35 else 0
            trend_parts.append(f"{seas['month'][:3]} {seas['winRate']}% green ({seas['avgReturn']:+.1f}%)")
        p_trend = int(_clamp(p_trend, -2, 2))
        trend_read = " · ".join(trend_parts) if trend_parts else "Pending"
        trend_note = "Trend & seasonality aligned" if p_trend >= 2 else "Bearish trend/seasonality" if p_trend <= -2 else "Mixed technical/seasonal"

        pillars = [
            {"id": "cot", "label": "COT Institutional", "score": cot_score, "max": 2, "reading": cot_read, "summary": cot_note},
            {"id": "rates", "label": "Rates & Real Yields", "score": p_rates, "max": 2, "reading": rates_reading, "summary": rates_note},
            {"id": "inflation", "label": "Inflation & Fed", "score": p_infl, "max": 2, "reading": infl_reading, "summary": infl_note},
            {"id": "liquidity", "label": "Liquidity & Credit", "score": p_liq, "max": 2, "reading": liq_reading, "summary": liq_note},
            {"id": "volatility", "label": "Volatility & Risk", "score": p_vol, "max": 2, "reading": vol_reading, "summary": vol_note},
            {"id": "trend", "label": "Trend & Seasonality", "score": p_trend, "max": 2, "reading": trend_read, "summary": trend_note},
        ]
        raw_total = sum(p["score"] for p in pillars)  # -12 .. +12
        score_100 = int(_clamp(round(50 + raw_total * (50 / 12)), 0, 100))

        assets.append({
            "id": key,
            "symbol": sym,
            "name": name,
            "category": category,
            "price": mkt["displayPrice"] if mkt else "—",
            "change": mkt["change"] if mkt else "",
            "direction": mkt["direction"] if mkt else "flat",
            "trend": mkt["trend"] if mkt else "mixed",
            "spark": mkt["spark"] if mkt else [],
            "cotNet": f"{cot['netPct']:+.1f}%" if cot else "—",
            "seasonality": f"{seas['winRate']}% ({seas['avgReturn']:+.1f}%)" if seas else "—",
            "rawScore": raw_total,
            "score": score_100,
            "bias": _bias_label(score_100),
            "pillars": pillars,
        })

    snapshot["assets"] = assets

    # Sync NQ score into Swing Desk scorecard (backward-compatible)
    nq_asset = next((a for a in assets if a["id"] == "nq"), None)
    if nq_asset:
        swing = snapshot.setdefault("swing", {})
        swing["score"] = nq_asset["score"]
        swing["bias"] = nq_asset["bias"]

    # Dynamic Intraday NQ/MNQ Session Playbook & Sizing Gate
    today_ny = datetime.now(NY).date().isoformat()
    today_events = [
        ev for ev in (snapshot.get("calendar") or [])
        if str(ev.get("date", "")).startswith(today_ny) and MARKET_MOVER_NEWS.search(str(ev.get("event", "")))
    ]
    has_tier1_today = any(TIER1_NEWS.search(str(ev.get("event", ""))) for ev in today_events)

    reasons = []
    sizing = "standard"
    if has_tier1_today:
        sizing = "paused"
        names = ", ".join(ev.get("event", "") for ev in today_events if TIER1_NEWS.search(str(ev.get("event", ""))))[:80]
        reasons.append(f"Tier-1 US catalyst today ({names}) — avoid entries around release window")
    elif today_events:
        sizing = "micro"
        reasons.append(f"High-impact US release today ({today_events[0].get('event')}) — size down into print")

    if v_val is not None and v_val >= 30:
        sizing = "paused"
        reasons.append(f"VIX at extreme stress ({v_val:.1f} ≥ 30)")
    elif v_val is not None and v_val >= 22:
        if sizing == "standard":
            sizing = "micro"
        reasons.append(f"Elevated volatility regime (VIX {v_val:.1f} ≥ 22)")

    if vol_struct.get("ratio") is not None and vol_struct["ratio"] >= 1.0:
        if sizing == "standard":
            sizing = "micro"
        reasons.append(f"VIX backwardation ({vol_struct['ratio']:.2f}× ≥ 1.0) — headline risk elevated")

    if vix.get("impulse3d") is not None and vix["impulse3d"] >= 12:
        if sizing == "standard":
            sizing = "micro"
        reasons.append(f"VIX 3-day spike ({vix['impulse3d']:+.1f}%)")

    if dgs10.get("delta5dBp") is not None and abs(dgs10["delta5dBp"]) >= 15:
        if sizing == "standard":
            sizing = "micro"
        reasons.append(f"10Y Yield 5-day shock ({dgs10['delta5dBp']:+d} bp)")

    if not reasons:
        reasons.append("Clean macro & volatility tape — standard NQ/MNQ execution rules apply")

    # Implied daily move on NQ from VIX / sqrt(252)
    implied_move = None
    nq_price = (markets.get("nq") or {}).get("price")
    if v_val is not None and v_val > 0:
        daily_pct = round(v_val / math.sqrt(252), 2)
        pts = round(nq_price * daily_pct / 100) if nq_price else None
        implied_move = {
            "vix": round(v_val, 2),
            "dailyPct": daily_pct,
            "nqPoints": pts,
            "label": f"±{daily_pct:.2f}%" + (f" (~{pts} pts on NQ)" if pts else ""),
        }

    intraday = snapshot.setdefault("intraday", {})
    intraday["sizing"] = sizing
    intraday["reasons"] = reasons
    if implied_move:
        intraday["impliedMove"] = implied_move


def refresh_snapshot(snapshot, source="all"):
    """Run one or all refresh stages against a snapshot dict and recompute all scores."""
    changed = False
    if source in ("all", "fred"):
        changed = refresh_fred(snapshot) or changed
    if source in ("all", "cot"):
        changed = refresh_cot_all(snapshot) or changed
    if source in ("all", "markets"):
        changed = refresh_markets(snapshot) or changed
    if source in ("all", "calendar"):
        cal = economic_calendar()
        if cal:
            snapshot["calendar"] = cal
            snapshot["calendarAsOf"] = datetime.now(timezone.utc).isoformat()
            changed = True
    if changed:
        recompute_scores(snapshot)
        snapshot["asOf"] = datetime.now(timezone.utc).isoformat()
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", choices=("all", "fred", "cot", "markets", "calendar"))
    source = parser.parse_args().source
    database_url = os.getenv("MATRIX_DB_URL")
    if database_url:
        import psycopg
        connection = psycopg.connect(database_url.replace("postgresql+psycopg://", "postgresql://"), connect_timeout=15)
        connection.execute("SELECT pg_advisory_xact_lock(748291)")
        row = connection.execute("SELECT snapshot FROM public.macro_scorecard WHERE id='matrix'").fetchone()
        snapshot = row[0] if row else {}
    else:
        connection = None
        snapshot = None
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

    changed = refresh_snapshot(snapshot, source=source)
    if not changed:
        raise SystemExit("No observations refreshed. Previous snapshot retained.")

    if connection:
        from psycopg.types.json import Jsonb
        try:
            connection.execute(
                "INSERT INTO public.macro_scorecard(id,snapshot) VALUES ('matrix',%s) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
                (Jsonb(snapshot),),
            )
            connection.commit()
        finally:
            connection.close()
        return
    response = requests.post(
        url,
        headers={**headers, "Prefer": "resolution=merge-duplicates"},
        json={"id": "matrix", "snapshot": snapshot},
        timeout=15,
    )
    response.raise_for_status()


if __name__ == "__main__":
    main()
