import React, { useEffect, useState } from "react";
import { RotateCcw, ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { fetchResultSamples } from "./resultSamples";
import LabHistory from "./LabHistory";
import SavedSetups from "./SavedSetups";
import {
  Button,
  Select,
  Segments,
  Checkboxes,
  Stat,
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
  target_rr: "Any RR",
  weekday: "All days",
  confirmations: [],
  news: "Any news status",
  condition: "Any condition",
  window: "All sessions",
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
  studyId = "",
  refresh,
  toast,
}) {
  const [setupFilters, setFilters] = useState(initial),
    [detail, setDetail] = useState(false),
    [comparison, setComparison] = useState("setup_name");
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const filters = React.useMemo(
    () => ({ ...setupFilters, scope, study_id: studyId }),
    [setupFilters, scope, studyId],
  );
  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      if (
        current.timeframe !== "Any timeframe" &&
        current.timeframe !== unknown &&
        !meta.level_timeframes.includes(current.timeframe)
      )
        next.timeframe = "Any timeframe";
      if (
        current.entry_timeframe !== "Any timeframe" &&
        current.entry_timeframe !== unknown &&
        !meta.entry_timeframes.includes(current.entry_timeframe)
      )
        next.entry_timeframe = "Any timeframe";
      next.confirmations = current.confirmations.filter((value) =>
        meta.confirmations.includes(value),
      );
      if (
        current.strategy !== "All strategies" &&
        current.strategy !== "Unclassified" &&
        !meta.strategies.includes(current.strategy)
      )
        next.strategy = "All strategies";
      if (
        current.window !== "All sessions" &&
        !meta.windows.includes(current.window)
      )
        next.window = "All sessions";
      if (
        current.symbol !== "All markets" &&
        !trades.some((trade) => trade.symbol === current.symbol)
      )
        next.symbol = "All markets";
      return next.window === current.window &&
        next.symbol === current.symbol &&
        next.strategy === current.strategy &&
        next.timeframe === current.timeframe &&
        next.entry_timeframe === current.entry_timeframe &&
        next.confirmations.length === current.confirmations.length
        ? current
        : next;
    });
  }, [
    meta.windows,
    meta.strategies,
    meta.confirmations,
    meta.level_timeframes,
    meta.entry_timeframes,
    trades,
  ]);
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
  return (
    <>
      <div className="lab-section-heading">
        <div>
          <span className="eyebrow">Your research space</span>
          <h2 className="section-heading">Results</h2>
        </div>
      </div>
      <div className="toolbar">
        <Segments
          values={[
            "All",
            "Backtesting",
            { value: "Forward testing", label: "Live trading" },
          ]}
          value={filters.scope}
          onChange={setScope}
          label="Data source"
        />
        <p className="lab-source-note">
          {scope === "All"
            ? "Combined history · backtesting + live trades"
            : scope === "Backtesting"
              ? "Practice and replay trades"
              : "Your actual trading results"}
        </p>
      </div>
      <div className="results-grid exploring lab-grid">
        <aside className="explorer card">
          <div className="section-title">
            <div>
              <span className="lab-step">01 / EXPLORE</span>
              <h2>Explore a strategy</h2>
            </div>
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
          <SavedSetups
            items={meta.saved_setups || []}
            filters={filters}
            refresh={refresh}
            toast={toast}
            onApply={(saved) => {
              setFilters({ ...initial, ...saved });
              setScope(saved.scope || scope);
            }}
          />
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
              values={["Any timeframe", ...meta.level_timeframes, unknown].map(
                (option) =>
                  option === "Any timeframe"
                    ? { value: option, label: "Any" }
                    : option,
              )}
              value={filters.timeframe}
              onChange={(e) => change("timeframe", e.target.value)}
            />
            <Select
              label="Entry timeframe"
              values={["Any timeframe", ...meta.entry_timeframes, unknown].map(
                (option) =>
                  option === "Any timeframe"
                    ? { value: option, label: "Any" }
                    : option,
              )}
              value={filters.entry_timeframe}
              onChange={(e) => change("entry_timeframe", e.target.value)}
            />
          </div>
          <Select
            label="Target RR"
            values={[
              "Any RR",
              ...new Set([
                ...(meta.target_rrs || []),
                ...trades
                  .map((trade) => trade.target_rr)
                  .filter((value) => value && value !== unknown),
              ]),
            ]}
            value={filters.target_rr}
            onChange={(e) => change("target_rr", e.target.value)}
          />
          <Select
            label="Day"
            values={["All days", ...(meta.weekdays || [])]}
            value={filters.weekday}
            onChange={(e) => change("weekday", e.target.value)}
          />
          <small className="muted">
            Entry date ·{" "}
            {meta.lab_settings.timezone === "Etc/GMT+4"
              ? "fixed UTC−4"
              : "New York time"}
            . No day tag needed.
          </small>
          <div className="field">
            <span>Confirmations</span>
            <Checkboxes
              values={meta.confirmations}
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
                  "All sessions",
                  ...meta.lab_settings.sessions.map((session) => ({
                    value: session.name,
                    label: `${session.name} · ${session.start}–${session.end}`,
                  })),
                ]}
                value={filters.window}
                onChange={(e) => change("window", e.target.value)}
              />
              <small>
                {meta.lab_settings.timezone === "Etc/GMT+4"
                  ? "All session times use fixed UTC−4."
                  : "All session times use New York's clock, including daylight saving."}{" "}
                Entry time determines the session.
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
              <small>
                Markets appear from your saved trades, including imports. Log
                ES, gold or another symbol and it will appear here.
              </small>
              <small className="muted">
                Not recorded means a trade has not been labelled. Edit these
                options in My journal → Lab settings.
              </small>
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
        <section className="results-content" aria-busy={busy}>
          {error && <Notice error>{error}</Notice>}
          <ResultSample
            sample={scope}
            data={data?.find((result) => result.sample === scope)}
            filters={filters}
            busy={busy}
            detail={detail}
            comparison={comparison}
            onTrades={onTrades}
            palette={meta.palette[mode]}
          />
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
  onTrades,
  palette,
}) {
  const s = data?.stats;
  const model = data?.fixed_rr;
  const useFixed = model?.complete && data.r_count === 0;
  return (
    <section
      className="result-sample"
      aria-label={`${sample === "All" ? "Combined" : sample === "Forward testing" ? "Live trading" : sample} results`}
    >
      <div className="results-caption">
        <span className="lab-sample-label">
          {sample === "All"
            ? "Combined history"
            : sample === "Forward testing"
              ? "Live trading"
              : sample}
        </span>
        <span className="separator">/</span>
        {filters.strategy} · {filters.window}{" "}
        {filters.weekday !== "All days" && <span>/ {filters.weekday}</span>}
        {filters.confirmations.length > 0 && (
          <span>/ {filters.confirmations.join(" + ")}</span>
        )}
        <span className="update-state" role="status">
          {busy ? "Updating…" : "Up to date"}
        </span>
      </div>
      <div className="card chart-card history-card">
        <div className="section-title">
          <div>
            <span className="lab-step">02 / OBSERVE</span>
            <h2>Your trading history</h2>
            <p>Closed trades · New York time</p>
          </div>
        </div>
        {data?.chart ? (
          <>
            <div className="history-headline">
              <div>
                <span>Cumulative result</span>
                <strong
                  key={`${s.net_pnl}`}
                  className={s.net_pnl < 0 ? "history-loss" : "history-gain"}
                >
                  {money(s.net_pnl)}
                </strong>
              </div>
              <span className="history-source">
                {sample === "All"
                  ? "Backtesting + live"
                  : sample === "Forward testing"
                    ? "Live trading"
                    : "Backtesting"}
              </span>
            </div>
            <LabHistory
              figure={data.chart}
              latest={data.chart_latest}
              palette={palette}
              netResult={s.net_pnl}
            />
          </>
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
      <div className="lab-summary-label">
        <span className="lab-step">03 / UNDERSTAND</span>
        <span>Results for your selection</span>
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
          label={useFixed ? "Average R · fixed test" : "Average R"}
          value={s ? rvalue(useFixed ? model.avg_r : s.avg_r) : "—"}
          caption={
            useFixed ? (
              `${model.count} tagged backtests · before costs`
            ) : s ? (
              <>
                {`R recorded on ${data.r_count} of ${s.trades} trades`}
                {data.r_count < s.trades && (
                  <button
                    className="inline-action risk-review-link"
                    onClick={onTrades}
                  >
                    Review missing risk
                  </button>
                )}
              </>
            ) : (
              "Realised return on risk"
            )
          }
        />
        <Stat
          label="Trades analysed"
          value={s ? number(s.trades) : "—"}
          caption="Matching closed trades"
        />
      </div>
      <details className="r-explainer">
        <summary>What does Average R mean?</summary>
        <p>
          R measures a trade against its original risk. +1R means you earned the
          amount you risked; −1R means you lost it. Average R is the mean
          realised R across trades with recorded risk. For example, +0.25R
          equals an average $25 gain when each trade risks $100.
          {useFixed &&
            " This selection uses your confirmed full-target/full-stop model. The displayed average comes from those fixed outcomes before costs, rather than recorded dollar risk. Saved dollar results and actual R values are unchanged."}
        </p>
      </details>
      {detail && s && (
        <div className="card more-detail">
          <div className="stats compact">
            <Stat label="Net result" value={money(s.net_pnl)} />
            <Stat label="Profit factor" value={number(s.profit_factor)} />
            <Stat label="Maximum drawdown" value={money(s.max_drawdown)} />
            {useFixed && (
              <Stat
                label="Recorded average R"
                value={rvalue(s.avg_r)}
                caption={`Original risk recorded on ${data.r_count} trades`}
              />
            )}
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
            Use the source switch to compare backtesting with your live trading
            history.
          </p>
        </div>
      )}
    </section>
  );
}
