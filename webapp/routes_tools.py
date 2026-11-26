"""Risk matrix and position-sizing calculator routes."""
from __future__ import annotations

from fastapi import Body, Depends, Request

from .schemas import MonteCarloRequest, PositionSize


def mount(app, workspace, db):
    @app.post("/api/learn/risk-matrix")
    def learn_risk_matrix(
        balance: float = Body(gt=0, le=1_000_000_000),
        risk_percent: float = Body(gt=0, le=100),
        stop_ticks: int = Body(ge=1, le=4_000_000),
    ):
        from core import risk
        from core.instruments import instrument_map

        instruments = instrument_map()
        results = {}
        for symbol in ("NQ", "MNQ"):
            instrument = instruments[symbol]
            results[symbol] = risk.position_size(
                0,
                stop_ticks * instrument.tick_size,
                instrument.multiplier,
                instrument.tick_size,
                balance,
                risk_pct=risk_percent,
            )
        return results

    @app.post("/api/lab/monte-carlo")
    def lab_monte_carlo(payload: MonteCarloRequest, member=Depends(workspace)):
        """Bootstrap stress test of the filtered sample's R-multiples (read-only)."""
        import numpy as np
        from core import metrics, montecarlo

        # chart_first resolves "All" to the requested sample so sources never pool.
        filters = payload.filters.model_copy(update={"combined": False, "chart_first": True, "detail": False})
        _, matched, scope, _ = app.state.workspaces.select(member["key"], filters)
        closed = metrics.closed(matched)
        curve = metrics.r_equity(closed)["values"]
        returns = np.diff(np.asarray(curve, dtype=float)) if len(curve) > 1 else []
        result = montecarlo.stress_test(returns, horizon=payload.horizon,
                                        drawdown_r=payload.drawdown_r, method=payload.method)
        result["scope"] = scope
        result["closed_trades"] = int(len(closed))
        result["missing_risk"] = int(len(closed) - len(returns))
        return result

    @app.post("/api/tools/position-size")
    def position_size(payload: PositionSize, request: Request, member=Depends(workspace)):
        from core import risk
        from .workspaces import clean

        database = db(request, member)
        account = next((item for item in database.accounts() if item.id == payload.account_id), None)
        instrument = database.instruments().get(payload.symbol)
        if account is None or instrument is None:
            raise ValueError("Choose a valid market from your lab.")
        if payload.entry == payload.stop:
            raise ValueError("Entry and stop must be different prices.")
        return clean(
            risk.position_size(
                payload.entry,
                payload.stop,
                instrument.multiplier,
                instrument.tick_size,
                account.starting_balance,
                risk_dollars=payload.risk_dollars,
                max_contracts=account.max_contracts,
                commission_per_contract=instrument.commission_per_contract,
            )
        )
