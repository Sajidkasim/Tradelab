import { useJournalClock } from "./JournalClock";
import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Upload,
  ArrowUpRight,
  Download,
  ClipboardCheck,
} from "lucide-react";
import { api } from "./api";
import {
  Button,
  Heading,
  Segments,
  Empty,
  Modal,
  Notice,
  Field,
  Menu,
  Select,
} from "./components";
import TradeForm from "./TradeForm";
import DeleteAllTrades from "./DeleteAllTrades";
import { belongsTo, money, rvalue, tradeDate, sourceNames } from "./format";
import { matchesTest, testOptions, reviewIssues } from "./research";

const PAGE_SIZE = 8;

export default function Trades({
  meta,
  trades,
  refresh,
  onImport,
  toast,
  scope,
  studyId = "",
  assignmentTarget,
  onAssignmentHandled,
}) {
  const { timezone: journalZone, clockName } = useJournalClock();
  const [pending, setPending] = useState(false),
    [page, setPage] = useState(0);
  const [opened, setOpened] = useState(null),
    [previous, setPrevious] = useState(null),
    [bulk, setBulk] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [bulkMode, setBulkMode] = useState("strategy"),
    [studyTarget, setStudyTarget] = useState("");
  const [focusField, setFocusField] = useState(null);
  const [selected, setSelected] = useState([]),
    [strategy, setStrategy] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const queue = useMemo(
    () =>
      trades.filter(
        (t) =>
          belongsTo(t, scope) &&
          matchesTest(t, studyId) &&
          (!pending || (t.needs_review ?? t.needs_tagging)),
      ),
    [trades, scope, pending, studyId],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(queue.length / PAGE_SIZE) - 1),
  );
  useEffect(() => {
    setPage(0);
    setSelected([]);
  }, [scope, studyId]);
  useEffect(() => {
    if (assignmentTarget == null) return;
    setBulk(true);
    setBulkMode("test");
    setStudyTarget(assignmentTarget);
    setPending(false);
    setSelected([]);
  }, [assignmentTarget]);
  async function removeTrade() {
    setBusy(true);
    setError("");
    try {
      await api(`/trades/${deleting.id}`, { method: "DELETE" });
    } catch (e) {
      setError(e.message);
      setBusy(false);
      return;
    }
    setSelected((ids) => ids.filter((id) => id !== deleting.id));
    setDeleting(null);
    try {
      await refresh();
      toast("Trade deleted. Your results are updated.");
    } catch {
      toast("Trade deleted. Reload the page to refresh your results.");
    } finally {
      setBusy(false);
    }
  }
  const unfinished = trades.filter(
    (t) =>
      belongsTo(t, scope) &&
      matchesTest(t, studyId) &&
      (t.needs_review ?? t.needs_tagging),
  );
  const pendingCount = unfinished.length;
  const trade =
    typeof opened === "number" ? trades.find((t) => t.id === opened) : null;
  async function saved(updated, next) {
    setFocusField(null);
    await refresh();
    toast(
      updated
        ? "Trade updated. Results use your saved labels."
        : "Trade saved. Ready for the next.",
    );
    if (updated && next) {
      const index = queue.findIndex((t) => t.id === updated.id);
      const rest = queue.filter((t) => t.id !== updated.id);
      setOpened(rest.length ? rest[Math.min(index, rest.length - 1)].id : null);
    } else if (updated) setOpened(null);
  }
  async function applyBulk() {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        bulkMode === "test" ? "/study-assignment" : "/trades/strategy",
        {
          method: "POST",
          body:
            bulkMode === "test"
              ? { ids: selected, study_id: studyTarget }
              : { ids: selected, strategy },
        },
      );
      await refresh();
      toast(
        bulkMode === "test"
          ? `${result.updated} trades assigned. Their recorded results are unchanged.`
          : `Strategy applied to ${result.updated} trades.`,
      );
      setBulk(false);
      setSelected([]);
      onAssignmentHandled?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Trades"
        level={2}
        action={
          <div className="actions">
            <Button onClick={onImport}>
              <Upload size={16} /> Import
            </Button>
            <Button variant="primary" onClick={() => setOpened("new")}>
              <Plus size={17} /> Add trade
            </Button>
          </div>
        }
      />
      <div className="trade-review-toolbar">
        <Segments
          label="Trade list"
          values={[
            { value: "all", label: "All trades" },
            { value: "unfinished", label: `To finish · ${pendingCount}` },
          ]}
          value={pending ? "unfinished" : "all"}
          onChange={(value) => {
            setPending(value === "unfinished");
            setPage(0);
            setSelected([]);
          }}
        />
        <p>Open a trade to see exactly what needs checking.</p>
      </div>
      <div className="card journal-card">
        <div className="section-title">
          <div>
            <h2>{pending ? "Trades to finish" : "Your trades"}</h2>
            <p>
              {queue.length} trades ·{" "}
              {scope === "All"
                ? "All sources"
                : scope === "Forward testing"
                  ? "Live trading"
                  : scope}{" "}
              · {clockName} time
            </p>
          </div>
          <Menu label="Manage trades">
            <button
              disabled={!queue.length}
              onClick={() => {
                setBulk(!bulk);
                setBulkMode("strategy");
                setSelected([]);
              }}
            >
              {bulk ? "Finish selecting" : "Tag several"}
            </button>
            {(meta.studies || []).length > 0 && (
              <button
                onClick={() => {
                  setBulk(true);
                  setBulkMode("test");
                  setStudyTarget(studyId === "unassigned" ? "" : studyId);
                  setSelected([]);
                }}
              >
                Assign to a test
              </button>
            )}
            <a href="/api/export/csv">
              <Download size={15} /> Download CSV
            </a>
            <button
              className="menu-danger"
              disabled={!trades.length}
              onClick={() => setDeleteAll(true)}
            >
              <Trash2 size={15} /> Delete all trades
            </button>
          </Menu>
        </div>
        {pendingCount > 0 && (
          <div className="review-prompt">
            <ClipboardCheck size={20} />
            <div>
              <strong>{pendingCount} trades to review</strong>
              <p>
                Check the missing fields shown on each trade. Original risk can
                be recorded or marked unavailable.
              </p>
            </div>
            <Button
              onClick={() => {
                setPending(true);
                setPage(0);
                setOpened(unfinished[0].id);
              }}
            >
              Review next <ArrowUpRight size={14} />
            </Button>
          </div>
        )}
        {queue.length ? (
          <>
            <div className="table-wrap">
              <table className="trade-table">
                <thead>
                  <tr>
                    {bulk && <th>Select</th>}
                    <th>Trade</th>
                    <th className="trade-strategy-cell">Strategy</th>
                    <th>Net result</th>
                    <th className="trade-r-cell">Realised R</th>
                    <th className="trade-status-cell">Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue
                    .slice(
                      currentPage * PAGE_SIZE,
                      currentPage * PAGE_SIZE + PAGE_SIZE,
                    )
                    .map((t) => (
                      <tr
                        key={t.id}
                        onClick={() => {
                          if (!bulk) {
                            setFocusField(null);
                            setOpened(t.id);
                          }
                        }}
                      >
                        {bulk && (
                          <td>
                            <input
                              type="checkbox"
                              disabled={
                                bulkMode === "test" &&
                                Boolean(studyTarget) &&
                                !["fxreplay", "backtest"].includes(t.source)
                              }
                              aria-label={`Select trade ${t.id}`}
                              checked={selected.includes(t.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, t.id]
                                    : selected.filter((id) => id !== t.id),
                                )
                              }
                            />
                          </td>
                        )}
                        <td className="trade-summary">
                          <strong>
                            {t.symbol}{" "}
                            <span className="side-label">
                              {t.direction === "long" ? "Buy" : "Sell"}
                            </span>
                          </strong>
                          <small className="table-caption">
                            {tradeDate(t.entry_time, journalZone)} · {sourceNames[t.source]}
                          </small>
                          <small className="mobile-trade-detail">
                            {t.setup_name || "Add strategy"}
                            {(t.needs_review ?? t.needs_tagging)
                              ? " · To finish"
                              : ""}
                          </small>
                        </td>
                        <td className="trade-strategy-cell">
                          {t.setup_name || (
                            <span className="muted">Unclassified</span>
                          )}
                        </td>
                        <td
                          className={
                            t.net_pnl > 0
                              ? "positive"
                              : t.net_pnl < 0
                                ? "negative"
                                : ""
                          }
                        >
                          {money(t.net_pnl)}
                          <small className="mobile-trade-detail">
                            {rvalue(t.r_multiple)}
                          </small>
                        </td>
                        <td className="trade-r-cell">
                          {t.r_multiple == null && !t.risk_unavailable ? (
                            <button
                              className="inline-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                setFocusField("risk");
                                setOpened(t.id);
                              }}
                            >
                              Add original risk
                            </button>
                          ) : (
                            rvalue(t.r_multiple)
                          )}
                        </td>
                        <td className="trade-status-cell">
                          <span
                            className={`badge ${(t.needs_review ?? t.needs_tagging) ? "pending" : ""}`}
                          >
                            {reviewIssues(t)[0]?.label || "Complete"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`Edit trade ${t.id}`}
                            className="icon-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusField(null);
                              setOpened(t.id);
                            }}
                          >
                            <ArrowUpRight size={16} />
                          </button>
                          <button
                            aria-label={`Delete trade ${t.id}`}
                            title="Delete trade"
                            className="icon-button delete-trade"
                            onClick={(e) => {
                              e.stopPropagation();
                              setError("");
                              setDeleting(t);
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {Math.min(currentPage * PAGE_SIZE + 1, queue.length)}–
                {Math.min((currentPage + 1) * PAGE_SIZE, queue.length)} of{" "}
                {queue.length} trades
              </span>
              <div>
                <Button
                  disabled={!currentPage}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  disabled={(currentPage + 1) * PAGE_SIZE >= queue.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            action={
              pending ? (
                <Button
                  onClick={() => {
                    setPending(false);
                    setPage(0);
                  }}
                >
                  Show all trades
                </Button>
              ) : undefined
            }
            title={
              pending
                ? "All caught up"
                : trades.length
                  ? "No trades match these filters"
                  : "No trades yet"
            }
          >
            {pending
              ? "These trades have their strategy and confirmations checked. Choose All trades to view your trades."
              : "Use Add trade or Import above to get started."}
          </Empty>
        )}
        {bulk && (
          <div className="bulk-panel">
            <Button
              onClick={() => {
                setBulk(false);
                setSelected([]);
                onAssignmentHandled?.();
              }}
            >
              Cancel selection
            </Button>
            <Segments
              label="Apply to selected trades"
              values={[
                { value: "strategy", label: "Strategy" },
                { value: "test", label: "Test" },
              ]}
              value={bulkMode}
              onChange={(value) => {
                setBulkMode(value);
                setSelected([]);
              }}
            />
            {bulkMode === "test" ? (
              <Select
                label={`${selected.length} selected · research test`}
                values={testOptions(meta.studies, studyTarget)}
                value={studyTarget}
                onChange={(e) => {
                  setStudyTarget(e.target.value);
                  setSelected([]);
                }}
              />
            ) : (
              <Field label={`${selected.length} selected · apply strategy`}>
                <input
                  list="bulk-strategies"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  placeholder="Choose or type a strategy"
                />
                <datalist id="bulk-strategies">
                  {meta.strategies.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            )}
            {bulkMode === "test" && (
              <small className="muted">
                Assigns selected backtests without duplicating them. Live trades
                stay outside tests.
              </small>
            )}
            <Button
              variant="primary"
              busy={busy}
              disabled={
                !selected.length ||
                (bulkMode === "strategy" && !strategy.trim())
              }
              onClick={applyBulk}
            >
              {bulkMode === "test"
                ? "Assign selected trades"
                : "Apply strategy"}
            </Button>
            {error && <Notice error>{error}</Notice>}
          </div>
        )}
      </div>
      {opened !== null && (opened === "new" || trade) && (
        <Modal
          title={trade ? "Review trade" : "Add trade"}
          onClose={() => setOpened(null)}
        >
          <TradeForm
            key={opened}
            trade={trade}
            meta={meta}
            previous={previous}
            onPrevious={setPrevious}
            onSaved={saved}
            onClose={() => setOpened(null)}
            remaining={queue.length}
            studyId={studyId}
            focusField={focusField}
          />
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete this trade?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="stack">
            <div className="trade-result">
              <strong>
                {deleting.symbol} ·{" "}
                {deleting.direction === "long" ? "Buy" : "Sell"}
              </strong>
              <span>{tradeDate(deleting.entry_time, journalZone)}</span>
              <span>{money(deleting.net_pnl)}</span>
              <span>{sourceNames[deleting.source]}</span>
            </div>
            <p>
              This removes this trade and its notes from your lab and
              results. This cannot be undone.
            </p>
            {error && <Notice error>{error}</Notice>}
            <div className="actions">
              <Button disabled={busy} onClick={() => setDeleting(null)}>
                Keep trade
              </Button>
              <Button variant="danger" busy={busy} onClick={removeTrade}>
                Delete trade
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {deleteAll && (
        <DeleteAllTrades
          onClose={() => setDeleteAll(false)}
          refresh={refresh}
          toast={toast}
          onDeleted={() => {
            setSelected([]);
            setBulk(false);
            setPage(0);
            setOpened(null);
          }}
        />
      )}
    </>
  );
}
