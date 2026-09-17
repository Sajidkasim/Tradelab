"""Plotly chart helpers with one consistent palette in light and dark.

Rules baked in
--------------
- Categorical series take colours in FIXED slot order (never cycled past 8).
- Magnitude uses one hue light->dark; polarity uses a diverging pair with a neutral mid.
- P&L sign uses the status pair (good/critical) and ALWAYS carries a +/- sign in
  text, so colour is never the only cue. Pass cvd_safe=True to swap the P&L pair
  for blue/red, which survives red-green colour blindness.
- Thin marks, hairline gridlines, muted axis ink, system sans, hover on everything.
- One y-axis per plot: equity and drawdown are stacked subplots, never dual-axis.

Usage in Streamlit:
    fig = equity_chart(eq_df, mode="dark"); st.plotly_chart(fig, use_container_width=True)
"""
from __future__ import annotations

from typing import Iterable, Optional

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

PALETTE = {
    "light": {
        "surface": "#fcfcfb", "page": "#f9f9f7", "ink": "#0b0b0b", "ink2": "#52514e",
        "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7",
        "series": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
        "seq": ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
                "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"],
        "div_neg": "#e34948", "div_mid": "#f0efec", "div_pos": "#2a78d6",
        "good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b",
    },
    "dark": {
        "surface": "#1a1a19", "page": "#0d0d0d", "ink": "#ffffff", "ink2": "#c3c2b7",
        "muted": "#898781", "grid": "#2c2c2a", "axis": "#383835",
        "series": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
        "seq": ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
                "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"],
        "div_neg": "#e66767", "div_mid": "#383835", "div_pos": "#3987e5",
        "good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b",
    },
}
FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'


def pal(mode: str = "dark") -> dict:
    return PALETTE["dark" if mode == "dark" else "light"]


def pnl_colors(mode: str = "dark", cvd_safe: bool = False) -> tuple[str, str]:
    """(positive, negative) colours for P&L sign."""
    p = pal(mode)
    return (p["div_pos"], p["div_neg"]) if cvd_safe else (p["good"], p["critical"])


def theme(fig: go.Figure, mode: str = "dark", height: int | None = None) -> go.Figure:
    p = pal(mode)
    fig.update_layout(
        paper_bgcolor=p["surface"], plot_bgcolor=p["surface"],
        font=dict(family=FONT, color=p["ink2"], size=12),
        margin=dict(l=48, r=24, t=48, b=40), hovermode="x unified",
        title=dict(x=0, xanchor="left", y=0.97, yanchor="top"),
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=1, xanchor="right",
                    bgcolor="rgba(0,0,0,0)"),
        hoverlabel=dict(bgcolor=p["surface"], font=dict(family=FONT, color=p["ink"]),
                        bordercolor=p["axis"]),
    )
    fig.update_xaxes(gridcolor=p["grid"], gridwidth=1, zeroline=False, linecolor=p["axis"],
                     tickfont=dict(color=p["muted"]), title_font=dict(color=p["muted"]),
                     showline=True)
    fig.update_yaxes(gridcolor=p["grid"], gridwidth=1, zerolinecolor=p["axis"], zerolinewidth=1,
                     linecolor=p["axis"], tickfont=dict(color=p["muted"]),
                     title_font=dict(color=p["muted"]), showline=False,
                     tickformat=",")
    if height:
        fig.update_layout(height=height)
    return fig


# --------------------------------------------------------------------------
# Formatting
# --------------------------------------------------------------------------
def fmt_money(v: Optional[float], sign: bool = True) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    s = f"{abs(v):,.2f}"
    if sign:
        return f"+${s}" if v > 0 else (f"−${s}" if v < 0 else f"${s}")
    return f"${s}"


def fmt_pct(v: Optional[float], digits: int = 1, is_fraction: bool = True) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"{(v * 100 if is_fraction else v):.{digits}f}%"


def fmt_r(v: Optional[float]) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"{v:+.2f}R"


def fmt_ratio(v: Optional[float]) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return "∞" if np.isinf(v) else f"{v:.2f}"


