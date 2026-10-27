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
  { value: "csv", label: "Live trading · CSV" },
  { value: "excel", label: "Live trading · Excel" },
];
export default function Import({ meta, refresh, onBack, toast }) {
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState(null),
    [detected, setDetected] = useState(null),
    [done, setDone] = useState(null);
  const [account, setAccount] = useState(
      meta.accounts.some((a) => a.id === meta.import_profile?.account_id)
        ? meta.import_profile.account_id
        : meta.accounts[0]?.id,
    ),
    [source, setSource] = useState(meta.import_profile?.source || "fxreplay"),
    [timezone, setTimezone] = useState(meta.import_profile?.timezone || "UTC"),
    [dayfirst, setDayfirst] = useState(meta.import_profile?.dayfirst || false),
    [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [tagMap, setTagMap] = useState(meta.tag_mappings || {});
  const [updateLabels, setUpdateLabels] = useState(
    meta.import_profile?.update_labels || false,
  );
  const [rememberProfile, setRememberProfile] = useState(true);
  const ref = useRef();
  function editRule(tag, index, key, value) {
    const rules = tagMap[tag]?.rules || [
      tagMap[tag] || { field: "", value: "" },
    ];
    setTagMap({
      ...tagMap,
      [tag]: {
        rules: rules.map((rule, i) =>
          i === index ? { ...rule, [key]: value } : rule,
        ),
      },
    });
  }

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
    f.append("update_labels", updateLabels);
    f.append("remember_profile", rememberProfile);
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
        setTagMap((previous) => ({ ...result.suggestions, ...previous }));
      } else {
        setDone(result);
        setPreview(null);
        setConfirm(false);
        await refresh();
        toast(
          `${result.inserted} trades added. ${result.updated || 0} label updates. ${result.skipped} duplicates skipped.`,
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
        Object.entries(tagMap)
          .map(([tag, entry]) => [
            tag,
            {
              rules: (entry.rules || [entry]).filter(
                (rule) => rule.field && rule.value?.trim(),
              ),
            },
          ])
          .filter(([, entry]) => entry.rules.length),
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
      <Heading title="Import trades" />
      <div className="card import-card">
        <p className="import-context">
          {meta.accounts.find((item) => item.id === account)?.name} ·{" "}
          {sourceOptions.find((item) => item.value === source)?.label}
        </p>
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
          Upload a CSV, Excel or JSON trade export. FX Replay exports are
          recognised automatically. Preview everything before saving.
        </p>
        <details className="disclosure">
          <summary>File options & column mapping</summary>
          <div className="stack">
            <div className="form-grid two">
              <Select
                label="Save into account"
                values={meta.accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
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

            <Select
              label="Export time zone"
              values={[
                { value: "UTC", label: "UTC" },
                { value: "Etc/GMT+4", label: "Fixed UTC−4" },
                {
                  value: "America/New_York",
                  label: "New York clock (seasonal)",
                },
                { value: "Europe/London", label: "London clock (seasonal)" },
              ]}
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
        <div className="import-preferences">
          <label className="review-check">
            <input
              type="checkbox"
              checked={updateLabels}
              onChange={(e) => {
                setUpdateLabels(e.target.checked);
                invalidate();
              }}
            />
            Update labels on existing trades
          </label>
          <small>
            Only provided labels are updated. Saved results and notes are
            preserved; blank fields never clear your work.
          </small>
          <label className="review-check">
            <input
              type="checkbox"
              checked={rememberProfile}
              onChange={(e) => {
                setRememberProfile(e.target.checked);
                invalidate();
              }}
            />
            Remember my import settings
          </label>
        </div>
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
          <h2>
            {done.inserted} trades added
            {done.updated ? ` · ${done.updated} updated` : ""}
          </h2>
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
            {updateLabels && (
              <Stat label="Label updates" value={preview.counts.updates || 0} />
            )}
          </div>
          <div className="import-coverage">
            <strong>What came through</strong>
            <p>
              Strategies: {preview.coverage.strategies}/{preview.coverage.total}{" "}
              · Confirmations: {preview.coverage.confirmations}/
              {preview.coverage.total} · Notes: {preview.coverage.notes}/
              {preview.coverage.total}
            </p>
            {!preview.coverage.notes && (
              <p>No journal notes were found in this file.</p>
            )}
            <p>
              Export times interpreted as{" "}
              {timezone === "Etc/GMT+4" ? "fixed UTC−4" : timezone}. Preview
              times below are shown in New York time.
            </p>
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
                  <th>Setup details</th>
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
                    <td>
                      {[
                        row.labels?.level,
                        row.labels?.timeframe,
                        row.labels?.entry_timeframe,
                      ]
                        .filter((v) => v && v !== "Not recorded")
                        .join(" · ") || "Not recorded"}
                      <small className="table-caption">
                        {row.labels?.confirmations?.join(" + ") ||
                          "Confirmations not recorded"}
                        {row.has_note ? " · Note included" : ""}
                      </small>
                    </td>
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
                  <div className="tag-map-group" key={tag}>
                    <strong>{tag}</strong>
                    {(
                      tagMap[tag]?.rules || [
                        tagMap[tag] || { field: "", value: "" },
                      ]
                    ).map((rule, index) => (
                      <div className="tag-map" key={index}>
                        <Select
                          label={`Field ${index + 1} for ${tag}`}
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
                          value={rule.field || ""}
                          onChange={(e) =>
                            editRule(tag, index, "field", e.target.value)
                          }
                        />
                        <Field label={`Value ${index + 1} for ${tag}`}>
                          <input
                            value={rule.value || ""}
                            onChange={(e) =>
                              editRule(tag, index, "value", e.target.value)
                            }
                          />
                        </Field>
                        <Button
                          onClick={() => {
                            const rules = tagMap[tag]?.rules || [
                              tagMap[tag] || {},
                            ];
                            setTagMap({
                              ...tagMap,
                              [tag]: {
                                rules: rules.filter((_, i) => i !== index),
                              },
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      disabled={(tagMap[tag]?.rules?.length || 0) >= 8}
                      onClick={() => {
                        const rules =
                          tagMap[tag]?.rules ||
                          (tagMap[tag] ? [tagMap[tag]] : []);
                        setTagMap({
                          ...tagMap,
                          [tag]: {
                            rules: [...rules, { field: "", value: "" }],
                          },
                        });
                      }}
                    >
                      Add another meaning
                    </Button>
                  </div>
                ))}
                <Button busy={busy} onClick={saveMappings}>
                  Save mappings & preview again
                </Button>
              </div>
            </details>
          )}
          {preview.label_updates.length > 0 && (
            <details className="disclosure">
              <summary>
                {preview.label_updates.length} existing trades have label
                changes
              </summary>
              <div>
                {preview.label_updates.map((item) => (
                  <p key={item.id}>
                    Trade {item.id}: {item.previous_strategy || "Unclassified"}{" "}
                    → {item.strategy || "Unclassified"} · {item.labels.level} ·{" "}
                    {item.labels.timeframe} ·{" "}
                    {item.labels.confirmations.join(" + ")}
                    {item.note_added ? " · Note appended" : ""}
                  </p>
                ))}
              </div>
            </details>
          )}
          <Button
            variant="primary"
            busy={busy}
            disabled={!preview.counts.new && !(preview.counts.updates > 0)}
            onClick={() => setConfirm(true)}
          >
            Import {preview.counts.new} trades
            {preview.counts.updates
              ? ` · update ${preview.counts.updates}`
              : ""}{" "}
            <Check size={16} />
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
              and invalid rows will be skipped.{" "}
              {preview.counts.updates
                ? `${preview.counts.updates} existing trades will receive the previewed label updates. Their financial results remain unchanged.`
                : ""}
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
