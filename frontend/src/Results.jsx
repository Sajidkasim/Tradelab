import React, { useEffect, useState } from "react";
import { SlidersHorizontal, RotateCcw, ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { fetchResultSamples } from "./resultSamples";
import {
  Button,
  Select,
  Segments,
  Checkboxes,
  Stat,
  Chart,
  Empty,
  Notice,
  Field,
} from "./components";
import { percent, rvalue, money, number, unknown } from "./format";

const initial = {
  scope: "All",
  strategy: "All strategies",
  direction: "Both",
  level: "Any level",
  timeframe: "Any timeframe",
  entry_timeframe: "Any timeframe",
  confirmations: [],
  news: "Any news status",
  condition: "Any condition",
  window: "New York",
  symbol: "All markets",
  account_id: null,
  start: null,
  end: null,
};
const dimensions = [
  { value: "setup_name", label: "Strategy" },
  { value: "edge_level", label: "Key level" },
  { value: "edge_confirmation_set", label: "Confirmations" },
  { value: "direction", label: "Buy / sell" },
  { value: "edge_window", label: "Session" },
  { value: "edge_news", label: "News" },
  { value: "edge_entry_timeframe", label: "Entry timeframe" },
  { value: "edge_timeframe", label: "Level timeframe" },
];

export default function Results({
  meta,
  trades,
  revision,
  mode,
  onTrades,
  scope,
  setScope,
}) {
  const [setupFilters, setFilters] = useState(initial),
    [explore, setExplore] = useState(false),
    [detail, setDetail] = useState(false),
    [comparison, setComparison] = useState("setup_name");
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const filters = React.useMemo(
    () => ({ ...setupFilters, scope }),
    [setupFilters, scope],
  );
  const change = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(
      () =>
        fetchResultSamples(
          api,
          filters,
          { mode, detail, comparison },
          controller.signal,
        )
          .then((result) => {
            if (!controller.signal.aborted) setData(result);
          })
          .catch((e) => {
            if (e.name !== "AbortError" && !controller.signal.aborted) {
              setError(e.message);
              setData(null);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setBusy(false);
          }),
      120,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, mode, revision, detail, comparison]);
  const values = (base, field) => [
    ...new Set([
      ...base,
      ...trades.map((t) => t.labels?.[field]).filter(Boolean),
    ]),
  ];
  const samples =
    filters.scope === "All"
      ? ["Backtesting", "Forward testing"]
      : [filters.scope];
  return (
    <>
      <h2 className="section-heading">Results</h2>
      <div className="toolbar">
        <Segments
          values={["All", "Backtesting", "Forward testing"]}
          value={filters.scope}
          onChange={setScope}
          label="Data source"
        />
        <Button
          className={explore ? "active" : ""}
          onClick={() => setExplore(!explore)}
          aria-expanded={explore}
        >
          <SlidersHorizontal size={16} /> Explore a strategy
        </Button>
      </div>
      <div className={`results-grid ${explore ? "exploring" : ""}`}>
        {explore && (
          <aside className="explorer card">
            <div className="section-title">
              <h2>Explore a strategy</h2>
              <button
                className="icon-button"
                aria-label="Reset setup filters"
                onClick={() =>
                  setFilters({
                    ...initial,
                    scope: filters.scope,
                  })
                }
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <Select
              label="Strategy"
              values={["All strategies", ...meta.strategies, "Unclassified"]}
              value={filters.strategy}
              onChange={(e) => change("strategy", e.target.value)}
            />
            <div className="field">
              <span>Buy or sell?</span>
              <Segments
                values={[
                  { value: "Both", label: "Both" },
                  { value: "long", label: "Buy" },
                  { value: "short", label: "Sell" },
                ]}
                value={filters.direction}
                onChange={(v) => change("direction", v)}
              />
            </div>
            <Select
              label="Key level / PDA"
              values={values(
                ["Any level", ...meta.playbook.levels, unknown],
                "level",
              )}
              value={filters.level}
              onChange={(e) => change("level", e.target.value)}
            />
            <div className="form-grid two">
              <Select
                label="Level timeframe"
                values={values(
                  ["Any timeframe", ...meta.timeframes, unknown],
                  "timeframe",
                ).map((option) =>
                  option === "Any timeframe"
                    ? { value: option, label: "Any" }
                    : option,
                )}
                value={filters.timeframe}
                onChange={(e) => change("timeframe", e.target.value)}
              />
              <Select
                label="Entry timeframe"
                values={values(
                  ["Any timeframe", ...meta.timeframes, unknown],
                  "entry_timeframe",
                ).map((option) =>
                  option === "Any timeframe"
                    ? { value: option, label: "Any" }
                    : option,
                )}
                value={filters.entry_timeframe}
                onChange={(e) => change("entry_timeframe", e.target.value)}
              />
            </div>
            <div className="field">
              <span>Confirmations</span>
              <Checkboxes
                values={[
                  ...new Set([
                    ...meta.confirmations,
                    ...trades.flatMap((t) => t.labels?.confirmations || []),
                  ]),
                ]}
                selected={filters.confirmations}
                onChange={(v) => change("confirmations", v)}
              />
              <small>Every selected confirmation must be present.</small>
            </div>
            <details className="disclosure">
              <summary>Session, news & market</summary>
              <div>
                <Select
                  label="Session window"
                  values={[
                    "New York",
                    "All sessions",
                    ...meta.windows,
                    "Other",
                  ]}
                  value={filters.window}
                  onChange={(e) => change("window", e.target.value)}
                />
                <small>
                  New York: 08:30–16:00 ET, adjusted for daylight saving.
                </small>
                <Select
                  label="News"
                  values={values(
                    ["Any news status", ...meta.news, unknown],
                    "news",
                  )}
                  value={filters.news}
                  onChange={(e) => change("news", e.target.value)}
                />
                <Select
                  label="Market condition"
                  values={values(
                    ["Any condition", ...meta.conditions, unknown],
                    "condition",
                  )}
                  value={filters.condition}
                  onChange={(e) => change("condition", e.target.value)}
                />
                <Select
                  label="Market"
                  values={[
                    "All markets",
                    ...new Set(trades.map((t) => t.symbol)),
                  ]}
                  value={filters.symbol}
                  onChange={(e) => change("symbol", e.target.value)}
                />
              </div>
            </details>
            <details className="disclosure">
              <summary>Account & period</summary>
              <div>
                <Select
                  label="Account"
                  values={[
                    { value: "", label: "All accounts" },
                    ...meta.accounts.map((a) => ({
                      value: a.id,
                      label: a.name,
                    })),
                  ]}
                  value={filters.account_id || ""}
                  onChange={(e) =>
                    change(
                      "account_id",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                />
                <Field label="From · New York">
                  <input
                    type="date"
                    value={filters.start || ""}
                    onChange={(e) => change("start", e.target.value || null)}
                  />
                </Field>
                <Field label="To · New York">
                  <input
                    type="date"
                    value={filters.end || ""}
                    onChange={(e) => change("end", e.target.value || null)}
                  />
                </Field>
              </div>
            </details>
          </aside>
        )}
        <section className="results-content" aria-busy={busy}>
          {error && <Notice error>{error}</Notice>}
          <div
            className={samples.length === 2 ? "sample-pair" : "sample-single"}
          >
            {samples.map((sample) => (
              <ResultSample
                key={sample}
                sample={sample}
                data={data?.find((result) => result.sample === sample)}
                filters={filters}
                busy={busy}
                detail={detail}
                comparison={comparison}
                paired={samples.length === 2}
                onTrades={onTrades}
              />
            ))}
          </div>
          <Button
            className="detail-button"
            onClick={() => setDetail(!detail)}
            aria-expanded={detail}
          >
            {detail ? "Hide detail" : "More detail"} <ArrowUpRight size={14} />
          </Button>
          {detail && (
            <Select
              label="Compare by"
              values={dimensions}
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            />
          )}
        </section>
      </div>
    </>
  );
}

function ResultSample({
  sample,
  data,
  filters,
  busy,
  detail,
  comparison,
  paired,
  onTrades,
}) {
  const s = data?.stats;
  return (
    <section className="result-sample" aria-label={`${sample} results`}>
      {paired && <h2 className="sample-title">{sample}</h2>}
      <div className="results-caption">
        {!paired && (
          <>
            <span className="dot" />
            {sample}
            <span className="separator">/</span>
          </>
        )}
        {filters.strategy} · {filters.window}{" "}
        {filters.confirmations.length > 0 && (
          <span>/ {filters.confirmations.join(" + ")}</span>
        )}
        <span className="update-state" role="status">
          {busy ? "Updating…" : "Up to date"}
        </span>
      </div>
      <div className="card chart-card">
        <div className="section-title">
          <div>
            <h2>Equity</h2>
            <p>USD · New York time</p>
          </div>
        </div>
        {data?.chart ? (
          <Chart figure={data.chart} height={paired ? 290 : 380} />
        ) : (
          <Empty
            title={busy && !data ? "Loading your results" : "No trades yet"}
            action={
              !busy && (
                <Button onClick={onTrades} variant="primary">
                  Add or import trades <ArrowUpRight size={16} />
                </Button>
              )
            }
          >
            {busy && !data
              ? "Opening your private sample…"
              : "Add or import trades to see your results."}
          </Empty>
        )}
      </div>
      <div className={`stats card ${busy ? "updating" : ""}`}>
        <Stat
          label="Win rate"
          value={s ? percent(s.win_rate) : "—"}
          caption={
            s?.small_sample
              ? "Small sample · fewer than 30 trades"
              : "Break-even trades excluded"
          }
        />
        <Stat
          label="Average R"
          value={s ? rvalue(s.avg_r) : "—"}
          caption={
            s
              ? `R recorded on ${data.r_count} of ${s.trades} trades`
              : "Realised return on risk"
          }
        />
        <Stat
          label="Trade count"
          value={s ? number(s.trades) : "—"}
          caption="Matching closed trades"
        />
      </div>
      {detail && s && (
        <div className="card more-detail">
          <div className="stats compact">
            <Stat label="Net result" value={money(s.net_pnl)} />
            <Stat label="Profit factor" value={number(s.profit_factor)} />
            <Stat label="Maximum drawdown" value={money(s.max_drawdown)} />
          </div>
          <p>
            {s.wins} wins · {s.losses} losses · {s.scratches} break-even. 95%
            win-rate interval: {percent(s.win_rate_ci[0])}–
            {percent(s.win_rate_ci[1])}.
          </p>
          <div className="goal">
            <span>{data.collection_count} / 1,000 trades collected</span>
            <progress value={data.collection_count} max="1000" />
            <small>A collection goal, not a guarantee of an edge.</small>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Trades</th>
                  <th>Win rate</th>
                  <th>Average R</th>
                </tr>
              </thead>
              <tbody>
                {(data.breakdown || []).map((row, i) => (
                  <tr key={i}>
                    <td>
                      {row[comparison]}
                      {row.small_sample && (
                        <small className="table-caption">Small sample</small>
                      )}
                    </td>
                    <td>{row.trades}</td>
                    <td>{percent(row.win_rate)}</td>
                    <td>{rvalue(row.avg_r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Historical associations need a separate forward sample before you
            rely on them.
          </p>
        </div>
      )}
    </section>
  );
}