# --------------------------------------------------------------------------
# Charts
# --------------------------------------------------------------------------
def equity_chart(eq: pd.DataFrame, mode: str = "dark", title: str = "Equity",
                 starting_balance: float | None = None) -> go.Figure:
    """Equity line with drawdown as a separate stacked panel (one axis each)."""
    p = pal(mode)
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.72, 0.28],
                        vertical_spacing=0.04)
    if eq is None or eq.empty:
        fig.add_annotation(text="No closed trades yet", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 360)
    fig.add_trace(go.Scatter(x=eq["time"], y=eq["equity"], mode="lines", name="Equity",
                             line=dict(color=p["series"][0], width=2),
                             hovertemplate="%{x|%d %b %Y %H:%M}<br>Equity $%{y:,.2f}<extra></extra>"),
                  row=1, col=1)
    if starting_balance is not None:
        fig.add_hline(y=starting_balance, line=dict(color=p["axis"], width=1), row=1, col=1)
    fig.add_trace(go.Scatter(x=eq["time"], y=eq["drawdown"], mode="lines", name="Drawdown",
                             fill="tozeroy", line=dict(color=p["critical"], width=1),
                             fillcolor=_alpha(p["critical"], 0.18),
                             hovertemplate="Drawdown −$%{customdata:,.2f}<extra></extra>",
                             customdata=-eq["drawdown"]),
                  row=2, col=1)
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)))
    fig.update_yaxes(title_text="$", row=1, col=1)
    fig.update_yaxes(title_text="DD $", row=2, col=1)
    return theme(fig, mode, 420)


def compare_equity(curves: dict[str, pd.DataFrame], mode: str = "dark",
                   y: str = "equity", title: str = "Models compared") -> go.Figure:
    """Overlay up to 8 equity curves. Colour follows the model name in fixed slot order."""
    p = pal(mode)
    fig = go.Figure()
    for i, (name, eq) in enumerate(list(curves.items())[:8]):
        if eq is None or eq.empty:
            continue
        fig.add_trace(go.Scatter(x=eq["time"], y=eq[y], mode="lines", name=name,
                                 line=dict(color=p["series"][i], width=2),
                                 hovertemplate=f"{name}: %{{y:,.2f}}<extra></extra>"))
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)))
    return theme(fig, mode, 380)


def calendar_heatmap(daily: pd.Series, mode: str = "dark", cvd_safe: bool = False,
                     title: str = "Daily P&L") -> go.Figure:
    """GitHub-style calendar: columns = weeks, rows = weekdays, colour = daily net P&L
    on a diverging scale centred at zero."""
    p = pal(mode)
    pos, neg = pnl_colors(mode, cvd_safe)
    fig = go.Figure()
    if daily is None or daily.empty:
        fig.add_annotation(text="No trading days yet", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 220)
    d = daily.copy()
    d.index = pd.to_datetime(d.index)
    start = d.index.min() - pd.Timedelta(days=d.index.min().weekday())
    end = d.index.max()
    days = pd.date_range(start, end, freq="D")
    vals = d.reindex(days)
    week = ((days - start).days // 7).astype(int)
    wd = days.weekday
    z = np.full((5, week.max() + 1), np.nan)
    text = np.full((5, week.max() + 1), "", dtype=object)
    for dt, v, w, k in zip(days, vals.values, week, wd):
        if k < 5:
            z[k, w] = v
            text[k, w] = f"{dt:%a %d %b %Y}<br>{'No trades' if np.isnan(v) else fmt_money(v)}"
    lim = float(np.nanmax(np.abs(z))) if np.isfinite(np.nanmax(np.abs(z))) else 1.0
    fig.add_trace(go.Heatmap(
        z=z, text=text, hoverinfo="text", zmin=-lim, zmax=lim, xgap=3, ygap=3,
        colorscale=[[0, neg], [0.5, p["div_mid"]], [1, pos]],
        colorbar=dict(title="$", thickness=8, tickfont=dict(color=p["muted"])),
        y=["Mon", "Tue", "Wed", "Thu", "Fri"],
        x=[f"{(start + pd.Timedelta(weeks=int(w))):%d %b}" for w in range(z.shape[1])],
    ))
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)), hovermode="closest")
    fig.update_yaxes(autorange="reversed", showgrid=False)
    fig.update_xaxes(showgrid=False, tickangle=-45)
    return theme(fig, mode, 240)


def r_histogram(df: pd.DataFrame, mode: str = "dark", bins: int = 30,
                title: str = "R-multiple distribution") -> go.Figure:
    p = pal(mode)
    fig = go.Figure()
    r = df["r_multiple"].dropna() if "r_multiple" in df else pd.Series(dtype=float)
    if r.empty:
        fig.add_annotation(text="Record a stop on your trades to see R", showarrow=False,
                           font=dict(color=p["muted"]))
        return theme(fig, mode, 300)
    fig.add_trace(go.Histogram(x=r, nbinsx=bins, marker=dict(color=p["series"][0],
                               line=dict(color=p["surface"], width=2)),
                               hovertemplate="R %{x:.2f}<br>%{y} trades<extra></extra>", name="Trades"))
    fig.add_vline(x=0, line=dict(color=p["axis"], width=1))
    fig.add_vline(x=float(r.mean()), line=dict(color=p["series"][1], width=2),
                  annotation_text=f"mean {r.mean():+.2f}R", annotation_font_color=p["ink2"])
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)), bargap=0.05,
                      hovermode="closest", showlegend=False)
    fig.update_xaxes(title_text="R")
    return theme(fig, mode, 300)


