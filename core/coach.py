"""AI trade coach.

Turns the trades in view into a compact, factual brief (pure function, testable), sends it to
a language model with a tight coaching prompt, and returns a short review. Reviews are cached
by the brief's hash so re-rendering a page never re-bills you.

Providers: Anthropic (default) or OpenAI, chosen by which key is present:
    ANTHROPIC_API_KEY / OPENAI_API_KEY  in .env or st.secrets
    COACH_PROVIDER = "anthropic" | "openai"   (optional)
    COACH_MODEL    = model id                 (optional)

The model only ever sees aggregated numbers and short trade lines — never your API keys,
never your broker credentials.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Optional

import pandas as pd

from . import metrics, risk
from .charts import fmt_money, fmt_pct, fmt_r, fmt_ratio

DEFAULT_MODELS = {"anthropic": "claude-sonnet-5", "openai": "gpt-5.6-terra"}
MAX_TOKENS = 700

SYSTEM_PROMPT = """You are a trading performance coach for a discretionary futures/options trader on a prop-firm account.
You are given a factual brief of their trades. Write a short review in Markdown with exactly these four headings:

### What's working
### What's leaking
### One change this week
### Risk check

Rules:
- Use only the numbers in the brief. Never invent trades, numbers or causes. Quote figures with their units ($, %, R).
- Be specific: name the setups, sessions, weekdays and mistake tags that matter. Prefer "ORB in Power hour: -$212 across 9 trades" to "some setups underperform".
- Where a sample is under 30 trades, say so and hold the conclusion loosely.
- "One change this week" is a single, concrete, testable behaviour (e.g. "no ORB entries after 19:00 for two weeks; log every one you skip").
- Risk check: comment on the daily-limit state, trailing-drawdown buffer, consistency rule and losing-streak exposure from the brief.
- No greetings, no disclaimers, no motivational filler. Under 220 words total. British English."""


# --------------------------------------------------------------------------
# Brief
# --------------------------------------------------------------------------
def _table_lines(bd: pd.DataFrame, col: str, top: int = 6) -> list[str]:
    out = []
    if bd is None or bd.empty:
        return out
    for r in bd.head(top).itertuples():
        name = getattr(r, col) or "untagged"
        out.append(f"  - {name}: {int(r.trades)} trades, WR {fmt_pct(r.win_rate)}, expectancy {fmt_money(r.expectancy)}, "
                   f"{fmt_r(r.avg_r)}, net {fmt_money(r.net_pnl)}{' (small sample)' if r.trades < 30 else ''}")
    return out


def build_brief(df: pd.DataFrame, acct, tz: str = "UTC", max_trades: int = 12, scope: str = "") -> str:
    """A compact, factual markdown brief of the trades in view. Pure: no I/O."""
    if df is None or df.empty:
        return "No trades in view."
    s = metrics.summary_stats(df, acct.starting_balance)
    lo, hi = s["win_rate_ci"]
    lines = [f"# Trading brief{(' — ' + scope) if scope else ''}",
             f"Account: {acct.name}, start {fmt_money(acct.starting_balance, sign=False)}, daily loss limit "
             f"{fmt_money(acct.daily_loss_limit, sign=False)}, trailing drawdown {fmt_money(acct.max_trailing_drawdown, sign=False)}, "
             f"risk/trade {acct.risk_per_trade_pct:.2f}%, consistency target {acct.consistency_target_pct:.0f}%.",
             "",
             "## Headline",
             f"- {s['trades']} closed trades over {s['trading_days']} days ({s['wins']} W / {s['losses']} L / {s['scratches']} scratch)"
             + (" — SMALL SAMPLE" if s["small_sample"] else ""),
             f"- Net P&L {fmt_money(s['net_pnl'])}; fees {fmt_money(s['fees'], sign=False)}",
             f"- Win rate {fmt_pct(s['win_rate'])} (95% CI {lo:.0%}–{hi:.0%}); payoff {fmt_ratio(s['payoff_ratio'])}; profit factor {fmt_ratio(s['profit_factor'])}",
             f"- Expectancy {fmt_money(s['expectancy'])} / {fmt_r(s['expectancy_r'])} per trade; avg win {fmt_money(s['avg_win'])}, avg loss {fmt_money(-s['avg_loss']) if s['avg_loss'] else '—'}",
             f"- Max drawdown {fmt_money(-s['max_drawdown']) if s['max_drawdown'] else '$0.00'} ({fmt_pct(s['max_drawdown_pct'])}); "
             f"longest loss streak {s['longest_loss_streak']}; current streak {s['current_streak']:+d}",
             f"- Best day {fmt_money(s['best_day'])}, worst day {fmt_money(s['worst_day'])}; avg hold {s['avg_hold_minutes']:.0f} min" if s["avg_hold_minutes"] else
             f"- Best day {fmt_money(s['best_day'])}, worst day {fmt_money(s['worst_day'])}"]
    roll = metrics.rolling_expectancy(df, 20)
    if not roll.empty and pd.notna(roll["rolling"].iloc[-1]):
        lines.append(f"- Rolling last-20 expectancy {fmt_r(roll['rolling'].iloc[-1])} vs all-time {fmt_r(s['expectancy_r'])}")

    feat = metrics.add_time_features(df, tz)
    lines += ["", "## By model / setup"] + _table_lines(metrics.breakdown(df, "setup_name"), "setup_name")
    sess = df.assign(session=df["session"].replace("", "unlabelled"))
    lines += ["", "## By session"] + _table_lines(metrics.breakdown(sess, "session"), "session")
    lines += ["", "## By weekday"] + _table_lines(metrics.breakdown(feat, "weekday"), "weekday", top=7)
    lines += ["", "## By symbol"] + _table_lines(metrics.breakdown(df, "symbol"), "symbol")
    ra = metrics.rule_adherence(df)
    if not ra.empty:
        r = ra.set_index("rules")
        lines += ["", "## Rule adherence",
                  f"- Followed: {int(r.loc['followed', 'trades'])} trades, {fmt_r(r.loc['followed', 'avg_r'])}, net {fmt_money(r.loc['followed', 'net_pnl'])}",
                  f"- Broke: {int(r.loc['broke', 'trades'])} trades, {fmt_r(r.loc['broke', 'avg_r'])}, net {fmt_money(r.loc['broke', 'net_pnl'])}",
                  f"- Not recorded: {int(r.loc['unknown', 'trades'])} trades"]
    tags = metrics.pnl_by_tag(df)
    if not tags.empty:
        lines += ["", "## Mistake tags (worst first)"]
        for t in tags.head(6).itertuples():
            lines.append(f"  - {t.tag}: {int(t.trades)} trades, net {fmt_money(t.net_pnl)}, WR {fmt_pct(t.win_rate)}")
    # risk state
    daily = metrics.daily_pnl(df)
    if len(daily):
        td = risk.trailing_drawdown_from_daily(daily, acct.starting_balance, acct.max_trailing_drawdown)
        last = td.iloc[-1]
        cons = risk.consistency(daily, acct.consistency_target_pct)
        ds = risk.daily_status(float(daily.iloc[-1]), acct.daily_loss_limit)
        lines += ["", "## Risk state",
                  f"- Last trading day {daily.index[-1]:%Y-%m-%d}: {fmt_money(float(daily.iloc[-1]))}, daily limit state {ds['state']} ({ds['used_pct']:.0f}% used)",
                  f"- Trailing drawdown buffer {fmt_money(float(last['buffer']), sign=False)} (balance {fmt_money(float(last['balance']), sign=False)}, limit {fmt_money(float(last['threshold']), sign=False)})",
                  f"- Consistency: best day {cons['best_day_pct']:.0f}% of total profit" if cons["best_day_pct"] is not None else "- Consistency: no profit yet",
                  ]
        if s["win_rate"] is not None:
            p6 = risk.losing_streak_probability(s["win_rate"], 6, 100)
            lines.append(f"- Chance of a 6-loss run in the next 100 trades at this win rate: {fmt_pct(p6)}; expected longest run "
                         f"{risk.expected_longest_losing_streak(s['win_rate'], 100):.0f}")
    # recent trades
    cl = metrics.closed(df).sort_values("exit_time", ascending=False).head(max_trades)
    if not cl.empty:
        lines += ["", f"## Last {len(cl)} closed trades (newest first)"]
        for t in cl.itertuples():
            when = pd.Timestamp(t.exit_time).tz_localize("UTC").tz_convert(tz)
            extra = []
            if t.rules_followed is False:
                extra.append("broke rules")
            if t.mistake_tags:
                extra.append("mistakes: " + ", ".join(t.mistake_tags))
            lines.append(f"  - {when:%a %d %b %H:%M} {t.symbol} {t.direction} x{t.qty:g} {t.setup_name or 'untagged'} "
                         f"[{t.session or '—'}]: {fmt_money(t.net_pnl)} {fmt_r(t.r_multiple) if pd.notna(t.r_multiple) else ''}"
                         + (f" ({'; '.join(extra)})" if extra else ""))
    return "\n".join(lines)


def brief_hash(brief: str, model: str) -> str:
    return hashlib.sha1((model + "\n" + brief).encode()).hexdigest()[:16]


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------
class CoachError(RuntimeError):
    pass


def get_config() -> dict:
    """Provider, model and key from env / st.secrets. key is None when not configured."""
    def _get(k):
        v = os.getenv(k)
        if v:
            return v
        try:
            import streamlit as st  # noqa: WPS433
            return st.secrets.get(k)
        except Exception:  # noqa: BLE001
            return None
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    a_key, o_key = _get("ANTHROPIC_API_KEY"), _get("OPENAI_API_KEY")
    provider = (_get("COACH_PROVIDER") or ("anthropic" if a_key else ("openai" if o_key else "anthropic"))).lower()
    key = a_key if provider == "anthropic" else o_key
    model = _get("COACH_MODEL") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["anthropic"])
    return {"provider": provider, "model": model, "key": key}


def ask_anthropic(key: str, model: str, system: str, user: str, session: Any = None, timeout: float = 60) -> str:
    import requests
    http = session or requests
    resp = http.post("https://api.anthropic.com/v1/messages",
                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                     json={"model": model, "max_tokens": MAX_TOKENS, "system": system,
                           "messages": [{"role": "user", "content": user}]}, timeout=timeout)
    if resp.status_code >= 400:
        raise CoachError(f"Anthropic API {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def ask_openai(key: str, model: str, system: str, user: str, session: Any = None, timeout: float = 60) -> str:
    import requests
    http = session or requests
    resp = http.post("https://api.openai.com/v1/chat/completions",
                     headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
                     json={"model": model, "max_completion_tokens": MAX_TOKENS,
                           "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
                     timeout=timeout)
    if resp.status_code >= 400:
        raise CoachError(f"OpenAI API {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return (data["choices"][0]["message"]["content"] or "").strip()


def ask(provider: str, key: str, model: str, brief: str, session: Any = None, extra: str = "") -> str:
    user = brief + (f"\n\nTrader's note: {extra.strip()}" if extra and extra.strip() else "")
    if provider == "openai":
        return ask_openai(key, model, SYSTEM_PROMPT, user, session)
    return ask_anthropic(key, model, SYSTEM_PROMPT, user, session)


def review(df: pd.DataFrame, acct, tz: str, db=None, scope: str = "", extra: str = "",
           cfg: Optional[dict] = None, session: Any = None, force: bool = False) -> dict:
    """Build the brief, return a cached review if one exists for it, otherwise call the model.
    Returns {"brief", "review", "cached", "model", "error"}."""
    cfg = cfg or get_config()
    brief = build_brief(df, acct, tz, scope=scope)
    h = brief_hash(brief + extra, cfg["model"])
    key = f"coach_{h}"
    if db is not None and not force:
        cached = db.get_setting(key)
        if cached:
            return {"brief": brief, "review": cached, "cached": True, "model": cfg["model"], "error": None}
    if not cfg.get("key"):
        return {"brief": brief, "review": None, "cached": False, "model": cfg["model"],
                "error": "No API key configured. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY) to .env or Streamlit secrets."}
    try:
        text = ask(cfg["provider"], cfg["key"], cfg["model"], brief, session, extra)
    except Exception as e:  # noqa: BLE001
        return {"brief": brief, "review": None, "cached": False, "model": cfg["model"], "error": str(e)}
    if db is not None:
        db.set_setting(key, text)
    return {"brief": brief, "review": text, "cached": False, "model": cfg["model"], "error": None}
