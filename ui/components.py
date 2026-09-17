"""Reusable page pieces. Everything renders through st.markdown with the CSS in ui/style.py,
so the whole app shares one visual language."""
from __future__ import annotations

import html
from typing import Iterable, Optional

import numpy as np
import pandas as pd
import streamlit as st

from core.charts import fmt_money, fmt_pct, fmt_r, fmt_ratio  # noqa: F401  (re-exported)


def _esc(s) -> str:
    return html.escape("" if s is None else str(s))


def page_header(title: str, subtitle: str = "", meta: str = "") -> None:
    st.markdown(
        f'<div class="tl-page"><div><div class="title">{_esc(title)}</div>'
        f'<div class="sub">{_esc(subtitle)}</div></div>'
        f'<div class="meta">{_esc(meta)}</div></div>', unsafe_allow_html=True)


def section(title: str, caption: str = "") -> None:
    st.markdown(f'<div class="tl-section"><div class="h">{_esc(title)}</div>'
                f'<div class="c">{_esc(caption)}</div></div>', unsafe_allow_html=True)


def progress(pct: float, state: str = "green", label: str = "", caption: str = "") -> None:
    """A pure-CSS progress bar (no chart library): pct 0-100, state colours the fill."""
    color = {"green": "var(--tl-good)", "amber": "var(--tl-warn)", "red": "var(--tl-serious)", "breached": "var(--tl-bad)",
             "info": "var(--tl-accent)"}.get(state, "var(--tl-accent)")
    w = max(0.0, min(100.0, float(pct)))
    st.markdown(f'<div class="tl-prog"><div class="tl-prog-head"><span>{_esc(label)}</span><span>{w:.0f}%</span></div>'
                f'<div class="tl-prog-track"><div class="tl-prog-fill" style="width:{w:.1f}%;background:{color}"></div></div>'
                f'{f"<div class=tl-prog-cap>{_esc(caption)}</div>" if caption else ""}</div>', unsafe_allow_html=True)


def with_pct(df: pd.DataFrame, starting_balance: float) -> pd.DataFrame:
    """Add pct (fraction of starting balance) for P&L columns present."""
    d = df.copy()
    if starting_balance and "net_pnl" in d:
        d["pct"] = d["net_pnl"].astype(float) / float(starting_balance)
    return d


TRADE_LIST_COLS = ["exit_time", "symbol", "direction", "qty", "net_pnl", "pct", "r_multiple", "setup_name", "session", "rules_followed"]
TRADE_LIST_LABELS = {"exit_time": "Closed", "symbol": "Symbol", "direction": "Side", "qty": "Qty", "net_pnl": "P&L",
                     "pct": "P&L %", "r_multiple": "R", "setup_name": "Model", "session": "Session", "rules_followed": "Rules",
                     "entry_time": "Opened"}


def hero(eyebrow: str, number: str, line_html: str = "", facts: Optional[list[dict]] = None, tone: str = "",
         glow: Optional[str] = None) -> None:
    """The one big number. facts: [{k, v, tone?}, ...]. tone: 'pos' | 'neg' | ''."""
    glow_css = f' style="--tl-glow:{glow}"' if glow else ""
    fx = "".join(f'<div class="fact"><div class="k">{_esc(f["k"])}</div><div class="v {f.get("tone", "")}">{_esc(f["v"])}</div></div>'
                 for f in (facts or []))
    st.markdown(f'<div class="tl-hero"{glow_css}><div class="eyebrow">{_esc(eyebrow)}</div>'
                f'<div class="number {tone}">{_esc(number)}</div>'
                f'{f"<div class=line>{line_html}</div>" if line_html else ""}'
                f'{f"<div class=facts>{fx}</div>" if fx else ""}</div>', unsafe_allow_html=True)


def kpi_tile_html(label: str, value: str, caption: str = "", tone: str = "", badge: str = "") -> str:
    b = f'<span class="badge">{_esc(badge)}</span>' if badge else ""
    cap = f'<div class="caption">{_esc(caption)}</div>' if caption else ""
    return (f'<div class="tl-kpi {tone}"><div class="label">{_esc(label)}{b}</div>'
            f'<div class="value">{_esc(value)}</div>{cap}</div>')


def kpi_row(tiles: Iterable[dict]) -> None:
    """tiles: [{label, value, caption?, tone?('good'|'bad'|'warn'), badge?}, ...]"""
    inner = "".join(kpi_tile_html(t["label"], t["value"], t.get("caption", ""), t.get("tone", ""), t.get("badge", ""))
                    for t in tiles)
    st.markdown(f'<div class="tl-kpi-grid">{inner}</div>', unsafe_allow_html=True)


def tone_for(v: Optional[float]) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return ""
    return "good" if v > 0 else ("bad" if v < 0 else "")


def pill(state: str, text: Optional[str] = None) -> str:
    cls = {"green": "green", "amber": "amber", "red": "red", "breached": "breached",
           "ok": "green", "info": "blue"}.get(state, "neutral")
    return f'<span class="tl-pill {cls}">{_esc(text or state)}</span>'


def note(text_html: str) -> None:
    """Small explanatory paragraph. Accepts <b> for emphasis."""
    st.markdown(f'<div class="tl-note">{text_html}</div>', unsafe_allow_html=True)


def big_number(label: str, value: str, sub: str = "", tone: str = "") -> None:
    cls = {"good": "tl-pos", "bad": "tl-neg"}.get(tone, "")
    st.markdown(f'<div class="tl-card"><div class="tl-big-label">{_esc(label)}</div>'
                f'<div class="tl-big {cls}">{_esc(value)}</div>'
                f'<div class="tl-note" style="margin-top:4px">{_esc(sub)}</div></div>', unsafe_allow_html=True)


