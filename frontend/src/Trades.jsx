import { useJournalClock } from "./JournalClock";
import React, { useEffect, useState } from "react";
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
} from "./components";
import TradeForm from "./TradeForm";
import useTradeDismissal from "./useTradeDismissal";
import DeleteAllTrades from "./DeleteAllTrades";
import { money, rvalue, tradeDate, sourceNames } from "./format";
import { reviewIssues } from "./research";

const PAGE_SIZE = 8;

export default function Trades({
  meta,
  revision,
  refresh,
  onImport,
  toast,
  scope,
}) {
  const { timezone: journalZone, clockName } = useJournalClock();
  const [linkedTrade, setLinkedTrade] = useState(null);
  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get('trade'));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const controller = new AbortController();
    api(`/trades/${id}`, {signal: controller.signal}).then((value) => {
      if (!controller.signal.aborted) {setLinkedTrade(value); setOpened(id);}
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, []);
  const [pending, setPending] = useState(false),
    [page, setPage] = useState(0);
  const [opened, setOpened] = useState(null),
    [previous, setPrevious] = useState(null),
    [bulk, setBulk] = useState(false);
  const tradeDismissal=useTradeDismissal(()=>setOpened(null));
  const [deleting, setDeleting] = useState(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [focusField, setFocusField] = useState(null);
  const [selected, setSelected] = useState([]),
    [strategy, setStrategy] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [pageError, setPageError] = useState("");
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({scope, pending, page, size:PAGE_SIZE}).toString();
  useEffect(() => {
    const controller = new AbortController();
    setPageError("");
    api(`/trades/page?${query}`, {signal:controller.signal})
      .then((value) => {if (!controller.signal.aborted) setResult({...value, query});})
      .catch((failure) => {if (!controller.signal.aborted) setPageError(failure.message);});
    return () => controller.abort();
  }, [query, revision, retry]);
  const current = result?.query === query ? result : null;
  const queue = current?.items || [];
  const total = current?.total || 0;
  const currentPage = current?.page || 0;
  useEffect(() => {
    setPage(0);
    setSelected([]);
  }, [scope]);
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
  const pendingCount = current?.pending_count || 0;
  const trade = typeof opened === "number"
    ? queue.find((item) => item.id === opened) || (linkedTrade?.id === opened ? linkedTrade : null)
    : null;
  async function saved(updated, next) {
    setFocusField(null);
    await refresh();
    toast(updated ? "Trade updated. Results use your saved labels." : "Trade saved. Ready for the next.");
    if (updated && next) {
      const index = Math.max(0, queue.findIndex((item) => item.id === updated.id));
      let fresh = await api(`/trades/page?${query}`);
      let following = fresh.page < currentPage ? fresh.items.at(-1) : fresh.items[index];
      if (following?.id === updated.id) following = fresh.items[index + 1];
      if (!following && (fresh.page + 1) * PAGE_SIZE < fresh.total) {
        const nextQuery = new URLSearchParams(query);
        nextQuery.set('page', fresh.page + 1);
        fresh = await api(`/trades/page?${nextQuery}`);
        following = fresh.items[0];
        setPage(fresh.page);
      }
      if (!following) following = [...fresh.items].reverse().find(item => item.id !== updated.id);
      setLinkedTrade(following || null);
      setOpened(following?.id ?? null);
    } else if (updated) setOpened(null);
  }
  async function applyBulk() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/trades/strategy", {
        method: "POST",
        body: { ids: selected, strategy },
      });
      await refresh();
      toast(`Strategy applied to ${result.updated} trades.`);
      setBulk(false);
      setSelected([]);
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
            <Button data-tour="import" onClick={onImport}>
              <Upload size={16} /> Import
            </Button>
            <Button variant="primary" data-tour="add-trade" onClick={() => setOpened("new")}>
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
              {total} trades ·{" "}
              {scope === "All"
                ? "All sources"
                : scope === "Forward testing"
                  ? "Live"
                  : scope}{" "}
              · {clockName} time
            </p>
          </div>
          <Menu label="Manage trades">
            <button
              disabled={!queue.length}
              onClick={() => {
                setBulk(!bulk);
                setSelected([]);
              }}
            >
              {bulk ? "Finish selecting" : "Tag several"}
            </button>
            <a href="/api/export/csv">
              <Download size={15} /> Download CSV
            </a>
            <button
              className="menu-danger"
              disabled={!meta.trade_count}
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
        {pageError && <Notice error>{pageError} <Button onClick={() => setRetry(value => value + 1)}>Retry</Button></Notice>}
        {!current && !pageError ? <p role="status">Loading trades…</p> : queue.length ? (
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
                  {queue.map((t) => (
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
                            {tradeDate(t.entry_time, journalZone)} ·{" "}
                            {sourceNames[t.source]}
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
                {Math.min(currentPage * PAGE_SIZE + 1, total)}–
                {Math.min((currentPage + 1) * PAGE_SIZE, total)} of{" "}
                {total} trades
              </span>
              <div>
                <Button
                  disabled={!currentPage}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  disabled={(currentPage + 1) * PAGE_SIZE >= total}
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
                : meta.trade_count
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
              }}
            >
              Cancel selection
            </Button>
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
            <Button
              variant="primary"
              busy={busy}
              disabled={!selected.length || !strategy.trim()}
              onClick={applyBulk}
            >
              Apply strategy
            </Button>
            {error && <Notice error>{error}</Notice>}
          </div>
        )}
      </div>
      {opened !== null && (opened === "new" || trade) && (
        <Modal
          title={trade ? "Review trade" : "Add trade"}
          onClose={tradeDismissal.requestClose}
        >
          <TradeForm
            onDraftStateChange={tradeDismissal.onDraftStateChange}
            key={opened}
            trade={trade}
            meta={meta}
            previous={previous}
            onPrevious={setPrevious}
            onSaved={saved}
            onClose={tradeDismissal.requestClose}
            remaining={total}
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
              This removes this trade and its notes from your lab and results.
              This cannot be undone.
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
