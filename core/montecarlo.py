"""Monte Carlo edge stress test on R-multiples.

Answers two separate questions from a chronological list of closed-trade R results:

1. *Is the edge real or luck?*  A bootstrap hypothesis test on the mean R. The
   null distribution is built by resampling the trades after shifting them to a
   zero mean, so it keeps the real skew of trading returns (small losses, large
   winners) instead of assuming a bell curve.
2. *What can the next N trades look like?*  Thousands of alternate futures are
   resampled from the same trades to estimate drawdown odds, outcome ranges and
   losing streaks.

Two resampling methods are supported:

- ``block`` (default): the stationary bootstrap (Politis & Romano, 1994). Trades
  are drawn in runs of random length, which preserves streaks/clustering — the
  honest choice when wins and losses come in bunches.
- ``iid``: every trade is drawn independently (classic shuffle).

Results are deterministic for the same inputs (seed derived from the data) so
the numbers do not jump around on reload. Pure numpy; no web framework imports.
"""
from __future__ import annotations

import hashlib
import math
from typing import Iterator, Literal, Sequence

import numpy as np

Method = Literal["block", "iid"]

MIN_TRADES = 20            # below this no verdict is given
CONFIDENT_TRADES = 30      # a "strong" verdict also needs at least this many
DEFAULT_SIMS = 5000
EDGE_RESAMPLES = 4000
MAX_CHART_POINTS = 120
SAMPLE_PATHS = 32
DRAWDOWN_LADDER = (3.0, 5.0, 10.0, 15.0, 20.0, 30.0)
_CHUNK_CELLS = 2_000_000   # bound per-chunk memory (~8–16 MB) on the 2 GB host


def block_length(n: int) -> int:
    """Mean block length for the stationary bootstrap (≈ n^(1/3), clamped)."""
    return int(min(10, max(2, round(n ** (1 / 3)))))


def _seed(values: np.ndarray, *params) -> int:
    digest = hashlib.sha256(values.astype("<f8").tobytes())
    digest.update(repr(params).encode())
    return int.from_bytes(digest.digest()[:8], "little")


def _indices(rng: np.random.Generator, n: int, sims: int, length: int,
             method: Method, block: int) -> np.ndarray:
    """Resampled trade indices, shape (sims, length)."""
    if method == "iid" or n < 3 or block <= 1:
        return rng.integers(0, n, size=(sims, length), dtype=np.int32)
    # Stationary bootstrap, vectorised: each step restarts at a random trade with
    # probability 1/block, otherwise continues to the next trade (circularly).
    restart = rng.random((sims, length), dtype=np.float32) < np.float32(1.0 / block)
    restart[:, 0] = True
    cols = np.arange(length, dtype=np.int32)
    last = np.maximum.accumulate(np.where(restart, cols, 0), axis=1)
    fresh = rng.integers(0, n, size=(sims, length), dtype=np.int32)
    start = np.take_along_axis(fresh, last, axis=1)
    return ((start + (cols - last)) % n).astype(np.int32)