def empty_state(title: str, body: str = "") -> None:
    st.markdown(f'<div class="tl-empty"><div class="t">{_esc(title)}</div>{_esc(body)}</div>',
                unsafe_allow_html=True)


def stat_table(rows: list[tuple[str, str]], cols: int = 2) -> None:
    """Label/value pairs rendered as compact columns."""
    chunks = [rows[i::cols] for i in range(cols)]
    columns = st.columns(cols)
    for col, chunk in zip(columns, chunks):
        body = "".join(f"<tr><td>{_esc(k)}</td><td>{_esc(v)}</td></tr>" for k, v in chunk)
        col.markdown(f'<table class="tl-stats">{body}</table>', unsafe_allow_html=True)


def small_sample_badge(n: int, threshold: int = 30) -> str:
    return f"{n} trades — small sample" if n < threshold else ""


# --------------------------------------------------------------------------
# DataFrame presentation
# --------------------------------------------------------------------------
MONEY_COLS = {"net_pnl", "gross_pnl", "fees", "initial_risk", "expectancy", "avg_win", "avg_loss",
              "best_trade", "worst_trade", "max_drawdown", "mae", "mfe", "balance", "threshold", "buffer",
              "high_water", "risk_per_contract", "total_risk", "net_pnl_with", "net_pnl_without", "risk_budget", "realised_today", "remaining", "value", "limit",
              "cost_at_avg_loss", "oos_net_pnl", "removed_pnl"}
R_COLS = {"r_multiple", "avg_r", "expectancy_r", "rolling"}
PCT_COLS = {"win_rate", "used_pct", "risk_pct_of_account", "best_day_pct", "probability", "pct_of_drawdown_limit", "exposure_pct", "pct"}
FRACTION_PCT = {"win_rate", "probability", "pct"}   # already 0-1; the others are 0-100
TIME_COLS = {"entry_time", "exit_time", "time", "created_at", "updated_at", "t"}


def column_config(df: pd.DataFrame, tz: str = "UTC", labels: Optional[dict] = None) -> dict:
    labels = labels or {}
    cfg: dict = {}
    for c in df.columns:
        label = labels.get(c, c.replace("_", " ").title())
        if c in MONEY_COLS:
            cfg[c] = st.column_config.NumberColumn(label, format="dollar")
        elif c in R_COLS:
            cfg[c] = st.column_config.NumberColumn(label, format="%.2f R")
        elif c in PCT_COLS:
            cfg[c] = st.column_config.NumberColumn(label, format="percent")
        elif c in TIME_COLS:
            cfg[c] = st.column_config.DatetimeColumn(label, format="D MMM YYYY HH:mm")
        elif c in ("qty", "trades", "contracts", "id", "streak", "window", "bars", "oos_trades"):
            cfg[c] = st.column_config.NumberColumn(label, format="%d")
        elif c in ("entry_price", "exit_price", "stop_price", "target_price", "price"):
            cfg[c] = st.column_config.NumberColumn(label, format="%.2f")
        elif c in ("tags", "mistake_tags"):
            cfg[c] = st.column_config.ListColumn(label)
        elif c == "rules_followed":
            cfg[c] = st.column_config.CheckboxColumn(label)
        else:
            cfg[c] = st.column_config.Column(label)
    return cfg


def show_df(df: pd.DataFrame, tz: str = "UTC", height: Optional[int] = None, pct_as_fraction: bool = True,
            key: Optional[str] = None, labels: Optional[dict] = None) -> None:
    """A dataframe with sensible formats. Fraction columns (win_rate, probability) are shown as %,
    0-100 percentage columns are converted; `labels` overrides column headings."""
    if df is None or df.empty:
        empty_state("Nothing to show", "Adjust the filters or import some trades.")
        return
    d = df.copy()
    for pc in PCT_COLS & set(d.columns):
        if pc not in FRACTION_PCT:                          # 'percent' format expects fractions
            d[pc] = d[pc].astype(float) / 100.0
    for c in TIME_COLS & set(d.columns):
        try:
            s = pd.to_datetime(d[c])
            if s.dt.tz is None:
                s = s.dt.tz_localize("UTC")
            d[c] = s.dt.tz_convert(tz).dt.tz_localize(None)
        except Exception:  # noqa: BLE001
            pass
    h = height or min(480, 38 + 35 * len(d))
    st.dataframe(d, use_container_width=True, hide_index=True, column_config=column_config(d, tz, labels), height=h, key=key)


def to_local(series: pd.Series, tz: str) -> pd.Series:
    s = pd.to_datetime(series)
    if s.dt.tz is None:
        s = s.dt.tz_localize("UTC")
    return s.dt.tz_convert(tz)


def scope_hint(df_all: pd.DataFrame) -> None:
    """When the current scope is empty but another has trades, offer a one-click switch."""
    from ui import state
    if df_all is None or df_all.empty:
        return
    present = set(df_all["source"].unique())
    f = state.filters()
    others = [name for name, srcs in state.SCOPES.items() if name not in ("All", f["scope"]) and present & set(srcs)]
    if not others:
        return
    cols = st.columns(len(others) + 2)
    for i, name in enumerate(others):
        n = int(df_all["source"].isin(state.SCOPES[name]).sum())
        if cols[i].button(f"Show {name.lower()} ({n} trades)", key=f"scope_hint_{name}", use_container_width=True):
            f["scope"] = name
            st.rerun()
