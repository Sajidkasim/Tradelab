import { useJournalClock } from "./JournalClock";
import React, { useEffect, useState } from "react";
import {
  RotateCcw,
  ArrowUpRight,
  SlidersHorizontal,
  X,
  Home,
  FileText,
  BarChart3,
} from "lucide-react";
import { api } from "./api";
import { fetchResultSamples } from "./resultSamples";
import CustomTradeFields from "./CustomTradeFields";
import LabHistory from "./LabHistory";
import SavedSetups from "./SavedSetups";
import { FilterChips } from "./ExploreControls";
import VocabularySelect from "./VocabularySelect";
import ReturnDistributionChart from "./components/ReturnDistributionChart";
import { sitePreview } from "./SiteExperience";
import {
  Button,
  Select,
  Segments,
  Checkboxes,
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
  tourOpen = false,
}) {
  const { clockName } = useJournalClock();
  const isSiteLab = sitePreview();
  const [setupFilters, setFilters] = useState(initial),
    [detail, setDetail] = useState(false),
    [comparison, setComparison] = useState("setup_name"),
    [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const filters = React.useMemo(
    () => ({
      ...setupFilters,
      scope,
      study_id: "",
      account_id: null,
      custom_fields: Object.fromEntries(
        (meta.custom_trade_fields || [])
          .filter(({ id }) => setupFilters.custom_fields?.[id]?.length)
          .map(({ id }) => [id, setupFilters.custom_fields[id]]),
      ),
    }),
    [setupFilters, scope, meta.custom_trade_fields],
  );
  const activeFilterCount = React.useMemo(() => {
    const keys = [
      "strategy",
      "direction",
      "level",
      "timeframe",
      "entry_timeframe",
      "target_rr",
      "weekday",
      "news",
      "condition",
      "window",
      "symbol",
      "start",
      "end",
    ];
    const base = keys.filter((key) => filters[key] !== initial[key]).length;
    const custom = Object.values(filters.custom_fields || {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0,
    );
    return base + filters.confirmations.length + custom;
  }, [filters]);

  useEffect(() => {
    if (tourOpen && isSiteLab) setDrawerOpen(true);
  }, [tourOpen, isSiteLab]);

  useEffect(() => {
    if (!drawerOpen || !isSiteLab) return;
    const onKey = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, isSiteLab]);

  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      if (
        current.level !== "Any level" &&
        !meta.playbook.levels.includes(current.level)
      )
        next.level = "Any level";
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
        next.strategy === current.strategy &&
        next.level === current.level &&
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
    ...new Set([...base, ...(meta.result_options?.[field] || [])]),
  ];
  const quickStrategies = (meta.strategies || []).slice(0, 6);
  const sampleData = data?.find((result) => result.sample === scope);
  const s = sampleData?.stats;

  const explorerBody = (
    <aside
      className={`explorer card${isSiteLab ? " sl-filter-drawer" : ""}${isSiteLab && drawerOpen ? " is-open" : ""}`}
      aria-label="Filter Studio"
    >
      <div className="section-title">
        <div>
          <h2>{isSiteLab ? "Filter Studio" : "Explore a strategy"}</h2>
          {isSiteLab && (
            <p className="sl-drawer-sub">
              Slice your sample without cluttering the desk
            </p>
          )}
        </div>
        <div className="sl-drawer-head-actions">
          <button
            type="button"
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
          {isSiteLab && (
            <button
              type="button"
              className="icon-button"
              aria-label="Close Filter Studio"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={16} />
            </button>
          )}
        </div>
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
      <VocabularySelect
        searchable
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
          : meta.lab_settings.timezone === "Europe/London"
            ? "UK time"
            : "New York time"}
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
              : meta.lab_settings.timezone === "Europe/London"
                ? "All session times use the UK clock, including GMT/BST."
                : "All session times use New York's clock, including daylight saving."}{" "}
            Entry time determines the session.
          </small>
          <Select
            label="News"
            values={values(["Any news status", ...meta.news, unknown], "news")}
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
            Not recorded means a trade has not been labelled. Edit these options
            in My lab → Lab settings.
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
      {isSiteLab && (
        <div className="sl-drawer-footer">
          <button
            type="button"
            className="sl-drawer-reset"
            onClick={() => setFilters({ ...initial, scope: filters.scope })}
          >
            Reset all
          </button>
          <Button
            type="button"
            variant="primary"
            onClick={() => setDrawerOpen(false)}
          >
            Apply &amp; View Desk
          </Button>
        </div>
      )}
    </aside>
  );

  return (
    <>
      {isSiteLab && (
        <aside className="sl-page-dock" aria-label="Strategy Lab quick views">
          <button
            type="button"
            className="sl-dock-btn is-active"
            aria-label="Edge Audit"
            onClick={() =>
              document
                .getElementById("results")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Home size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="sl-dock-tip" aria-hidden="true">
              Edge Audit
            </span>
          </button>
          <button
            type="button"
            className="sl-dock-btn"
            aria-label="Jump to Trades Ledger"
            onClick={onTrades}
          >
            <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="sl-dock-tip" aria-hidden="true">
              Trades Ledger
            </span>
          </button>
          <button
            type="button"
            className={`sl-dock-btn${detail ? " is-active" : ""}`}
            aria-label="Toggle Edge Breakdown"
            onClick={() => {
              setDetail((prev) => !prev);
              requestAnimationFrame(() => {
                document
                  .getElementById("lab-breakdown")
                  ?.scrollIntoView({ behavior: "smooth" });
              });
            }}
          >
            <BarChart3 size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="sl-dock-tip" aria-hidden="true">
              Edge Breakdown
            </span>
          </button>
          <button
            type="button"
            className={`sl-dock-btn${drawerOpen ? " is-active" : ""}`}
            aria-label="Open Filter Studio"
            onClick={() => setDrawerOpen((prev) => !prev)}
          >
            <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
            {activeFilterCount > 0 && (
              <span className="sl-dock-dot" aria-hidden="true" />
            )}
            <span className="sl-dock-tip" aria-hidden="true">
              Filter Studio ({activeFilterCount})
            </span>
          </button>
        </aside>
      )}

      <div className="lab-section-heading">
        <div>
          <h2 className="section-heading">Results</h2>
        </div>
      </div>

      <div className="toolbar lab-studio-toolbar">
        <div className="sl-toolbar-left">
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
          {s && (
            <span
              className={`sl-status-pill ${
                s.trades === 0
                  ? ""
                  : s.net_pnl > 0
                    ? "is-pos"
                    : s.net_pnl < 0
                      ? "is-neg"
                      : ""
              }`}
            >
              <i aria-hidden="true" />
              {s.trades === 0
                ? "Ready to audit"
                : s.small_sample
                  ? `Small sample · ${s.trades}`
                  : s.net_pnl >= 0
                    ? "Verified Edge"
                    : "Drawdown Watch"}
            </span>
          )}
        </div>

        {isSiteLab && (
          <button
            type="button"
            className={`lab-filter-toggle${drawerOpen ? " is-open" : ""}`}
            aria-expanded={drawerOpen}
            aria-controls="sl-filter-studio"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>Filters</span>
            <span
              className="lab-filter-count"
              aria-label={`${activeFilterCount} active filters`}
            >
              {activeFilterCount}
            </span>
          </button>
        )}
      </div>

      {quickStrategies.length > 0 && (
        <div
          className="lab-strategy-ribbon"
          role="group"
          aria-label="Quick strategy switch"
        >
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

      {isSiteLab && (
        <>
          <div
            className={`sl-drawer-scrim${drawerOpen ? " is-open" : ""}`}
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div id="sl-filter-studio">{explorerBody}</div>
        </>
      )}

      <div
        className={`results-grid exploring lab-grid${isSiteLab ? " is-full-canvas" : ""}`}
      >
        {!isSiteLab && explorerBody}
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
            data={sampleData}
            filters={filters}
            busy={busy}
            detail={detail}
            onToggleDetail={() => setDetail((v) => !v)}
            comparison={comparison}
            onComparisonChange={setComparison}
            onTrades={onTrades}
            palette={meta.palette[mode]}
          />
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
  onToggleDetail,
  comparison,
  onComparisonChange,
  onTrades,
  palette,
}) {
  const { clockName } = useJournalClock();
  const s = data?.stats;
  const model = data?.fixed_rr;
  const useFixed = model?.complete && data.r_count === 0;
  const activeAvgR = s ? (useFixed ? model.avg_r : s.avg_r) : null;
  const sampleLabel =
    sample === "All"
      ? "Combined history"
      : sample === "Forward testing"
        ? "Live"
        : sample;
  const sourceLabel =
    sample === "All"
      ? "Backtesting + live"
      : sample === "Forward testing"
        ? "Live"
        : "Backtesting";

  const hasTrades = Boolean(s && s.trades > 0);
  const netPos = (s?.net_pnl ?? 0) >= 0;

  return (
    <section
      className="result-sample"
      aria-label={`${sample === "All" ? "Combined" : sample === "Forward testing" ? "Live" : sample} results`}
    >
      <div className="results-caption">
        <span className="lab-sample-label">{sampleLabel}</span>
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

      {/* ROW 1: 2-Column Editorial Edge Verdict + Key Performance Metrics Ledger */}
      <div className="sl-top-grid">
        <article className={`card sl-hero-card${busy ? " updating" : ""}`}>
          <div className="sl-hero-top">
            <button
              type="button"
              className="sl-edge-pill"
              onClick={onToggleDetail}
            >
              <span>
                {!hasTrades
                  ? "Strategy Audit"
                  : s.small_sample
                    ? `Sample · ${s.trades} trades`
                    : `Win Rate · ${percent(s.win_rate)}`}
              </span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
            <span className="sl-hero-aside">
              What matters
              <br />
              in this sample
            </span>
          </div>

          <div className="sl-hero-body">
            <span className="sl-hero-eyebrow">
              {filters.strategy.toUpperCase()} · {sourceLabel.toUpperCase()}
            </span>
            <h3 className="sl-hero-headline">
              {!hasTrades ? (
                <>
                  Ready to audit your <em>next strategy</em> sample.
                </>
              ) : s.net_pnl > 0 ? (
                <>
                  Positive expectancy held across <em>{s.trades} closed</em>{" "}
                  trades.
                </>
              ) : s.net_pnl < 0 ? (
                <>
                  Sample in drawdown — refine <em>confirmations</em> &amp; risk.
                </>
              ) : (
                <>
                  Breakeven sample across <em>{s.trades} closed</em> trades.
                </>
              )}
            </h3>

            {!hasTrades ? (
              <div className="sl-hero-empty-cta">
                <Button onClick={onTrades} variant="primary">
                  Add or import trades <ArrowUpRight size={15} />
                </Button>
              </div>
            ) : (
              <div className="sl-hero-figures">
                <div>
                  <span>Cumulative result</span>
                  <strong
                    key={`${s.net_pnl}`}
                    className={netPos ? "history-gain" : "history-loss"}
                  >
                    {money(s.net_pnl)}
                  </strong>
                </div>
                <div className="sl-hero-figures-right">
                  <span>{useFixed ? "Fixed Avg R" : "Avg Realised R"}</span>
                  <strong
                    className={
                      activeAvgR != null && activeAvgR < 0
                        ? "history-loss"
                        : activeAvgR != null && activeAvgR > 0
                          ? "history-gain"
                          : ""
                    }
                  >
                    {rvalue(activeAvgR)}
                  </strong>
                </div>
              </div>
            )}
          </div>
        </article>

        <article
          className={`card sl-metrics-card lab-kpi-ledger${busy ? " updating" : ""}`}
          aria-label="Key performance metrics"
        >
          <div className="lab-kpi-ledger-head">
            <h3>Key Performance Metrics</h3>
            <button
              type="button"
              className="sl-ledger-link"
              onClick={onToggleDetail}
              aria-expanded={detail}
            >
              {detail ? "Hide detail" : "Full breakdown ›"}
            </button>
          </div>

          <div className="lab-kpi-ledger-grid">
            <div className="lab-ledger-row">
              <span>Win Rate</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && s.win_rate != null
                    ? s.win_rate >= 0.5
                      ? "is-pos"
                      : "is-neg"
                    : ""
                }`}
              >
                {hasTrades ? percent(s.win_rate) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Sharpe Ratio</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && s.sharpe != null
                    ? s.sharpe >= 1.5
                      ? "is-pos"
                      : s.sharpe < 0
                        ? "is-neg"
                        : ""
                    : ""
                }`}
              >
                {hasTrades && s.sharpe != null ? number(s.sharpe) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>{useFixed ? "Average R · fixed" : "Average R"}</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && activeAvgR != null
                    ? activeAvgR > 0
                      ? "is-pos"
                      : activeAvgR < 0
                        ? "is-neg"
                        : ""
                    : ""
                }`}
              >
                {hasTrades ? rvalue(activeAvgR) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Max Drawdown</span>
              <strong
                className={`lab-val-chip ${hasTrades && s.max_drawdown !== 0 ? "is-neg" : ""}`}
              >
                {hasTrades
                  ? s.max_drawdown > 0
                    ? money(-s.max_drawdown)
                    : money(s.max_drawdown)
                  : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Profit Factor</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && s.profit_factor != null
                    ? s.profit_factor >= 1.5
                      ? "is-pos"
                      : s.profit_factor < 1
                        ? "is-neg"
                        : ""
                    : ""
                }`}
              >
                {hasTrades && s.profit_factor != null
                  ? number(s.profit_factor)
                  : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Sortino Ratio</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && s.sortino != null
                    ? s.sortino >= 1.5
                      ? "is-pos"
                      : s.sortino < 0
                        ? "is-neg"
                        : ""
                    : ""
                }`}
              >
                {hasTrades && s.sortino != null ? number(s.sortino) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Expectancy / Trade</span>
              <strong
                className={`lab-val-chip ${
                  hasTrades && s.expectancy != null
                    ? s.expectancy > 0
                      ? "is-pos"
                      : s.expectancy < 0
                        ? "is-neg"
                        : ""
                    : ""
                }`}
              >
                {hasTrades && s.expectancy != null ? money(s.expectancy) : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Payoff Ratio</span>
              <strong
                className={`lab-val-chip ${hasTrades && s.payoff_ratio >= 1.5 ? "is-pos" : ""}`}
              >
                {hasTrades && s.payoff_ratio != null
                  ? `${number(s.payoff_ratio)}×`
                  : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>95% Win-Rate CI</span>
              <strong className="lab-val-chip">
                {hasTrades
                  ? `${percent(s.win_rate_ci[0])}–${percent(s.win_rate_ci[1])}`
                  : "—"}
              </strong>
            </div>
            <div className="lab-ledger-row">
              <span>Trades Analysed</span>
              <strong className="lab-val-chip">
                {s ? number(s.trades) : "0"}
              </strong>
            </div>
          </div>

          <div className="sl-metrics-foot stat">
            <small>
              {hasTrades
                ? `${s.wins}W · ${s.losses}L · ${s.scratches}BE · ${
                    useFixed
                      ? `${model.count} tagged · before costs`
                      : `${data.r_count}/${s.trades} trades with R`
                  }`
                : "Closed trades · excludes break-even from win rate"}
            </small>
            {hasTrades && !useFixed && data.r_count < s.trades && (
              <button
                type="button"
                className="inline-action risk-review-link"
                onClick={onTrades}
              >
                Review missing risk
              </button>
            )}
          </div>
        </article>
      </div>

      {/* SECTION CAPTION */}
      <div className="sl-analytics-divider">
        <span>Performance Analytics</span>
        <small>Closed trades · {clockName} time</small>
      </div>

      {/* ROW 2: 50/50 Distribution Histogram + Cumulative Equity Curve */}
      <div className="sl-charts-grid">
        <ReturnDistributionChart
          distribution={data?.distribution}
          avgR={activeAvgR}
          busy={busy}
        />

        <div className="card chart-card history-card">
          <div className="section-title" data-tour="results">
            <div>
              <h2>Trading history</h2>
              <p>Cumulative equity · {clockName} time</p>
            </div>
            <span className="history-source">{sourceLabel}</span>
          </div>
          {data?.chart ? (
            <LabHistory
              figure={data.chart}
              latest={data.chart_latest}
              palette={palette}
              netResult={s.net_pnl}
            />
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
      </div>

      <div className="sl-detail-bar">
        <details className="r-explainer">
          <summary>What does Average R mean?</summary>
          <p>
            R measures a trade against its original risk. +1R means you earned
            the amount you risked; −1R means you lost it. Average R is the mean
            realised R across trades with recorded risk. For example, +0.25R
            equals an average $25 gain when each trade risks $100.
            {useFixed &&
              " This selection uses your confirmed full-target/full-stop model. The displayed average comes from those fixed outcomes before costs, rather than recorded dollar risk. Saved dollar results and actual R values are unchanged."}
          </p>
        </details>
        <Button
          className="detail-button"
          onClick={onToggleDetail}
          aria-expanded={detail}
        >
          {detail ? "Hide detail" : "More detail"} <ArrowUpRight size={14} />
        </Button>
      </div>

      {detail && (
        <div id="lab-breakdown" className="card more-detail">
          <div className="sl-breakdown-head">
            <div>
              <h3>Dimensional Edge Breakdown</h3>
              {s && (
                <p>
                  {s.wins} wins · {s.losses} losses · {s.scratches} break-even.
                  95% win-rate interval: {percent(s.win_rate_ci[0])}–
                  {percent(s.win_rate_ci[1])}.
                </p>
              )}
            </div>
            <Select
              label="Compare by"
              values={dimensions}
              value={comparison}
              onChange={(e) => onComparisonChange(e.target.value)}
            />
          </div>
          {s && (
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
          )}
          <p className="muted">
            Use the source switch to compare backtesting with your live trading
            history.
          </p>
        </div>
      )}
    </section>
  );
}
