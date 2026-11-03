import { useJournalClock } from "./JournalClock";
import React, { useState, useRef, useEffect } from "react";
import { ArrowRight, Copy } from "lucide-react";
import { api } from "./api";
import {
  Button,
  Field,
  Select,
  Segments,
  Disclosure,
  Notice,
} from "./components";
import Labels from "./Labels";
import { reviewIssues } from "./research";
import {
  blankLabels,
  labelsOnly,
  money,
  rvalue,
  nyToday,
  nyToUtc,
} from "./format";

export default function TradeForm({
  trade,
  meta,
  previous,
  onPrevious,
  onSaved,
  onClose,
  onDraftStateChange,
  remaining = 0,
  focusField,
  journalOrigin,
  initialEntryTime,
}) {
  const [showArchivedStrategies,setShowArchivedStrategies]=useState(false);
  const { timezone: journalZone, clockName } = useJournalClock();
  const formRef = useRef();
  const [originalRisk, setOriginalRisk] = useState(
    trade?.initial_risk == null ? "" : String(trade.initial_risk),
  );
  const [riskUnavailable, setRiskUnavailable] = useState(
    Boolean(trade?.risk_unavailable),
  );
  const journalTag=trade?.tags?.find(tag=>/^lab:journal:\d{4}-\d{2}-\d{2}:[a-f0-9]{32}$/.test(tag));
  const journalParts=journalTag?.split(':');
  const issues = trade ? reviewIssues(trade) : [];
  const firstField = focusField || issues[0]?.field;
  const focus = (field) =>
    formRef.current?.querySelector(`[data-review-focus="${field}"]`)?.focus();
  useEffect(() => {
    if (!trade || !firstField) return;
    const frame = requestAnimationFrame(() => focus(firstField));
    return () => cancelAnimationFrame(frame);
  }, [trade?.id, firstField]);
  const [strategy, setStrategy] = useState(
    trade ? trade.setup_name || "" : previous?.strategy || "",
  );
  const [labels, setLabels] = useState(
    labelsOnly(trade?.labels || previous?.labels || blankLabels()),
  );
  const [confirmed, setConfirmed] = useState(trade?.labels?.reviewed || false),
    [notes, setNotes] = useState(trade?.notes || previous?.notes || "");
  const [source, setSource] = useState(previous?.source || "backtest"),
    [account] = useState(
      previous?.account_id || meta.accounts[0]?.id,
    );
  const [direction, setDirection] = useState(previous?.direction || "long"),
    [symbol, setSymbol] = useState(
      previous?.symbol ||
        (meta.instruments.NQ ? "NQ" : Object.keys(meta.instruments)[0]),
    );
  const [method, setMethod] = useState("Quick result"),
    [start, setStart] = useState(initialEntryTime || `${nyToday(journalZone)}T09:30`),
    [exit, setExit] = useState("");
  const [fields, setFields] = useState({
    net_pnl: journalOrigin ? String(previous?.net_pnl ?? "") : "",
    risk_amount: journalOrigin ? String(previous?.risk_amount ?? "") : "",
    entry_price: "",
    exit_price: "",
    stop_price: "",
    target_price: "",
    qty: 1,
    fees: 0,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const draftSnapshot=JSON.stringify({strategy,labels,confirmed,notes,source,account,direction,symbol,method,start,exit,fields,originalRisk,riskUnavailable});
  const initialDraft=useRef(draftSnapshot);
  const dirty=draftSnapshot!==initialDraft.current;
  useEffect(()=>{onDraftStateChange?.({dirty,busy})},[dirty,busy,onDraftStateChange]);
  useEffect(()=>{if(!dirty)return;const warn=event=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
  const change = (key, value) => setFields((f) => ({ ...f, [key]: value }));
  function reuse() {
    setStrategy(previous.strategy);
    setLabels(labelsOnly(previous.labels));
    setConfirmed(false);
  }
  async function save(event, next) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = {
        strategy,
        labels,
        notes,
        confirmed,
        study_id: trade?.study_id || "",
      };
      if (trade) {
        body.risk_unavailable = riskUnavailable;
        if (
          trade.stop_price == null &&
          originalRisk !== "" &&
          Number(originalRisk) !== trade.initial_risk
        )
          body.risk_amount = Number(originalRisk);
        const updated = await api(`/trades/${trade.id}`, {
          method: "PATCH",
          body,
        });
        onPrevious({ strategy, labels });
        await onSaved(updated, next);
      } else {
        Object.assign(body, {
          symbol,
          direction,
          account_id: Number(account),
          source,
          entry_time: nyToUtc(start, journalZone),
          exit_time: nyToUtc(exit || start, journalZone),
        });
        const required =
          method === "Quick result"
            ? ["net_pnl", "risk_amount"]
            : ["entry_price", "stop_price", "exit_price", "qty"];
        if (required.some((key) => fields[key] === ""))
          throw new Error(
            "Enter the result and original risk, or the full entry / stop / exit prices.",
          );
        for (const key of method === "Quick result"
          ? required
          : [...required, "fees", "target_price"]) {
          if (fields[key] !== "") body[key] = Number(fields[key]);
        }
        if(journalOrigin)Object.assign(body,{journal_day:journalOrigin.day,journal_trade_id:journalOrigin.id});
        const result = await api("/trades", { method: "POST", body });
        if (!result.inserted && !result.journal_entry)
          throw new Error(
            "This exact trade is already saved. Use a different entry time for a different trade.",
          );
        onPrevious({
          strategy,
          labels,
          source,
          account_id: account,
          direction,
          symbol,
        });
        setFields({
          net_pnl: "",
          risk_amount: "",
          entry_price: "",
          exit_price: "",
          stop_price: "",
          target_price: "",
          qty: 1,
          fees: 0,
        });
        setNotes("");
        setExit("");
        setConfirmed(false);
        await onSaved(null, next, result);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} onSubmit={(e) => save(e, false)} className="trade-form">
      {journalParts&&<a className="pj-back-to-entry" href={`/journal?day=${journalParts[2]}&card=${journalParts[3]}`}>Open this trade’s Journal entry <ArrowRight size={15}/></a>}
      {trade && (
        <div className="trade-result">
          <span>
            {trade.symbol} · {trade.direction === "long" ? "Buy" : "Sell"}
          </span>
          <strong>{money(trade.net_pnl)}</strong>
          <span>{rvalue(trade.r_multiple)}</span>
          <span className="badge">{remaining} in queue</span>
        </div>
      )}
      {issues.length > 0 && (
        <div className="review-issue-list">
          <span>To finish this trade</span>
          {issues.map((issue) => (
            <Button
              type="button"
              key={issue.field}
              onClick={() => focus(issue.field)}
            >
              {issue.label}
            </Button>
          ))}
        </div>
      )}
      <div className="form-step">
        <div>
          <h3>Setup</h3>
        </div>
        {previous && (
          <Button onClick={reuse} type="button" className="reuse">
            <Copy size={14} /> Use previous setup
          </Button>
        )}
      </div>
      {!trade && (
        <div>
          <Select
            label="Testing type"
            values={[
              { value: "backtest", label: "Backtesting" },
              { value: "manual", label: "Live" },
            ]}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
            }}
          />
        </div>
      )}
      <Field label="Strategy">
        <input
          data-review-focus="strategy"
          list="strategies"
          value={strategy}
          maxLength={120}
          placeholder="Choose or type your strategy"
          onChange={(e) => setStrategy(e.target.value)}
          required={!trade}
        />
        <datalist id="strategies">
          {[...new Set([...meta.strategies,...(showArchivedStrategies ? meta.archived_choices?.strategies||[] : [])])].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </Field>
      {!!meta.archived_choices?.strategies?.length&&<button type="button" className="archive-toggle" onClick={()=>setShowArchivedStrategies(!showArchivedStrategies)}>{showArchivedStrategies?'Hide archived':'Show archived'} strategies · {meta.archived_choices.strategies.length}</button>}
      {!trade && (
        <div className="field">
          <span>Direction</span>
          <Segments
            values={[
              { value: "long", label: "Buy / Long" },
              { value: "short", label: "Sell / Short" },
            ]}
            value={direction}
            onChange={setDirection}
          />
        </div>
      )}
      <div className="form-step">
        <div>
          <h3>Level & confirmations</h3>
        </div>
      </div>
      <Labels value={labels} onChange={setLabels} meta={meta} />
      <label className="review-check">
        <input
          data-review-focus="confirmations"
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I have checked the confirmations for this trade
      </label>
      <small className="muted">
        Unchecked confirmations mean “not recorded” until you review them.
      </small>
      {trade && (
        <div className="review-risk-section stack">
          <div>
            <h3>Original risk & realised R</h3>
            <p className="muted">
              Use the dollars you actually risked at entry. A planned target
              ratio cannot fill this in.
            </p>
          </div>
          {trade.stop_price != null ? (
            <p>
              Original risk: {money(trade.initial_risk)} · calculated from the
              saved stop.
            </p>
          ) : (
            <Field
              label="Original risk ($)"
              hint="The recorded dollar result stays saved; R is updated using this risk."
            >
              <input
                data-review-focus="risk"
                type="number"
                step="any"
                min="0.000001"
                required={Boolean(trade.initial_risk)}
                disabled={riskUnavailable}
                value={originalRisk}
                onChange={(e) => {
                  setOriginalRisk(e.target.value);
                  setRiskUnavailable(false);
                }}
              />
            </Field>
          )}
          {trade.r_multiple == null && (
            <label className="review-check">
              <input
                type="checkbox"
                checked={riskUnavailable}
                onChange={(e) => {
                  setRiskUnavailable(e.target.checked);
                  if (e.target.checked) setOriginalRisk("");
                }}
              />
              Original risk is not available — keep R unrecorded
            </label>
          )}
          {riskUnavailable && (
            <small className="muted">
              This trade can be reviewed with R left blank. You can add its
              original risk later.
            </small>
          )}
        </div>
      )}
      {!trade && (
        <>
          <div className="form-step">
            <div>
              <h3>Result</h3>
            </div>
          </div>
          <div className="form-grid two">
            <Select
              label="Market"
              values={Object.keys(meta.instruments)}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
            <Field label={`Entry time · ${clockName}`}>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </Field>
          </div>
          <Segments
            values={["Quick result", "Entry / stop / exit"]}
            value={method}
            onChange={setMethod}
            label="Entry method"
          />
          <div className="form-grid two">
            {(method === "Quick result"
              ? [
                  ["net_pnl", "Net result ($)"],
                  ["risk_amount", "Original risk ($)"],
                ]
              : [
                  ["entry_price", "Entry price"],
                  ["stop_price", "Original stop"],
                  ["exit_price", "Exit price"],
                  ["qty", "Contracts"],
                ]
            ).map(([key, title]) => (
              <Field key={key} label={title}>
                <input
                  type="number"
                  step="any"
                  min={key === "net_pnl" ? undefined : "0.000001"}
                  value={fields[key]}
                  onChange={(e) => change(key, e.target.value)}
                  required
                  placeholder={
                    key === "net_pnl" ? "e.g. 500 or -250" : "Actual value"
                  }
                />
              </Field>
            ))}
          </div>
          <small className="muted">
            R uses the original risk at entry. FX Replay’s planned target is
            never substituted for realised R.
          </small>
        </>
      )}
      <Disclosure title="Timing & notes">
        <div className="stack">
          {!trade && (
            <Field
              label={`Exit time · ${clockName} (optional)`}
              hint="If omitted, exit is recorded at entry time and hold time is zero."
            >
              <input
                type="datetime-local"
                value={exit}
                onChange={(e) => setExit(e.target.value)}
              />
            </Field>
          )}
          {!trade && method !== "Quick result" && (
            <div className="form-grid two">
              <Field label="Fees ($)">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={fields.fees}
                  onChange={(e) => change("fees", e.target.value)}
                />
              </Field>
              <Field label="Planned target (optional)">
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={fields.target_price}
                  onChange={(e) => change("target_price", e.target.value)}
                />
              </Field>
            </div>
          )}
          <Field label="One useful observation">
            <textarea
              value={notes}
              maxLength={20000}
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What worked, what you would change…"
            />
          </Field>
        </div>
      </Disclosure>
      {trade && (
        <Disclosure title="Original export tags">
          <p>
            {(trade.tags || [])
              .filter((t) => !t.startsWith("edge:") && !t.startsWith("lab:"))
              .join(", ") || "No export tags."}
          </p>
        </Disclosure>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="form-footer">
        <Button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <div>
          {trade && (
            <Button type="submit" busy={busy}>
              Save changes
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            busy={busy}
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form.reportValidity()) save(e, !journalOrigin);
            }}
          >
            {journalOrigin ? "Save to Strategy Lab" : trade ? "Save & next" : "Save & log next"}
            <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    </form>
  );
}