def _chunks(rng, values, sims, length, method, block) -> Iterator[np.ndarray]:
    """Yield resampled R paths in memory-bounded chunks."""
    per = max(1, _CHUNK_CELLS // max(1, length))
    done = 0
    while done < sims:
        size = min(per, sims - done)
        yield values[_indices(rng, len(values), size, length, method, block)]
        done += size


def _permutation_chunks(rng: np.random.Generator, values: np.ndarray, sims: int) -> Iterator[np.ndarray]:
    """Yield random permutations (without replacement) of `values` in bounded memory."""
    n = len(values)
    per = max(1, _CHUNK_CELLS // max(1, n))
    done = 0
    while done < sims:
        size = min(per, sims - done)
        block = np.broadcast_to(values, (size, n))
        yield rng.permuted(block, axis=1)
        done += size


def _max_drawdown(cumulative: np.ndarray) -> np.ndarray:
    """Peak-to-trough drawdown per row, measured from a starting balance of 0R."""
    peaks = np.maximum.accumulate(np.maximum(cumulative, 0.0), axis=1)
    return (peaks - cumulative).max(axis=1)


def _longest_losing_run(paths: np.ndarray) -> np.ndarray:
    run = np.zeros(paths.shape[0], dtype=np.int32)
    best = np.zeros_like(run)
    for column in (paths < 0).T:
        run = np.where(column, run + 1, 0)
        np.maximum(best, run, out=best)
    return best


def _verdict(n: int, mean: float, p_value: float | None, ci_high: float | None = None) -> str:
    if n < MIN_TRADES:
        return "insufficient"
    if mean <= 0:
        # Clearly losing only when even the optimistic end of the range is below 0R.
        return "negative" if ci_high is not None and ci_high <= 0 else "none"
    if p_value is None or p_value >= 0.20:
        return "luck"
    if p_value >= 0.05:
        return "unproven"
    if p_value < 0.01 and n >= CONFIDENT_TRADES:
        return "strong"
    return "likely"


def _pct(values: np.ndarray, qs=(5, 25, 50, 75, 95)) -> dict:
    return {str(q): float(v) for q, v in zip(qs, np.percentile(values, qs))}


def _historical_drawdown(values: np.ndarray) -> float:
    cumulative = np.cumsum(values)
    return float(_max_drawdown(cumulative[None, :])[0])


def stress_test(r_values: Sequence[float], horizon: int = 100, drawdown_r: float = 10.0,
                method: Method = "block", n_sims: int = DEFAULT_SIMS) -> dict:
    """Run the full edge stress test. ``r_values`` must be in chronological order."""
    values = np.asarray([v for v in r_values if v is not None], dtype=float)
    values = values[np.isfinite(values)]
    n = int(values.size)
    horizon = int(max(1, horizon))
    drawdown_r = round(float(abs(drawdown_r)), 2)
    base = {"method": method, "n_sims": int(n_sims), "horizon": horizon,
            "drawdown_r": drawdown_r, "min_trades": MIN_TRADES}
    if n == 0:
        return {**base, "sample": {"trades": 0, "constant_r": False},
                "edge": {"verdict": "insufficient"},
                "projection": None, "drawdown": None, "history": None}

    mean = float(values.mean())
    std = float(values.std(ddof=1)) if n > 1 else 0.0
    sample = {
        "trades": n,
        "mean_r": mean,
        "std_r": std,
        "win_rate": float((values > 0).mean()),
        "net_r": float(values.sum()),
        "sqn": float(math.sqrt(min(n, 100)) * mean / std) if std > 0 else None,
        "block_length": block_length(n) if method == "block" else 1,
        "constant_r": bool(n >= 2 and std == 0),
    }
    if n < 2 or std == 0:
        return {**base, "sample": sample,
                "edge": {"verdict": "insufficient" if n < MIN_TRADES else ("none" if mean <= 0 else "unproven")},
                "projection": None, "drawdown": None, "history": None}

    block = sample["block_length"]
    rng = np.random.default_rng(_seed(values, horizon, method, n_sims))

    # ---- 1. Is the edge real? -------------------------------------------------
    resamples = EDGE_RESAMPLES if n <= 500 else EDGE_RESAMPLES // 2   # bound CPU on long samples
    boot_means = np.concatenate([c.mean(axis=1) for c in
                                 _chunks(rng, values, resamples, n, method, block)])
    centred = values - mean
    null_means = np.concatenate([c.mean(axis=1) for c in
                                 _chunks(rng, centred, resamples, n, method, block)])
    p_value = float((1 + np.count_nonzero(null_means >= mean)) / (resamples + 1))
    lo, hi = np.percentile(boot_means, [2.5, 97.5])
    needed = None
    if mean > 0:
        needed = int(math.ceil((1.645 * std / mean) ** 2))  # one-sided 95% on the mean
    edge = {
        "verdict": _verdict(n, mean, p_value, float(hi)),
        "p_value": p_value,
        "prob_positive": float((boot_means > 0).mean()),
        "ci95": [float(lo), float(hi)],
        "resamples": int(resamples),
        "trades_needed": needed,
        "more_trades_needed": max(0, needed - n) if needed is not None else None,
    }

    # ---- 2. Next `horizon` trades -------------------------------------------
    paths = values[_indices(rng, n, n_sims, horizon, method, block)].astype(np.float32)
    cumulative = np.cumsum(paths, axis=1)
    final = cumulative[:, -1].astype(float)
    dd = _max_drawdown(cumulative).astype(float)
    streak = _longest_losing_run(paths)

    steps = np.unique(np.linspace(0, horizon, min(horizon + 1, MAX_CHART_POINTS)).round().astype(int))
    with_start = np.concatenate([np.zeros((n_sims, 1), dtype=np.float32), cumulative], axis=1)
    sampled = with_start[:, steps]
    band_q = (5, 25, 50, 75, 95)
    bands = {str(q): row.round(4).tolist() for q, row in zip(band_q, np.percentile(sampled, band_q, axis=0))}
    order = np.argsort(final, kind="stable")
    picks = order[np.linspace(0, n_sims - 1, SAMPLE_PATHS).round().astype(int)]
    projection = {
        "steps": steps.tolist(),
        "bands": bands,
        "paths": sampled[picks].round(3).tolist(),
        "final": _pct(final),
        "prob_profit": float((final > 0).mean()),
        "expected_r": float(mean * horizon),
    }

    ladder = sorted(set(DRAWDOWN_LADDER) | {drawdown_r})
    se = lambda p: float(math.sqrt(max(p * (1 - p), 0.0) / n_sims))
    target = float((dd >= drawdown_r).mean())
    drawdown = {
        "ladder": [{"r": r, "prob": float((dd >= r).mean())} for r in ladder],
        "target": {"r": drawdown_r, "prob": target, "standard_error": se(target)},
        "max_dd": _pct(dd),
        "losing_streak": {"median": int(np.median(streak)), "p95": int(np.percentile(streak, 95))},
    }

    # ---- 3. Has the real sequence been lucky? ---------------------------------
    # True permutation (without replacement): keeps the exact same trades and
    # tests only whether their chronological order was unusually kind or rough.
    actual_dd = _historical_drawdown(values)
    history_sims = min(n_sims, 2000 if n <= 500 else 1000)
    hist_dd = np.concatenate([_max_drawdown(np.cumsum(c, axis=1)) for c in
                              _permutation_chunks(rng, values, history_sims)])
    history = {
        "actual_max_dd": actual_dd,
        "worse_share": float((hist_dd > actual_dd + 1e-9).mean()),
        "typical_max_dd": float(np.median(hist_dd)),
        "permutations": int(history_sims),
    }
    return {**base, "sample": sample, "edge": edge, "projection": projection,
            "drawdown": drawdown, "history": history}
