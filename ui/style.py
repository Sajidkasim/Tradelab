"""Design tokens and CSS. One visual language for both themes.

The active theme comes from Streamlit itself (☰ → Settings → Light / Dark / System);
`theme_mode()` reads it so charts and custom CSS follow. Colours mirror core.charts.PALETTE.

The look: Inter, tight display tracking, one hero number, generous spacing, glass cards with
hairline borders, pill buttons, sections that rise in as they enter the viewport, hover lift.
Motion is CSS-only, respects prefers-reduced-motion, and degrades to static where unsupported.
"""
from __future__ import annotations

import streamlit as st

from core.charts import PALETTE


def theme_mode() -> str:
    """'dark' or 'light' — the theme the viewer actually has active."""
    forced = st.session_state.get("theme_mode")
    if forced in ("dark", "light"):
        return forced
    try:
        t = st.context.theme.type
        if t in ("dark", "light"):
            return t
    except Exception:  # noqa: BLE001
        pass
    try:
        base = st.get_option("theme.base")
        if base in ("dark", "light"):
            return base
    except Exception:  # noqa: BLE001
        pass
    return "dark"


def inject_css() -> None:
    mode = theme_mode()
    p = PALETTE[mode]
    dark = mode == "dark"
    border = "rgba(255,255,255,0.09)" if dark else "rgba(11,11,11,0.09)"
    border_strong = "rgba(255,255,255,0.16)" if dark else "rgba(11,11,11,0.16)"
    hover = "rgba(255,255,255,0.04)" if dark else "rgba(11,11,11,0.035)"
    glass = "rgba(26,26,25,0.72)" if dark else "rgba(255,255,255,0.72)"
    shadow = "0 1px 2px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.28)" if dark else "0 1px 2px rgba(11,11,11,0.04), 0 12px 32px rgba(11,11,11,0.06)"
    shadow_hover = "0 2px 4px rgba(0,0,0,0.4), 0 20px 48px rgba(0,0,0,0.38)" if dark else "0 2px 4px rgba(11,11,11,0.05), 0 20px 48px rgba(11,11,11,0.10)"
    page = "#0d0d0d" if dark else "#f5f5f7"
    pos, neg = ("#4fd14f", "#ff7b7b") if dark else ("#0a7d0a", "#c62828")
    st.markdown(f"""
<style>
:root {{
  --tl-surface: {p['surface']}; --tl-page: {page}; --tl-ink: {p['ink']}; --tl-ink2: {p['ink2']};
  --tl-muted: {p['muted']}; --tl-grid: {p['grid']}; --tl-axis: {p['axis']};
  --tl-border: {border}; --tl-border-strong: {border_strong}; --tl-hover: {hover}; --tl-glass: {glass};
  --tl-shadow: {shadow}; --tl-shadow-hover: {shadow_hover};
  --tl-accent: {p['series'][0]}; --tl-good: {p['good']}; --tl-warn: {p['warning']};
  --tl-serious: {p['serious']}; --tl-bad: {p['critical']}; --tl-pos: {pos}; --tl-neg: {neg};
  --tl-ease: cubic-bezier(.2,.7,.2,1);
}}

/* ---------- type ---------- */
html, body, .stApp, [class*="css"] {{ -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }}
.stApp {{ font-feature-settings: "cv11", "ss01", "ss03"; }}
.block-container {{ max-width: 1360px; padding-top: 1.6rem; padding-bottom: 5rem; padding-left: 2rem; padding-right: 2rem; }}
#MainMenu {{ visibility: visible; }}
footer {{ visibility: hidden; }}
header[data-testid="stHeader"] {{ background: transparent; backdrop-filter: none; }}

/* ---------- page header ---------- */
.tl-page {{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin: 4px 0 22px 0; flex-wrap: wrap; }}
.tl-page .title {{ font-size: 34px; font-weight: 600; letter-spacing: -0.03em; color: var(--tl-ink); line-height: 1.1; }}
.tl-page .sub {{ font-size: 15px; color: var(--tl-muted); margin-top: 6px; letter-spacing: -0.005em; }}
.tl-page .meta {{ font-size: 12px; color: var(--tl-muted); text-align: right; letter-spacing: 0.01em; }}

/* ---------- hero ---------- */
.tl-hero {{ position: relative; overflow: hidden; border-radius: 22px; padding: 34px 36px 30px 36px;
  background: var(--tl-glass); border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow);
  backdrop-filter: blur(24px) saturate(140%); -webkit-backdrop-filter: blur(24px) saturate(140%); margin-bottom: 18px; }}
.tl-hero::before {{ content:""; position:absolute; inset:-40% -20% auto auto; width: 60%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(closest-side, var(--tl-glow, rgba(57,135,229,0.30)), transparent 70%); filter: blur(30px); pointer-events:none; }}
.tl-hero .eyebrow {{ font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.10em; color: var(--tl-muted); }}
.tl-hero .number {{ font-size: clamp(44px, 6vw, 72px); font-weight: 600; letter-spacing: -0.045em; line-height: 1.02; margin-top: 8px; color: var(--tl-ink); font-variant-numeric: proportional-nums; }}
.tl-hero .number.pos {{ color: var(--tl-pos); }} .tl-hero .number.neg {{ color: var(--tl-neg); }}
.tl-hero .line {{ font-size: 15px; color: var(--tl-ink2); margin-top: 12px; letter-spacing: -0.005em; }}
.tl-hero .line b {{ color: var(--tl-ink); font-weight: 600; }}
.tl-hero .facts {{ display:flex; gap: 28px; flex-wrap: wrap; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--tl-border); }}
.tl-hero .fact .k {{ font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--tl-muted); }}
.tl-hero .fact .v {{ font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: var(--tl-ink); margin-top: 2px; }}
.tl-hero .fact .v.pos {{ color: var(--tl-pos); }} .tl-hero .fact .v.neg {{ color: var(--tl-neg); }}

/* ---------- KPI tiles ---------- */
.tl-kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 4px 0 8px 0; }}
.tl-kpi {{ background: var(--tl-glass); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--tl-border); border-radius: 16px; padding: 16px 18px 14px 18px; min-width: 0;
  box-shadow: var(--tl-shadow); transition: transform .35s var(--tl-ease), box-shadow .35s var(--tl-ease), border-color .35s var(--tl-ease); }}
.tl-kpi:hover {{ transform: translateY(-2px); box-shadow: var(--tl-shadow-hover); border-color: var(--tl-border-strong); }}
.tl-kpi.good {{ box-shadow: inset 3px 0 0 var(--tl-good), var(--tl-shadow); }}
.tl-kpi.bad  {{ box-shadow: inset 3px 0 0 var(--tl-bad), var(--tl-shadow); }}
.tl-kpi.warn {{ box-shadow: inset 3px 0 0 var(--tl-warn), var(--tl-shadow); }}
.tl-kpi .label {{ font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--tl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
.tl-kpi .value {{ font-size: 28px; font-weight: 600; letter-spacing: -0.03em; color: var(--tl-ink); line-height: 1.1; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
.tl-kpi .caption {{ font-size: 12.5px; color: var(--tl-ink2); margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
.tl-kpi .badge {{ display:inline-block; margin-left:6px; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: rgba(250,178,25,0.16); color: var(--tl-warn); vertical-align: middle; letter-spacing: 0; text-transform: none; }}

/* ---------- sections, cards, pills ---------- */
.tl-section {{ margin: 38px 0 12px 0; }}
.tl-section .h {{ font-size: 20px; font-weight: 600; letter-spacing: -0.025em; color: var(--tl-ink); }}
.tl-section .c {{ font-size: 13.5px; color: var(--tl-muted); margin-top: 3px; letter-spacing: -0.005em; }}
.tl-card {{ background: var(--tl-glass); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--tl-border);
  border-radius: 16px; padding: 18px 20px; margin-bottom: 10px; box-shadow: var(--tl-shadow); transition: transform .35s var(--tl-ease), box-shadow .35s var(--tl-ease); }}
.tl-card:hover {{ transform: translateY(-1px); box-shadow: var(--tl-shadow-hover); }}
.tl-pill {{ display: inline-block; padding: 5px 13px; border-radius: 999px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }}
.tl-pill.green {{ background: rgba(12,163,12,0.16); color: var(--tl-pos); }}
.tl-pill.amber {{ background: rgba(250,178,25,0.18); color: {"#fab219" if dark else "#8a5a00"}; }}
.tl-pill.red   {{ background: rgba(236,131,90,0.18); color: {"#ec835a" if dark else "#9a3b12"}; }}
.tl-pill.breached {{ background: rgba(208,59,59,0.20); color: var(--tl-neg); }}
.tl-pill.neutral {{ background: var(--tl-hover); color: var(--tl-ink2); border: 1px solid var(--tl-border); }}
.tl-pill.blue {{ background: rgba(57,135,229,0.16); color: {"#7fb3f0" if dark else "#1c5cab"}; }}
.tl-note {{ font-size: 14px; color: var(--tl-ink2); line-height: 1.55; letter-spacing: -0.005em; }}
.tl-note b {{ color: var(--tl-ink); font-weight: 600; }}
.tl-big {{ font-size: 34px; font-weight: 600; letter-spacing: -0.035em; color: var(--tl-ink); line-height: 1.05; }}
.tl-big-label {{ font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--tl-muted); }}
.tl-pos {{ color: var(--tl-pos); }} .tl-neg {{ color: var(--tl-neg); }}

/* ---------- progress ---------- */
.tl-prog {{ margin: 6px 0 4px 0; }}
.tl-prog-head {{ display:flex; justify-content:space-between; font-size: 12px; color: var(--tl-muted); margin-bottom: 6px; letter-spacing: .02em; }}
.tl-prog-track {{ height: 8px; border-radius: 999px; background: var(--tl-hover); border: 1px solid var(--tl-border); overflow: hidden; }}
.tl-prog-fill {{ height: 100%; border-radius: 999px; transition: width .6s var(--tl-ease); }}
.tl-prog-cap {{ font-size: 12px; color: var(--tl-ink2); margin-top: 6px; }}
.tl-hint {{ font-size: 13px; color: var(--tl-muted); text-align:center; padding: 18px 0 6px 0; }}

/* ---------- empty state, stat table ---------- */
.tl-empty {{ text-align: center; padding: 52px 16px; border: 1px dashed var(--tl-border-strong); border-radius: 16px; color: var(--tl-muted); margin: 8px 0; }}
.tl-empty .t {{ font-size: 17px; font-weight: 600; letter-spacing: -0.02em; color: var(--tl-ink2); margin-bottom: 4px; }}
.tl-stats {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
.tl-stats td {{ padding: 9px 4px; border-bottom: 1px solid var(--tl-grid); }}
.tl-stats td:first-child {{ color: var(--tl-muted); }}
.tl-stats td:last-child {{ text-align: right; color: var(--tl-ink); font-variant-numeric: tabular-nums; font-weight: 500; }}

/* ---------- sidebar ---------- */
section[data-testid="stSidebar"] {{ border-right: 1px solid var(--tl-border); }}
section[data-testid="stSidebar"] .tl-foot {{ font-size: 11px; color: var(--tl-muted); margin-top: 18px; line-height: 1.5; }}
section[data-testid="stSidebar"] hr {{ margin: 10px 0; border-color: var(--tl-border); }}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"] {{ border-radius: 10px; transition: background .2s var(--tl-ease); }}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"] span {{ letter-spacing: -0.005em; }}

/* ---------- widgets: quieter, rounder ---------- */
div[data-testid="stDataFrame"], div[data-testid="stDataEditor"] {{ border: 1px solid var(--tl-border); border-radius: 14px; overflow: hidden; box-shadow: var(--tl-shadow); }}
div[data-testid="stPlotlyChart"] {{ border-radius: 16px; overflow: hidden; border: 1px solid var(--tl-border); box-shadow: var(--tl-shadow); }}
/* segmented-control tabs (react-aria structure in Streamlit ≥1.60) */
div[data-testid="stTabs"] [role="tablist"] {{ gap: 2px; background: var(--tl-hover); padding: 4px; border-radius: 999px; width: max-content; max-width: 100%; overflow-x: auto; border: 1px solid var(--tl-border); }}
div[data-testid="stTabs"] [role="tablist"]::after, div[data-testid="stTabs"] [role="tablist"]::before {{ display: none; }}
div[data-testid="stTab"] {{ padding: 6px 16px !important; border-radius: 999px; transition: background .25s var(--tl-ease), color .25s var(--tl-ease), box-shadow .25s var(--tl-ease); }}
div[data-testid="stTab"] p {{ font-weight: 500; letter-spacing: -0.005em; }}
div[data-testid="stTab"][aria-selected="true"] {{ background: var(--tl-surface); box-shadow: var(--tl-shadow); }}
div[data-testid="stTab"][aria-selected="true"] p {{ color: var(--tl-ink); }}
div[data-testid="stTab"] .react-aria-SelectionIndicator {{ display: none; }}
div[data-testid="stTabs"] [role="tabpanel"] {{ padding-top: 14px; }}
/* older Streamlit (baseweb) structure, harmless if absent */
.stTabs [data-baseweb="tab-list"] {{ gap: 2px; background: var(--tl-hover); padding: 4px; border-radius: 999px; width: max-content; border: 1px solid var(--tl-border); }}
.stTabs [data-baseweb="tab"] {{ padding: 7px 16px; border-radius: 999px; }}
.stTabs [data-baseweb="tab"][aria-selected="true"] {{ background: var(--tl-surface); box-shadow: var(--tl-shadow); }}
.stTabs [data-baseweb="tab-highlight"], .stTabs [data-baseweb="tab-border"] {{ display: none; }}
div[data-testid="stMetric"] {{ display:none; }}
.stButton > button, .stDownloadButton > button, .stFormSubmitButton > button {{ border-radius: 999px; padding: 0.45rem 1.1rem; font-weight: 600; letter-spacing: -0.005em;
  transition: transform .2s var(--tl-ease), box-shadow .25s var(--tl-ease), background .25s var(--tl-ease); }}
.stButton > button:hover, .stDownloadButton > button:hover, .stFormSubmitButton > button:hover {{ transform: translateY(-1px); box-shadow: var(--tl-shadow); }}
.stButton > button:active {{ transform: translateY(0) scale(.99); }}
button[kind="primary"] {{ box-shadow: 0 6px 20px rgba(57,135,229,0.30); }}
div[data-testid="stAlert"] {{ border-radius: 14px; }}
div[data-testid="stExpander"] {{ border-radius: 14px; border: 1px solid var(--tl-border); }}
div[data-baseweb="select"] > div, div[data-baseweb="input"] > div, div[data-baseweb="base-input"] {{ border-radius: 12px !important; }}
.stSlider [data-baseweb="slider"] div[role="slider"] {{ box-shadow: 0 2px 8px rgba(0,0,0,.25); }}

/* ---------- motion ---------- */
@keyframes tl-rise {{ from {{ opacity: 0; transform: translateY(14px); }} to {{ opacity: 1; transform: none; }} }}
.tl-hero, .tl-kpi-grid, .tl-card, .tl-section, div[data-testid="stPlotlyChart"], div[data-testid="stDataFrame"] {{ animation: tl-rise .6s var(--tl-ease) both; }}
.tl-kpi-grid .tl-kpi:nth-child(2) {{ animation-delay: .04s }} .tl-kpi-grid .tl-kpi:nth-child(3) {{ animation-delay: .08s }}
.tl-kpi-grid .tl-kpi:nth-child(4) {{ animation-delay: .12s }} .tl-kpi-grid .tl-kpi:nth-child(5) {{ animation-delay: .16s }} .tl-kpi-grid .tl-kpi:nth-child(6) {{ animation-delay: .20s }}
.tl-kpi-grid .tl-kpi {{ animation: tl-rise .6s var(--tl-ease) both; }}
@supports (animation-timeline: view()) {{
  .tl-card, .tl-section, div[data-testid="stPlotlyChart"], div[data-testid="stDataFrame"] {{
    animation: tl-rise linear both; animation-timeline: view(); animation-range: entry 0% entry 28%; }}
}}
@media (prefers-reduced-motion: reduce) {{
  .tl-hero, .tl-kpi-grid, .tl-kpi, .tl-card, .tl-section, div[data-testid="stPlotlyChart"], div[data-testid="stDataFrame"] {{ animation: none !important; }}
  .tl-kpi, .tl-card, .stButton > button {{ transition: none !important; }}
}}

/* ---------- small screens ---------- */
@media (max-width: 640px) {{
  .block-container {{ padding-top: 3.6rem; padding-left: 1rem; padding-right: 1rem; }}
  .tl-page .title {{ font-size: 28px; }}
  .tl-hero {{ padding: 24px 22px; border-radius: 18px; }}
  .tl-hero .facts {{ gap: 18px; }}
  .tl-kpi .value {{ font-size: 24px; }}
  .tl-page .meta {{ text-align: left; }}
}}
</style>
""", unsafe_allow_html=True)