def breakdown_bar(table: pd.DataFrame, category: str, value: str = "net_pnl",
                  mode: str = "dark", cvd_safe: bool = False, title: Optional[str] = None,
                  by_sign: bool = True) -> go.Figure:
    """Horizontal bars, one per category. by_sign colours profit/loss with the status
    pair (plus a signed label); otherwise a single series colour."""
    p = pal(mode)
    pos, neg = pnl_colors(mode, cvd_safe)
    fig = go.Figure()
    if table is None or table.empty:
        fig.add_annotation(text="Nothing to show", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 300)
    t = table.sort_values(value, ascending=True)
    vals = t[value].astype(float)
    colors = [pos if v >= 0 else neg for v in vals] if by_sign else p["series"][0]
    is_money = value in ("net_pnl", "expectancy", "gross_pnl")
    labels = [fmt_money(v) if is_money else (fmt_pct(v) if value == "win_rate" else f"{v:+.2f}")
              for v in vals]
    # positive bars label outside to the right; negative bars label inside so the
    # text never collides with the category axis on the left
    positions = ["outside" if v >= 0 else "inside" for v in vals]
    fig.add_trace(go.Bar(x=vals, y=t[category].astype(str), orientation="h",
                         marker=dict(color=colors, line=dict(color=p["surface"], width=2)),
                         text=labels, textposition=positions, cliponaxis=False,
                         insidetextanchor="start",
                         textfont=dict(color=p["ink2"]),
                         customdata=np.c_[t["trades"], t["win_rate"].fillna(0) * 100] if "trades" in t else None,
                         hovertemplate="%{y}<br>%{text}<br>%{customdata[0]} trades · WR %{customdata[1]:.1f}%<extra></extra>"
                         if "trades" in t else "%{y}<br>%{text}<extra></extra>"))
    fig.add_vline(x=0, line=dict(color=p["axis"], width=1))
    fig.update_layout(title=dict(text=(title if title is not None else f"{value.replace('_', ' ').title()} by {category.replace('_', ' ')}"),
                                 font=dict(color=p["ink"], size=14)),
                      hovermode="closest", showlegend=False, bargap=0.35)
    fig.update_xaxes(title_text="$" if is_money else value)
    fig.update_yaxes(showgrid=False)
    fig = theme(fig, mode, max(260, 40 * len(t) + 80))
    fig.update_layout(margin=dict(r=90))
    return fig


def rolling_line(roll: pd.DataFrame, mode: str = "dark", window: int = 20,
                 title: Optional[str] = None, unit: str = "R") -> go.Figure:
    p = pal(mode)
    fig = go.Figure()
    if roll is None or roll.empty:
        fig.add_annotation(text="Not enough trades yet", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 280)
    fig.add_trace(go.Scatter(x=roll["time"], y=roll["rolling"], mode="lines", name=f"Rolling {window}",
                             line=dict(color=p["series"][0], width=2),
                             hovertemplate="%{x|%d %b}<br>%{y:+.2f}" + unit + "<extra></extra>"))
    fig.add_hline(y=0, line=dict(color=p["axis"], width=1))
    fig.update_layout(title=dict(text=(title if title is not None else f"Rolling {window}-trade expectancy ({unit})"),
                                 font=dict(color=p["ink"], size=14)), showlegend=False)
    return theme(fig, mode, 280)


def diverging_heatmap(pivot: pd.DataFrame, mode: str = "dark", cvd_safe: bool = False,
                      title: str = "", value_fmt: str = "$") -> go.Figure:
    """Hour x weekday, or parameter sweep grids. Diverging around zero."""
    p = pal(mode)
    pos, neg = pnl_colors(mode, cvd_safe)
    fig = go.Figure()
    if pivot is None or pivot.empty:
        fig.add_annotation(text="Nothing to show", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 300)
    z = pivot.values.astype(float)
    lim = float(np.nanmax(np.abs(z))) if np.isfinite(np.nanmax(np.abs(z))) else 1.0
    fig.add_trace(go.Heatmap(z=z, x=[str(c) for c in pivot.columns], y=[str(i) for i in pivot.index],
                             zmin=-lim, zmax=lim, xgap=2, ygap=2,
                             colorscale=[[0, neg], [0.5, p["div_mid"]], [1, pos]],
                             colorbar=dict(thickness=8, tickfont=dict(color=p["muted"])),
                             hovertemplate="%{y} · %{x}<br>" + value_fmt + "%{z:,.2f}<extra></extra>"))
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)), hovermode="closest")
    fig.update_xaxes(showgrid=False, type="category")
    fig.update_yaxes(showgrid=False, type="category", autorange="reversed")   # first row on top
    return theme(fig, mode, max(280, 28 * len(pivot) + 100))


