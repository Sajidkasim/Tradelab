"""The Coach card used on the Overview, Performance and Journal pages."""
from __future__ import annotations

import streamlit as st

from core import coach
from ui import components as c
from ui import state


def coach_panel(df, acct, tz: str, key: str = "coach", compact: bool = False) -> None:
    _coach_fragment(df, acct, tz, key, compact)


@st.fragment
def _coach_fragment(df, acct, tz: str, key: str, compact: bool) -> None:
    db = state.get_db()
    cfg = coach.get_config()
    scope = state.filters()["scope"]
    if df is None or df.empty:
        c.empty_state("Nothing to review", "")
        return
    extra = "" if compact else st.text_input("Anything the coach should know? (optional)", key=f"{key}_extra",
                                             placeholder="e.g. I sized down this week after the drawdown")
    cached = coach.review(df, acct, tz, db=db, scope=scope, extra=extra, cfg=cfg, force=False) if cfg.get("key") else None
    have = cached and cached.get("review")
    b1, b2 = st.columns([1, 1]) if not compact else (st, st)
    if not cfg.get("key"):
        st.markdown(f'<div class="tl-card"><div class="tl-big-label">Coach</div>'
                    f'<div class="tl-note" style="margin-top:6px">Add <b>ANTHROPIC_API_KEY</b> (or OPENAI_API_KEY) to your '
                    f'.env or Streamlit secrets and this card writes a plain-English review of the trades in view — '
                    f'what\'s working, what\'s leaking, one change for the week, and a risk check. Default model: '
                    f'<b>{c.esc(cfg["model"])}</b>; a review costs well under a cent.</div></div>', unsafe_allow_html=True)
        with st.expander("What the coach would read"):
            st.code(coach.build_brief(df, acct, tz, scope=scope), language="markdown")
        return
    label = "Refresh review" if have else "Ask the coach"
    if b1.button(label, key=f"{key}_ask", type="primary" if not have else "secondary", use_container_width=compact):
        with st.spinner("Reading your trades…"):
            res = coach.review(df, acct, tz, db=db, scope=scope, extra=extra, cfg=cfg, force=True)
        if res["error"]:
            st.error(res["error"])
        else:
            have = True
            cached = res
    if have:
        st.markdown(f'<div class="tl-card tl-coach">{_md(cached["review"])}'
                    f'<div class="tl-note" style="margin-top:12px;font-size:12px;color:var(--tl-muted)">'
                    f'{c.esc(cached["model"])}{" · cached" if cached.get("cached") else ""} · {len(df)} trades in view</div></div>',
                    unsafe_allow_html=True)
    elif not compact:
        st.markdown('<div class="tl-note">Click <b>Ask the coach</b> to get a review of exactly the trades in view. '
                    'Change the filters and ask again for a different slice.</div>', unsafe_allow_html=True)
    if not compact:
        with st.expander("What the coach read"):
            st.code((cached or {}).get("brief") or coach.build_brief(df, acct, tz, scope=scope), language="markdown")


def _md(text: str) -> str:
    """Tiny markdown → HTML for the four-heading review (headings, bullets, bold)."""
    import html
    import re
    out = []
    in_list = False
    for raw in text.splitlines():
        line = raw.rstrip()
        esc = html.escape(line)
        esc = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc)
        if line.startswith("### "):
            if in_list:
                out.append("</ul>"); in_list = False
            out.append(f'<div class="tl-big-label" style="margin-top:12px">{esc[4:]}</div>')
        elif line.lstrip().startswith(("- ", "• ", "* ")):
            if not in_list:
                out.append('<ul style="margin:4px 0 0 18px;padding:0">'); in_list = True
            out.append(f'<li class="tl-note">{esc.lstrip()[2:]}</li>')
        elif line.strip():
            if in_list:
                out.append("</ul>"); in_list = False
            out.append(f'<div class="tl-note" style="margin-top:4px">{esc}</div>')
    if in_list:
        out.append("</ul>")
    return "".join(out)
