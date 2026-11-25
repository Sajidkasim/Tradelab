import { useJournalClock } from "./JournalClock";
import React, { useEffect, useState } from "react";
import { RotateCcw, ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { api } from "./api";
import { fetchResultSamples } from "./resultSamples";
import CustomTradeFields from "./CustomTradeFields";
import LabHistory from "./LabHistory";
import SavedSetups from "./SavedSetups";
import { FilterChips } from "./ExploreControls";
import VocabularySelect from './VocabularySelect';
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
  custom_fields: {},
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
  { value: "edge_timeframe", label: "Key level timeframe" },
];

export default function Results({
  meta,
  revision,
  mode,
  onTrades,
  filterEditor,
  onCloseFilterEditor,
  scope,
  setScope,
  refresh,
  toast,
}) {
  const { timezone: journalZone, clockName } = useJournalClock();
  const [setupFilters, setFilters] = useState(initial),
    [detail, setDetail] = useState(false),
    [comparison, setComparison] = useState("setup_name"),
    [filtersOpen, setFiltersOpen] = useState(true);
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const filters = React.useMemo(
    () => ({
      ...setupFilters, scope, study_id: "", account_id: null,
      custom_fields: Object.fromEntries((meta.custom_trade_fields || [])
        .filter(({ id }) => setupFilters.custom_fields?.[id]?.length)
        .map(({ id }) => [id, setupFilters.custom_fields[id]])),
    }),
    [setupFilters, scope, meta.custom_trade_fields],
  );
  const activeFilterCount = React.useMemo(() => {
    const keys = ["strategy", "direction", "level", "timeframe", "entry_timeframe", "target_rr", "weekday", "news", "condition", "window", "symbol", "start", "end"];
    const base = keys.filter((key) => filters[key] !== initial[key]).length;
    const custom = Object.values(filters.custom_fields || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    return base + filters.confirmations.length + custom;
  }, [filters]);
  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      if (current.level !== 'Any level' && !meta.playbook.levels.includes(current.level))
        next.level = 'Any level';
      if (
        current.timeframe !== "Any timeframe" &&
        !meta.level_timeframes.includes(current.timeframe)
      )
        next.timeframe = "Any timeframe";
      if (
        current.entry_timeframe !== "Any timeframe" &&
        !meta.entry_timeframes.includes(current.entry_timeframe)
      )
        next.entry_timeframe = "Any timeframe";
      next.confirmations = current.confirmations.filter((value) =>
        meta.confirmations.includes(value),
      );
      if (
        current.strategy !== "All strategies" &&
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
        !meta.result_options?.symbols.includes(current.symbol)
      )
        next.symbol = "All markets";
      return next.window === current.window &&
        next.symbol === current.symbol &&
        next.strategy === current.strategy && next.level === current.level &&
        next.timeframe === current.timeframe &&
        next.entry_timeframe === current.entry_timeframe &&
        next.confirmations.length === current.confirmations.length
        ? current
        : next;
    });
  }, [
    meta.windows,
    meta.result_options,
    meta.strategies,
    meta.playbook.levels,
    meta.archived_choices,
    meta.confirmations,
    meta.level_timeframes,
    meta.entry_timeframes,
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
      ...(meta.result_options?.[field] || []),
    ]),
  ];
  const quickStrategies = (meta.strategies || []).slice(0, 6);
  return (
    <>
      <div className="lab-section-heading">
        <div>
          <h2 className="section-heading">Results</h2>
        </div>
      </div>
      <div className="toolbar lab-studio-toolbar">
        <Segments
          values={[
            "All",
            "Backtesting",
            { value: "Forward testing", label: "Live" },
          ]}
          value={filters.scope}
          onChange={setScope}
          label="Data source"
        />
        <button
          type="button"
          className={`lab-filter-toggle${filtersOpen ? " is-open" : ""}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>{filtersOpen ? "Hide filters" : "Show filters"}</span>
          {activeFilterCount > 0 && (
            <span className="lab-filter-count" aria-label={`${activeFilterCount} active filters`}>
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
      {quickStrategies.length > 0 && (
        <div className="lab-strategy-ribbon" role="group" aria-label="Quick strategy switch">
          <button
            type="button"
            className={`lab-strategy-pill${filters.strategy === "All strategies" ? " is-active" : ""}`}
            aria-pressed={filters.strategy === "All strategies"}
            onClick={() => change("strategy", "All strategies")}
          >
            All setups
          </button>
          {quickStrategies.map((name) => (
            <button
              key={name}
              type="button"
              className={`lab-strategy-pill${filters.strategy === name ? " is-active" : ""}`}
              aria-pressed={filters.strategy === name}
              onClick={() => change("strategy", name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className={`results-grid exploring lab-grid${filtersOpen ? "" : " is-filters-collapsed"}`}>
        <aside className="explorer card" hidden={!filtersOpen}>
          <div className="section-title">
            <div>
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
            requested={filterEditor}
            onCloseRequested={onCloseFilterEditor}
            filters={filters}
            refresh={refresh}
            toast={toast}
            onApply={(saved) => {
              setFilters({ ...initial, ...saved });
              setScope(saved.scope || scope);
            }}
          />
          <VocabularySelect
            data-tour="explore"
            label="Strategy"
            values={["All strategies", ...meta.strategies]}
            archived={meta.archived_choices?.strategies}
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
          <VocabularySelect searchable
            label="Key level"
            values={["Any level", ...meta.playbook.levels]}
            archived={meta.archived_choices?.levels}
            value={filters.level}
            onChange={(e) => change("level", e.target.value)}
          />
          <VocabularySelect
            label="Key level timeframe"
            archived={meta.archived_choices?.level_timeframes}
            values={[
              { value: "Any timeframe", label: "Any" },
              ...meta.level_timeframes,
            ]}
            value={filters.timeframe}
            onChange={(e) => change("timeframe", e.target.value)}
          />
          <VocabularySelect
            label="Entry timeframe"
            archived={meta.archived_choices?.entry_timeframes}
            values={[
              { value: "Any timeframe", label: "Any" },
              ...meta.entry_timeframes,
            ]}
            value={filters.entry_timeframe}
            onChange={(e) => change("entry_timeframe", e.target.value)}
          />
          <CustomTradeFields
            definitions={meta.custom_trade_fields}
            value={filters.custom_fields}
            onChange={(value) => change("custom_fields", value)}
            filtering
          />
          <div className="field">
            <span>Confirmations</span>
            <Checkboxes
              values={meta.confirmations}
              selected={filters.confirmations}
              onChange={(v) => change("confirmations", v)}
            />
            <small>Every selected confirmation must be present.</small>
          </div>
          <Select
            label="Target RR"
            values={[
              "Any RR",
              ...new Set([
                ...(meta.target_rrs || []),
                ...(meta.result_options?.target_rrs || []),
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
              : meta.lab_settings.timezone === "Europe/London" ? "UK time" : "New York time"}
          </small>
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
                  : meta.lab_settings.timezone === "Europe/London" ? "All session times use the UK clock, including GMT/BST." : "All session times use New York's clock, including daylight saving."}{" "}
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
                  ...(meta.result_options?.symbols || []),
                ]}
                value={filters.symbol}
                onChange={(e) => change("symbol", e.target.value)}
              />
              {!meta.result_options?.symbols?.length && (
                <small>Markets appear after you save or import trades.</small>
              )}
              <small className="muted">
                Not recorded means a trade has not been labelled. Edit these
                options in My lab → Lab settings.
              </small>
            </div>
          </details>
          <details className="disclosure">
            <summary>Date range</summary>
            <div>
              <Field label={`From · ${clockName}`}>
                <input
                  type="date"
                  value={filters.start || ""}
                  onChange={(e) => change("start", e.target.value || null)}
                />
              </Field>
              <Field label={`To · ${clockName}`}>
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
          <FilterChips
            filters={filters}
            defaults={initial}
            onRemove={(key, item) =>
              change(
                key,
                key === "confirmations"
                  ? filters.confirmations.filter((v) => v !== item)
                  : initial[key],
              )
            }
            onClear={() => setFilters(initial)}
          />
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
  filterEditor,
  onCloseFilterEditor,
  palette,
}) {
  const { clockName } = useJournalClock();
  const s = data?.stats;
  const model = data?.fixed_rr;
  const useFixed = model?.complete && data.r_count === 0;
  return (
    <section
      className="result-sample"
      aria-label={`${sample === "All" ? "Combined" : sample === "Forward testing" ? "Live" : sample} results`}
    >
      <div className="results-caption">
        <span className="lab-sample-label">
          {sample === "All"
            ? "Combined history"
            : sample === "Forward testing"
              ? "Live"
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
        <div className="section-title" data-tour="results">
          <div>
            <h2>Trading history</h2>
            <p>Closed trades · {clockName} time</p>
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
                    ? "Live"
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
            title={busy && !data ? "Loading results" : "No trades yet"}
            action={
              !busy && (
                <Button onClick={onTrades} variant="primary">
                  Add or import trades <ArrowUpRight size={16} />
                </Button>
              )
            }
          >
            {busy && !data
              ? "Opening your sample…"
              : "Add or import trades to see your equity curve and stats."}
          </Empty>
        )}
      </div>
      <div className={`stats card ${busy ? "updating" : ""}`}>
        <Stat
          label="Win rate"
          value={s ? percent(s.win_rate) : "—"}
          caption={
            s?.small_sample
              ? "Small sample (< 30)"
              : "Excludes break-even"
          }
        />
        <Stat
          label={useFixed ? "Average R · fixed test" : "Average R"}
          value={s ? rvalue(useFixed ? model.avg_r : s.avg_r) : "—"}
          caption={
            useFixed ? (
              `${model.count} tagged · before costs`
            ) : s ? (
              <>
                {`${data.r_count}/${s.trades} trades with R`}
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
              "Return on risk"
            )
          }
        />
        <Stat
          label="Trades analysed"
          value={s ? number(s.trades) : "—"}
          caption="Closed trades"
        />
      </div>
      {s && s.trades > 0 && (
        <div className={`card lab-kpi-ledger ${busy ? "updating" : ""}`} aria-label="Key performance metrics">
          <div className="lab-kpi-ledger-head">
            <h3>Key performance metrics</h3>
            <span className="lab-kpi-ledger-sub">
              {s.wins}W · {s.losses}L · {s.scratches}BE
            </span>
          </div>
          <div className="lab-kpi-ledger-grid">
            <div className="lab-ledger-row">
              <span>Profit factor</span>
              <strong className={`lab-val-chip ${s.profit_factor >= 1.5 ? "is-pos" : s.profit_factor != null && s.profit_factor < 1 ? "is-neg" : ""}`}>
                {s.profit_factor != null ? number(s.profit_factor) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Max drawdown</span>
              <strong className={`lab-val-chip ${s.max_drawdown !== 0 ? "is-neg" : ""}`}>
                {s.max_drawdown > 0 ? money(-s.max_drawdown) : money(s.max_drawdown)}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Expectancy / trade</span>
              <strong className={`lab-val-chip ${s.expectancy > 0 ? "is-pos" : s.expectancy < 0 ? "is-neg" : ""}`}>
                {s.expectancy != null ? money(s.expectancy) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Payoff ratio</span>
              <strong className={`lab-val-chip ${s.payoff_ratio >= 1.5 ? "is-pos" : ""}`}>
                {s.payoff_ratio != null ? `${number(s.payoff_ratio)}×` : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Sharpe ratio</span>
              <strong className={`lab-val-chip ${s.sharpe >= 1.5 ? "is-pos" : s.sharpe != null && s.sharpe < 0 ? "is-neg" : ""}`}>
                {s.sharpe != null ? number(s.sharpe) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Sortino ratio</span>
              <strong className={`lab-val-chip ${s.sortino >= 1.5 ? "is-pos" : s.sortino != null && s.sortino < 0 ? "is-neg" : ""}`}>
                {s.sortino != null ? number(s.sortino) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>95% Win-rate CI</span>
              <strong className="lab-val-chip">
                {percent(s.win_rate_ci[0])}–{percent(s.win_rate_ci[1])}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Best / worst streak</span>
              <strong className="lab-val-chip">
                +{s.longest_win_streak}W / −{s.longest_loss_streak}L
              </strong>
            </div>
          </div>
        </div>
      )}
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
