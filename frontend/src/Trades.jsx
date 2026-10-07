import React, { useMemo, useState } from "react";
import {
  Plus,
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
  Segments,
  Empty,
  Modal,
  Notice,
  Field,
  Select,
} from "./components";
import TradeForm from "./TradeForm";
import { belongsTo, money, rvalue, tradeDate, sourceNames } from "./format";

export default function Trades({ meta, trades, refresh, onImport, toast }) {
  const [scope, setScope] = useState("All"),
    [pending, setPending] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [opened, setOpened] = useState(null),
    [previous, setPrevious] = useState(null),
    [book, setBook] = useState(false),
    [bulk, setBulk] = useState(false);
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
        eyebrow="BUILD YOUR SAMPLE"
        title="Trades"
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
      >
        Your trades, your evidence. Log quickly, review with care.
      </Heading>
      <div className="toolbar">
        <Segments
          values={["Backtesting", "Forward testing", "All"]}
          value={scope}
          onChange={(v) => {
            setScope(v);
            setPage(0);
          }}
          label="Trade data source"
        />
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
            <p>{queue.length} trades · times shown in New York</p>
          </div>
          <Button
            onClick={() => {
              setBulk(!bulk);
              setSelected([]);
            }}
            disabled={!queue.length}
          >
            {bulk ? "Finish selecting" : "Tag several"}
          </Button>
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
                    <th>Key level</th>
                    <th>Net result</th>
                    <th>Realised R</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue.slice(page * 30, page * 30 + 30).map((t) => (
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
                      <td>
                        {t.labels?.level === "Not recorded"
                          ? "—"
                          : t.labels?.level}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {Math.min(page * 30 + 1, queue.length)}–
                {Math.min((page + 1) * 30, queue.length)} of {queue.length}
              </span>
              <div>
                <Button disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button
                  disabled={(page + 1) * 30 >= queue.length}
                  onClick={() => setPage(page + 1)}
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
                  : "Make room for your first trade"
            }
            action={
              <Button variant="primary" onClick={onImport}>
                Import FX Replay <Upload size={16} />
              </Button>
            }
          >
            {pending
              ? "Switch off Needs tagging to amend an existing trade."
              : "Import a replay export, or add a trade manually. All your setup labels stay with your data."}
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
      <div className="quiet-actions">
        <Button onClick={() => setBook(true)}>
          <Settings2 size={15} /> Edit strategies & levels
        </Button>
        <a className="button" href="/api/export/csv">
          <Download size={15} /> Download CSV
        </a>
        <a className="button" href="/api/export/backup">
          <Download size={15} /> Download full backup
        </a>
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
