import React, { useRef, useState } from "react";
import {
  UploadCloud,
  ArrowLeft,
  ArrowRight,
  FileCheck,
  Check,
} from "lucide-react";
import { api } from "./api";
import {
  Button,
  Heading,
  Field,
  Select,
  Notice,
  Stat,
  Modal,
} from "./components";
import { money, rvalue, tradeDate } from "./format";

const targets = [
  "symbol",
  "direction",
  "qty",
  "entry_time",
  "exit_time",
  "entry_price",
  "exit_price",
  "stop_price",
  "target_price",
  "fees",
  "pnl",
  "risk_amount",
  "r_multiple",
  "setup_name",
  "tags",
  "notes",
  "external_id",
  "price",
  "timestamp",
];
const sourceOptions = [
  { value: "fxreplay", label: "FX Replay · Backtesting" },
  { value: "backtest", label: "Other backtesting" },
  { value: "csv", label: "Forward testing · CSV" },
  { value: "excel", label: "Forward testing · Excel" },
];
export default function Import({ meta, refresh, onBack, toast }) {
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState(null),
    [detected, setDetected] = useState(null),
    [done, setDone] = useState(null);
  const [account, setAccount] = useState(meta.accounts[0]?.id),
    [source, setSource] = useState("fxreplay"),
    [timezone, setTimezone] = useState("UTC"),
    [dayfirst, setDayfirst] = useState(false),
    [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [tagMap, setTagMap] = useState(meta.tag_mappings || {});
  const ref = useRef();
  function invalidate() {
    setPreview(null);
    setDone(null);
    setError("");
  }
  function choose(next) {
    invalidate();
    setFile(next);
    setMapping({});
    setDetected(null);
    if (next?.size > 5 * 1024 * 1024)
      setError("Choose a file smaller than 5 MB.");
  }
  function form() {
    const f = new FormData();
    f.append("file", file);
    f.append("account_id", account);
    f.append("source", source);
    f.append("timezone", timezone);
    f.append("dayfirst", dayfirst);
    f.append("mapping", JSON.stringify(mapping));
    if (preview) f.append("preview_token", preview.preview_token);
    return f;
  }
  async function upload(action) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/import/${action}`, {
        method: "POST",
        body: form(),
      });
      if (action === "preview") {
        setPreview(result);
        setDetected(result);
      } else {
        setDone(result);
        setPreview(null);
        setConfirm(false);
        await refresh();
        toast(
          `${result.inserted} trades imported. ${result.skipped} duplicates skipped.`,
        );
      }
    } catch (e) {
      setError(e.message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  async function saveMappings() {
    setBusy(true);
    setError("");
    try {
      const saved = Object.fromEntries(
        Object.entries(tagMap).filter(
          ([tag, rule]) => rule.field && rule.value?.trim(),
        ),
      );
      await api("/tag-mappings", { method: "PUT", body: saved });
      await refresh();
      toast("Tag mappings saved. Preview again to apply them.");
      invalidate();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to trades
      </Button>
      <Heading eyebrow="FROM REPLAY TO RESEARCH" title="Import your trades">
        One file. One preview. Your setup labels stay with every trade.
      </Heading>
      <div className="import-steps">
        <span className={preview || done ? "complete" : "current"}>
          01 Upload
        </span>
        <span className={preview ? "current" : done ? "complete" : ""}>
          02 Preview
        </span>
        <span className={done ? "complete" : ""}>03 Confirm</span>
      </div>
      <div className="card import-card">
        <div className="form-grid two">
          <Select
            label="Save into account"
            values={meta.accounts.map((a) => ({ value: a.id, label: a.name }))}
            value={account}
            onChange={(e) => {
              invalidate();
              setAccount(Number(e.target.value));
            }}
          />
          <Select
            label="These trades are…"
            values={sourceOptions}
            value={source}
            onChange={(e) => {
              invalidate();
              setSource(e.target.value);
            }}
          />
        </div>
        <button
          className={`dropzone ${file ? "has-file" : ""}`}
          onClick={() => ref.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
        >
          <UploadCloud size={30} />
          <strong>{file ? file.name : "Drop your export here"}</strong>
          <span>
            {file
              ? `${(file.size / 1024).toFixed(1)} KB · Click to change file`
              : "or choose a file from your computer"}
          </span>
          <small>CSV, TSV, Excel or JSON · up to 5 MB</small>
        </button>
        <input
          ref={ref}
          type="file"
          className="sr-only"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,.json"
          aria-label="Choose a trade export"
          onChange={(e) => choose(e.target.files[0])}
        />
        <p className="muted">
          FX Replay: export your closed trade history from Analytics. Nothing is
          saved until you confirm.
        </p>
        <details className="disclosure">
          <summary>File options & column mapping</summary>
          <div className="stack">
            <Select
              label="Export time zone"
              values={["UTC", "America/New_York", "Europe/London"]}
              value={timezone}
              onChange={(e) => {
                invalidate();
                setTimezone(e.target.value);
              }}
            />
            <label className="review-check">
              <input
                type="checkbox"
                checked={dayfirst}
                onChange={(e) => {
                  invalidate();
                  setDayfirst(e.target.checked);
                }}
              />
              Day-first dates (31/12/2026)
            </label>
            {detected && !detected.native && (
              <div className="form-grid two">
                {targets.map((t) => (
                  <Select
                    key={t}
                    label={t.replaceAll("_", " ")}
                    values={[
                      { value: "", label: "Not in file" },
                      ...detected.columns,
                    ]}
                    value={
                      t in mapping
                        ? mapping[t] || ""
                        : detected.mapping[t] || ""
                    }
                    onChange={(e) => {
                      setMapping({
                        ...detected.mapping,
                        ...mapping,
                        [t]: e.target.value || null,
                      });
                      invalidate();
                    }}
                  />
                ))}
              </div>
            )}
            {!detected && (
              <small>
                Preview once to see the detected columns. Native FX Replay
                exports are recognised automatically.
              </small>
            )}
          </div>
        </details>
        {error && <Notice error>{error}</Notice>}
        {!preview && !done && (
          <Button
            variant="primary"
            busy={busy}
            disabled={!file || file.size > 5 * 1024 * 1024}
            onClick={() => upload("preview")}
          >
            Preview trades <ArrowRight size={16} />
          </Button>
        )}
      </div>
      {done && (
        <div className="card import-success">
          <FileCheck size={36} />
          <h2>{done.inserted} trades added</h2>
          <p>
            {done.skipped} duplicates skipped. Give your trades a strategy and
            review their confirmations next.
          </p>
          <Button variant="primary" onClick={onBack}>
            Review & tag trades <ArrowRight size={16} />
          </Button>
          <Button
            onClick={() => {
              setDone(null);
              setFile(null);
            }}
          >
            Import another file
          </Button>
        </div>
      )}
      {preview && (
        <section className="card preview-card">
          <div className="section-title">
            <div>
              <h2>Check the preview</h2>
              <p>
                {preview.native
                  ? "Recognised FX Replay Analytics · Backtesting"
                  : sourceOptions.find((s) => s.value === source)?.label}
              </p>
            </div>
            <span className="badge">Not saved yet</span>
          </div>
          <div className="stats compact">
            <Stat label="Will be added" value={preview.counts.new} />
            <Stat
              label="Duplicates skipped"
              value={preview.counts.duplicates}
            />
            <Stat label="Rows with errors" value={preview.counts.errors} />
          </div>
          {preview.native && (
            <Notice>
              Realised P&L is preserved. Planned reward / risk is not realised
              R; unavailable R stays blank.
            </Notice>
          )}
          {preview.errors.length > 0 && (
            <details className="disclosure">
              <summary>{preview.errors.length} rows need attention</summary>
              <div>
                {preview.errors.map((e, i) => (
                  <p key={i}>
                    Row {e.row}: {e.error}
                  </p>
                ))}
              </div>
            </details>
          )}
          {preview.issues.map((text, i) => (
            <Notice key={i}>{text}</Notice>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Entry · New York</th>
                  <th>Net result</th>
                  <th>Realised R</th>
                  <th>Strategy</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.symbol}</td>
                    <td>{row.direction}</td>
                    <td>{tradeDate(row.entry_time)}</td>
                    <td>{money(row.net_pnl)}</td>
                    <td>{rvalue(row.r_multiple)}</td>
                    <td>{row.setup_name || "Unclassified"}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total_rows > 200 && (
            <p className="muted">
              Showing the first 200 of {preview.total_rows} valid trades. The
              confirmed import processes all valid rows.
            </p>
          )}
          {preview.tags.length > 0 && (
            <details className="disclosure">
              <summary>Recognise strategy tags</summary>
              <div className="stack">
                <p>
                  Save how your export tags map to your setup. No guessing, and
                  confirmations still need review.
                </p>
                {preview.tags.map((tag) => (
                  <div className="tag-map" key={tag}>
                    <strong>{tag}</strong>
                    <Select
                      label="Field"
                      values={[
                        { value: "", label: "Ignore" },
                        ...[
                          "strategy",
                          "level",
                          "timeframe",
                          "entry_timeframe",
                          "confirmation",
                          "news",
                          "condition",
                        ],
                      ]}
                      value={tagMap[tag]?.field || ""}
                      onChange={(e) =>
                        setTagMap({
                          ...tagMap,
                          [tag]: { ...tagMap[tag], field: e.target.value },
                        })
                      }
                    />
                    <Field label="Value">
                      <input
                        value={tagMap[tag]?.value || ""}
                        onChange={(e) =>
                          setTagMap({
                            ...tagMap,
                            [tag]: { ...tagMap[tag], value: e.target.value },
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
                <Button busy={busy} onClick={saveMappings}>
                  Save mappings & preview again
                </Button>
              </div>
            </details>
          )}
          <Button
            variant="primary"
            busy={busy}
            disabled={!preview.counts.new}
            onClick={() => setConfirm(true)}
          >
            Import {preview.counts.new} trades <Check size={16} />
          </Button>
        </section>
      )}
      {confirm && (
        <Modal
          title="Confirm import"
          onClose={() => !busy && setConfirm(false)}
        >
          <div className="stack">
            <p>
              Add {preview.counts.new} trades to{" "}
              {meta.accounts.find((a) => a.id === account)?.name}? Duplicates
              and invalid rows will be skipped.
            </p>
            <Button
              variant="primary"
              busy={busy}
              onClick={() => upload("confirm")}
            >
              Confirm import
            </Button>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Back to preview
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
