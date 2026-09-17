"""Nightly auto-journal.

Pulls the day's fills from TopstepX, pairs them into trades, reconciles against the
broker's own P&L, saves them, checks the day against your account limits, and writes a
short review of the session that shows up in the app (Journal → Daily reviews).

Run it by hand:            python nightly.py
Run for another day:       python nightly.py --date 2026-09-15
Dry run (no writes):       python nightly.py --dry-run
Schedule it:               see README (cron / Task Scheduler / GitHub Actions)

Needs PROJECTX_USERNAME, PROJECTX_API_KEY and (for a hosted database) TRADELAB_DB_URL in
the environment or a .env file. Read-only toward the broker — it never places orders.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from core import metrics, risk
from core.charts import fmt_money, fmt_pct, fmt_r
from core.db import Database
from core.fills_to_trades import pair_fills, reconcile_with_broker
from core.models import LIVE_SOURCES
from core.projectx_api import ProjectXClient, ProjectXError


def local_day_bounds(day, tz: str) -> tuple[datetime, datetime]:
    start = pd.Timestamp(day).tz_localize(tz)
    end = start + pd.Timedelta(days=1)
    return start.tz_convert("UTC").to_pydatetime(), end.tz_convert("UTC").to_pydatetime()


def build_review(db: Database, day, tz: str, pulled: dict, acct) -> str:
    df_all = db.trades_df(sources=LIVE_SOURCES)
    if df_all.empty:
        return f"# {day}\n\nNo live trades on record yet."
    local_exit = pd.to_datetime(df_all["exit_time"]).dt.tz_localize("UTC").dt.tz_convert(tz).dt.date
    today = df_all[(local_exit == day) & df_all["exit_price"].notna()]
    s = metrics.summary_stats(today, acct.starting_balance)
    daily = metrics.daily_pnl(df_all)
    lines = [f"# Session review — {day:%A %d %B %Y}", ""]
    lines.append(f"**Pulled:** {pulled.get('fills', 0)} fills → {pulled.get('trades', 0)} trades "
                 f"({pulled.get('inserted', 0)} new, {pulled.get('skipped', 0)} already stored)"
                 + (f" · reconciliation difference {fmt_money(pulled['diff'])} ⚠️" if abs(pulled.get("diff", 0.0)) > 0.01 else " · reconciled ✓"))
    lines.append("")
    if s["trades"] == 0:
        lines.append("No closed trades today.")
    else:
        lines.append(f"**Net P&L {fmt_money(s['net_pnl'])}** over {s['trades']} trades · win rate {fmt_pct(s['win_rate'])} · "
                     f"expectancy {fmt_r(s['expectancy_r'])} · best {fmt_money(s['best_trade'])} · worst {fmt_money(s['worst_trade'])}")
        by_setup = metrics.breakdown(today, "setup_name")
        for r in by_setup.itertuples():
            nm = r.setup_name or "untagged"
            lines.append(f"- {nm}: {r.trades} trade(s), {fmt_money(r.net_pnl)}, {fmt_pct(r.win_rate)}")
        ra = metrics.rule_adherence(today).set_index("rules")
        if ra.loc["broke", "trades"] > 0:
            lines.append(f"- Rules broken on {int(ra.loc['broke', 'trades'])} trade(s): {fmt_money(ra.loc['broke', 'net_pnl'])}")
        tags = metrics.pnl_by_tag(today)
        if not tags.empty:
            w = tags.iloc[0]
            lines.append(f"- Most costly mistake: {w['tag']} ({int(w['trades'])}×, {fmt_money(w['net_pnl'])})")
    # limits
    realised = float(today["net_pnl"].sum()) if not today.empty else 0.0
    ds = risk.daily_status(realised, acct.daily_loss_limit, len(today), acct.max_trades_per_day)
    lines.append("")
    lines.append(f"**Limits:** daily loss {ds['state'].upper()} ({ds['used_pct']:.0f}% used)")
    if len(daily):
        td = risk.trailing_drawdown_from_daily(daily, acct.starting_balance, acct.max_trailing_drawdown)
        last = td.iloc[-1]
        lines.append(f"- Trailing drawdown buffer {fmt_money(last['buffer'], sign=False)} "
                     f"(balance {fmt_money(last['balance'], sign=False)}, limit {fmt_money(last['threshold'], sign=False)})")
        cons = risk.consistency(daily, acct.consistency_target_pct)
        if cons["best_day_pct"] is not None:
            lines.append(f"- Consistency: best day is {cons['best_day_pct']:.0f}% of total profit "
                         f"({'ok' if cons['compliant'] else 'needs ' + fmt_money(cons['needed_profit'], sign=False) + ' more on other days'})")
        if ds["state"] == "breached":
            db.log_breach(acct.id, str(day), "daily_loss_limit", realised, -acct.daily_loss_limit, "nightly")
        if bool(last["breached"]):
            db.log_breach(acct.id, str(day), "trailing_drawdown", float(last["balance"]), float(last["threshold"]), "nightly")
    # longer view
    allstats = metrics.summary_stats(df_all, acct.starting_balance)
    roll = metrics.rolling_expectancy(df_all, 20)
    if allstats["trades"] >= 20 and not roll.empty and pd.notna(roll["rolling"].iloc[-1]):
        lines.append("")
        lines.append(f"**Last 20 trades:** {fmt_r(roll['rolling'].iloc[-1])} average vs {fmt_r(allstats['expectancy_r'])} all-time"
                     + (" — edge is running below its average, size down." if roll["rolling"].iloc[-1] < (allstats["expectancy_r"] or 0) - 0.2 else ""))
    lines.append("")
    lines.append("_Generated by nightly.py_")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD in your timezone (default: today)")
    ap.add_argument("--days-back", type=int, default=1, help="also re-pull this many previous days (catches late fills)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--account-name", help="PrimusLab account to attribute trades to (default: first)")
    args = ap.parse_args()

    db = Database.from_env(); db.init()
    tz = db.get_setting("tz", "Europe/London")
    accts = db.accounts()
    if not accts:
        print("No PrimusLab account configured — open the app once and set one up in Settings."); return 2
    acct = next((a for a in accts if a.name == args.account_name), accts[0])
    day = pd.Timestamp(args.date).date() if args.date else pd.Timestamp.now(tz=tz).date()

    pulled = {"fills": 0, "trades": 0, "inserted": 0, "skipped": 0, "diff": 0.0}
    try:
        client = ProjectXClient.from_env()
        broker_accts = client.accounts()
        if broker_accts.empty:
            print("No broker accounts visible."); return 3
        start, _ = local_day_bounds(day - timedelta(days=args.days_back), tz)
        _, end = local_day_bounds(day, tz)
        mult = {s: i.multiplier for s, i in db.instruments().items()}
        all_trades = []
        for row in broker_accts.to_dict("records"):
            fills = client.fills(int(row["id"]), start, end)
            if fills.empty:
                continue
            trades, _ = pair_fills(fills, mult)
            for t in trades:
                t.account_id = acct.id
            rec = reconcile_with_broker(fills, trades)
            pulled["fills"] += len(fills); pulled["trades"] += len(trades)
            pulled["diff"] += float(rec["difference"].abs().sum()) if not rec.empty else 0.0
            all_trades.extend(trades)
        if all_trades and not args.dry_run:
            res = db.insert_trades(all_trades)
            pulled["inserted"], pulled["skipped"] = res["inserted"], res["skipped"]
        print(f"Pulled {pulled['fills']} fills -> {pulled['trades']} trades; inserted {pulled['inserted']}, skipped {pulled['skipped']}")
        if pulled["diff"] > 0.01:
            print(f"WARNING: reconciliation difference {pulled['diff']:.2f} — check instrument multipliers in Settings.")
    except ProjectXError as e:
        print(f"API not available ({e}); writing the review from stored trades only.")

    review = build_review(db, day, tz, pulled, acct)
    print("\n" + review)
    if not args.dry_run:
        db.set_setting(f"daily_review_{day.isoformat()}", review)
        db.set_setting("last_nightly_run", datetime.now(timezone.utc).isoformat())
        out = Path("data/reviews"); out.mkdir(parents=True, exist_ok=True)
        (out / f"{day.isoformat()}.md").write_text(review)
    return 0


if __name__ == "__main__":
    sys.exit(main())