def monte_carlo_fan(paths: np.ndarray, mode: str = "dark", starting_balance: float = 0.0,
                    threshold: float | None = None, title: str = "Monte Carlo projection") -> go.Figure:
    """Percentile fan (5/25/50/75/95) over simulated equity paths, plus a few sample paths."""
    p = pal(mode)
    fig = go.Figure()
    if paths is None or len(paths) == 0:
        fig.add_annotation(text="Need closed trades to simulate", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 360)
    eq = starting_balance + np.asarray(paths)
    x = np.arange(1, eq.shape[1] + 1)
    q = {k: np.percentile(eq, k, axis=0) for k in (5, 25, 50, 75, 95)}
    base = p["series"][0]
    fig.add_trace(go.Scatter(x=np.r_[x, x[::-1]], y=np.r_[q[95], q[5][::-1]], fill="toself",
                             fillcolor=_alpha(base, 0.12), line=dict(width=0), name="5–95%",
                             hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=np.r_[x, x[::-1]], y=np.r_[q[75], q[25][::-1]], fill="toself",
                             fillcolor=_alpha(base, 0.25), line=dict(width=0), name="25–75%",
                             hoverinfo="skip"))
    for row in eq[: min(12, len(eq))]:
        fig.add_trace(go.Scatter(x=x, y=row, mode="lines", line=dict(color=_alpha(p["ink2"], 0.25), width=1),
                                 showlegend=False, hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=x, y=q[50], mode="lines", name="Median",
                             line=dict(color=base, width=2),
                             hovertemplate="Trade %{x}<br>Median $%{y:,.0f}<extra></extra>"))
    if threshold is not None:
        fig.add_hline(y=threshold, line=dict(color=p["critical"], width=1),
                      annotation_text="drawdown limit", annotation_font_color=p["ink2"])
    fig.update_layout(title=dict(text=title, font=dict(color=p["ink"], size=14)))
    fig.update_xaxes(title_text="Trades ahead")
    fig.update_yaxes(title_text="$")
    return theme(fig, mode, 380)


def limit_bar(used_pct: float, state: str, label: str, mode: str = "dark") -> go.Figure:
    """A single horizontal bar for 'today vs daily loss limit'. State drives the colour."""
    p = pal(mode)
    color = {"green": p["good"], "amber": p["warning"], "red": p["serious"],
             "breached": p["critical"]}.get(state, p["good"])
    fig = go.Figure(go.Bar(x=[min(used_pct, 100)], y=[label], orientation="h",
                           marker=dict(color=color), text=f"{used_pct:.0f}% used",
                           textposition="inside" if used_pct > 15 else "outside",
                           textfont=dict(color=p["ink"]), hoverinfo="skip"))
    fig.add_shape(type="rect", x0=0, x1=100, y0=-0.4, y1=0.4, line=dict(color=p["axis"], width=1),
                  fillcolor=_alpha(p["ink2"], 0.06), layer="below")
    fig.update_xaxes(range=[0, 100], showgrid=False, ticksuffix="%")
    fig.update_yaxes(showgrid=False, showticklabels=False)
    fig.update_layout(margin=dict(l=8, r=8, t=8, b=24), showlegend=False)
    return theme(fig, mode, 90)


def scatter_mae_mfe(df: pd.DataFrame, mode: str = "dark", cvd_safe: bool = False) -> go.Figure:
    """MAE vs MFE per trade; winners and losers as two series with a surface ring."""
    p = pal(mode)
    pos, neg = pnl_colors(mode, cvd_safe)
    fig = go.Figure()
    d = df.dropna(subset=["mae", "mfe"]) if {"mae", "mfe"} <= set(df.columns) else pd.DataFrame()
    if d.empty:
        fig.add_annotation(text="MAE/MFE not recorded", showarrow=False, font=dict(color=p["muted"]))
        return theme(fig, mode, 340)
    for name, mask, color in (("Winners", d["net_pnl"] > 0, pos), ("Losers", d["net_pnl"] <= 0, neg)):
        s = d[mask]
        fig.add_trace(go.Scatter(x=s["mae"], y=s["mfe"], mode="markers", name=name,
                                 marker=dict(color=color, size=9, line=dict(color=p["surface"], width=2)),
                                 customdata=s["net_pnl"],
                                 hovertemplate="MAE $%{x:,.0f} · MFE $%{y:,.0f}<br>P&L %{customdata:+,.2f}<extra></extra>"))
    fig.update_layout(title=dict(text="Adverse vs favourable excursion", font=dict(color=p["ink"], size=14)),
                      hovermode="closest")
    fig.update_xaxes(title_text="MAE $ (how far it went against you)")
    fig.update_yaxes(title_text="MFE $ (how far it went your way)")
    return theme(fig, mode, 360)


def _alpha(hex_color: str, a: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{a})"
