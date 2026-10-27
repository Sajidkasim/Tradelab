import React, { useRef, useState } from "react";
import {
  UploadCloud,
  ArrowLeft,
  ArrowRight,
  FileCheck,
  Check,
  Settings2,
} from "lucide-react";
import { api } from "./api";
import { Button, Heading, Notice, Stat, Modal } from "./components";
import { money, rvalue, tradeDate } from "./format";
import ImportSettings from "./ImportSettings";
import { sourceOptions } from "./importOptions";
import { pendingTags } from "./importTags";

export default function Import({ meta, refresh, onBack, toast }) {
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState(null),
    [detected, setDetected] = useState(null),
    [done, setDone] = useState(null);
  const [profile, setProfile] = useState({
    account_id: meta.accounts.some(
      (a) => a.id === meta.import_profile?.account_id,
    )
      ? meta.import_profile.account_id
      : meta.accounts[0]?.id,
    source: meta.import_profile?.source || "fxreplay",
    timezone: meta.import_profile?.timezone || "UTC",
    dayfirst: meta.import_profile?.dayfirst || false,
    update_labels: meta.import_profile?.update_labels || false,
  });
  const {
    account_id: account,
    source,
    timezone,
    update_labels: updateLabels,
  } = profile;
  const [mapping, setMapping] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [settings, setSettings] = useState(null);
  const ref = useRef();
  const unrecognised = pendingTags(preview?.tags, meta.tag_mappings);
  function invalidate() {
    setPreview(null);
    setDone(null);
    setError("");
    setConfirm(false);
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
    f.append("dayfirst", profile.dayfirst);
    f.append("mapping", JSON.stringify(mapping));
    f.append("update_labels", updateLabels);
    f.append("remember_profile", true);
    if (preview) f.append("preview_token", preview.preview_token);
    return f;
  }
  async function previewFile() {
    const result = await api("/import/preview", {
      method: "POST",
      body: form(),
    });
    setPreview(result);
    setDetected(result);
  }
  async function upload(action) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (action === "preview") await previewFile();
      else {
        const result = await api("/import/confirm", {
          method: "POST",
          body: form(),
        });
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
  async function saveFiles(next, columns) {
    setBusy(true);
    try {
      const saved = await api("/import-preferences", {
        method: "PUT",
        body: next,
      });
      setProfile(saved);
      setMapping(columns);
      invalidate();
      await refresh();
      setSettings(null);
      toast("Import preferences saved.");
    } finally {
      setBusy(false);
    }
  }
  async function saveMeanings(next) {
    setBusy(true);
    try {
      await api("/tag-mappings", { method: "PUT", body: next });
      await refresh();
      invalidate();
      if (file) {
        try {
          await previewFile();
        } catch (e) {
          setError(e.message);
        }
      }
      toast("Tag meaning saved for future imports.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to trades
      </Button>
      <Heading
        title="Import trades"
        action={
          <Button onClick={() => setSettings({ section: "files" })}>
            <Settings2 size={15} /> Import settings
          </Button>
        }
      />
      <div className="card import-card">
        <p className="import-context">
          {meta.accounts.find((item) => item.id === account)?.name} ·{" "}
          {sourceOptions.find((item) => item.value === source)?.label} ·{" "}
          {timezone === "Etc/GMT+4" ? "UTC−4" : timezone}
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
          Saved tag meanings are applied automatically. Preview your trades
          before saving.
        </p>
        {updateLabels && (
          <Notice>
            Label updates are on. Existing trades may receive the changes shown
            in your preview. You can change this in Import settings.
          </Notice>
        )}
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
      {preview && unrecognised.length > 0 && (
        <div className="card import-attention">
          <div>
            <h3>
              {unrecognised.length}{" "}
              {unrecognised.length === 1 ? "new tag" : "new tags"} to review
            </h3>
            <p>
              Tell PrimusLab what they mean once, or keep them as original tags
              only.
            </p>
          </div>
          <Button
            onClick={() => setSettings({ section: "tags", review: true })}
          >
            Review new tags <ArrowRight size={14} />
          </Button>
        </div>
      )}
      {settings && (
        <ImportSettings
          meta={meta}
          profile={profile}
          mapping={mapping}
          detected={detected}
          section={settings.section}
          review={settings.review}
          onSaveFiles={saveFiles}
          onSaveMeanings={saveMeanings}
          busy={busy}
          onClose={() => setSettings(null)}
        />
      )}
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
