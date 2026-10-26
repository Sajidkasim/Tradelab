import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Upload,
  Search,
  ArrowUpRight,
  Download,
  Settings2,
} from "lucide-react";
import { api } from "./api";
import {
  Button,
  Heading,
  Empty,
  Modal,
  Notice,
  Field,
  Menu,
} from "./components";
import TradeForm from "./TradeForm";
import { belongsTo, money, rvalue, tradeDate, sourceNames } from "./format";

export default function Trades({
  meta,
  trades,
  refresh,
  onImport,
  toast,
  scope,
}) {
  const [pending, setPending] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [opened, setOpened] = useState(null),
    [previous, setPrevious] = useState(null),
    [book, setBook] = useState(false),
    [bulk, setBulk] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState([]),
    [strategy, setStrategy] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const queue = useMemo(
    () =>
      trades.filter(
        (t) =>
          belongsTo(t, scope) &&
          (!pending || t.needs_tagging) &&
          `${t.symbol} ${t.setup_name} ${t.direction}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [trades, scope, pending, search],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(queue.length / 30) - 1),
  );
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
  const pendingCount = trades.filter((t) => t.needs_tagging).length;
  const trade =
    typeof opened === "number" ? trades.find((t) => t.id === opened) : null;
  async function saved(updated, next) {
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
            <Button onClick={onImport}>
              <Upload size={16} /> Import FX Replay
            </Button>
            <Button variant="primary" onClick={() => setOpened("new")}>
              <Plus size={17} /> Add trade
            </Button>
          </div>
        }
      />
      <div className="toolbar">
        <Button
          className={pending ? "active" : ""}
          aria-pressed={pending}
          onClick={() => {
            setPending(!pending);
            setPage(0);
          }}
        >
          Needs tagging <span className="count">{pendingCount}</span>
        </Button>
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search trades"
            placeholder="Market or strategy"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      <div className="card journal-card">
        <div className="section-title">
          <div>
            <h2>{pending ? "Your review queue" : "Trade journal"}</h2>
            <p>
              {queue.length} trades · {scope === "All" ? "All sources" : scope}{" "}
              · New York time
            </p>
          </div>
          <Menu label="Manage trades">
            <button onClick={() => setBook(true)}>
              <Settings2 size={15} /> Edit strategies & levels
            </button>
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
          </Menu>
        </div>
        {queue.length ? (
          <>
            <div className="table-wrap">
              <table className="trade-table">
                <thead>
                  <tr>
                    {bulk && <th>Select</th>}
                    <th>Trade</th>
                    <th>Strategy</th>
                    <th>Net result</th>
                    <th>Realised R</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue
                    .slice(currentPage * 30, currentPage * 30 + 30)
                    .map((t) => (
                      <tr key={t.id} onClick={() => !bulk && setOpened(t.id)}>
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
                        <td>
                          <strong>
                            {t.symbol}{" "}
                            <span className="side-label">
                              {t.direction === "long" ? "Buy" : "Sell"}
                            </span>
                          </strong>
                          <small className="table-caption">
                            {tradeDate(t.entry_time)} · {sourceNames[t.source]}
                          </small>
                        </td>
                        <td>
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
                        </td>
                        <td>{rvalue(t.r_multiple)}</td>
                        <td>
                          <span
                            className={`badge ${t.needs_tagging ? "pending" : ""}`}
                          >
                            {t.needs_tagging ? "Needs tagging" : "Reviewed"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`Edit trade ${t.id}`}
                            className="icon-button"
                            onClick={(e) => {
                              e.stopPropagation();
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
                {Math.min(currentPage * 30 + 1, queue.length)}–
                {Math.min((currentPage + 1) * 30, queue.length)} of{" "}
                {queue.length}
              </span>
              <div>
                <Button
                  disabled={!currentPage}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  disabled={(currentPage + 1) * 30 >= queue.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title={
              pending
                ? "Your review queue is clear"
                : trades.length
                  ? "No trades match these filters"
                  : "No trades yet"
            }
          >
            {pending
              ? "Switch off Needs tagging to amend an existing trade."
              : "Use Add trade or Import FX Replay above to get started."}
          </Empty>
        )}
        {bulk && (
          <div className="bulk-panel">
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
              <span>{tradeDate(deleting.entry_time)}</span>
              <span>{money(deleting.net_pnl)}</span>
              <span>{sourceNames[deleting.source]}</span>
            </div>
            <p>
              This removes this trade and its notes from your journal and
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
      {book && (
        <Playbook
          meta={meta}
          onClose={() => setBook(false)}
          refresh={refresh}
          toast={toast}
        />
      )}
    </>
  );
}

function Playbook({ meta, onClose, refresh, toast }) {
  const [strategies, setStrategies] = useState(
      meta.playbook.strategies.join("\n"),
    ),
    [levels, setLevels] = useState(meta.playbook.levels.join("\n")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/playbook", {
        method: "PUT",
        body: {
          strategies: strategies.split("\n"),
          levels: levels.split("\n"),
        },
      });
      await refresh();
      toast("Your strategy and level lists are saved.");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Strategies & key levels" onClose={onClose}>
      <form onSubmit={save} className="stack">
        <p className="muted">
          One name per line. Trades keep their saved labels when a name is
          removed from this list.
        </p>
        <div className="form-grid two">
          <Field label="Strategies">
            <textarea
              rows={10}
              value={strategies}
              onChange={(e) => setStrategies(e.target.value)}
            />
          </Field>
          <Field label="Key levels / PDA">
            <textarea
              rows={10}
              value={levels}
              onChange={(e) => setLevels(e.target.value)}
            />
          </Field>
        </div>
        {error && <Notice error>{error}</Notice>}
        <Button type="submit" variant="primary" busy={busy}>
          Save lists
        </Button>
      </form>
    </Modal>
  );
}
