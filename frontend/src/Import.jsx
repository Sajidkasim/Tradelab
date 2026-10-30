import { useJournalClock } from "./JournalClock";
import React, { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  ArrowLeft,
  ArrowRight,
  FileCheck,
  Check,
  Settings2,
} from "lucide-react";
import { api } from "./api";
import { Button, Heading, Notice, Stat, Modal, Select } from "./components";
import { money, rvalue, tradeDate } from "./format";
import ImportSettings from "./ImportSettings";
import { testingLabel } from "./importOptions";
import { pendingTags } from "./importTags";

export default function Import({ meta, refresh, onBack, toast }) {
  const { timezone: journalZone, clockName } = useJournalClock();
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
    include_breakeven: meta.import_profile?.include_breakeven ?? true,
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
  const previewRef = useRef();
  const [previewPage, setPreviewPage] = useState(0);
  const pageSize = 20;
  useEffect(() => {
    setPreviewPage(0);
    if (preview) previewRef.current?.scrollIntoView({ block: "start" });
  }, [preview]);
  const unrecognised = pendingTags(preview?.tags, meta.tag_mappings);
  function invalidate() {
    setPreview(null);
    setDone(null);
    setError("");
    setConfirm(false);
  }
  function choose(next) {
    if (busy) return;
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
    f.append("include_breakeven", profile.include_breakeven);
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
          `${result.inserted} trades added. ${result.updated || 0} label updates. ${result.skipped} duplicates skipped.${result.excluded_breakeven ? ` ${result.excluded_breakeven} break-even trades excluded.` : ""}`,
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
    <div className={`import-page ${preview ? "has-preview" : ""}`}>
      <Button className="back-button" disabled={busy} onClick={onBack}>
        <ArrowLeft size={16} /> Back to trades
      </Button>
      <Heading
        title="Import trades"
        action={
          <Button
            disabled={busy}
            onClick={() => setSettings({ section: "files" })}
          >
            <Settings2 size={15} /> Import settings
          </Button>
        }
      />
      <div className="card import-card">
        <p className="import-context">
          {testingLabel(source)} ·{" "}
          {timezone === "Etc/GMT+4" ? "UTC−4" : timezone}
        </p>
        <button
          disabled={busy}
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
          disabled={busy}
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
        <Select
          label="Include break-even trades?"
          values={[
            { value: "yes", label: "Yes — include them" },
            { value: "no", label: "No — leave them out" },
          ]}
          value={profile.include_breakeven ? "yes" : "no"}
          disabled={busy}
          onChange={(e) => {
            const include = e.target.value === "yes";
            setProfile((current) => ({
              ...current,
              include_breakeven: include,
            }));
            invalidate();
          }}
        />
        <small className="muted">
          Break-even means exactly $0 realised net P&amp;L, after recorded fees.
          Only incoming trades are affected; existing trades stay saved.
        </small>
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
            {done.skipped} duplicates skipped. Review any missing setup details
            or original risk next.
          </p>
          {done.excluded_breakeven > 0 && (
            <p>{done.excluded_breakeven} break-even trades excluded.</p>
          )}
          <Button variant="primary" disabled={busy} onClick={onBack}>
            Review & tag trades <ArrowRight size={16} />
          </Button>
          <Button
            disabled={busy}
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
        <section ref={previewRef} className="card preview-card">
          <div className="section-title">
            <div>
              <h2>Check the preview</h2>
              <p>
                {preview.native
                  ? "Recognised FX Replay Analytics · Backtesting"
                  : testingLabel(source)}
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
          {preview.excluded_breakeven > 0 && (
            <Notice>
              {preview.excluded_breakeven} break-even trades excluded. They will
              not be added or updated.
            </Notice>
          )}
          {!preview.total_rows && preview.excluded_breakeven > 0 && (
            <p>
              Nothing to import after excluding break-even trades. Choose Yes
              above to include them.
            </p>
          )}
          <div className="import-coverage">
            <strong>What came through</strong>
            <p>
              Strategies: {preview.coverage.strategies}/{preview.coverage.total}{" "}
              · Confirmations: {preview.coverage.confirmations}/
              {preview.coverage.total} · Notes: {preview.coverage.notes}/
              {preview.coverage.total}
            </p>
            {!preview.coverage.notes && (
              <p>No trade notes were found in this file.</p>
            )}
            <p>
              Export times interpreted as{" "}
              {timezone === "Etc/GMT+4" ? "fixed UTC−4" : timezone}. Preview
              times below are shown in {clockName} time.
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
                  <th>Entry · {clockName}</th>
                  <th>Net result</th>
                  <th>Realised R</th>
                  <th>Strategy</th>
                  <th>Setup details</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .slice(previewPage * pageSize, (previewPage + 1) * pageSize)
                  .map((row, i) => (
                    <tr key={i}>
                      <td data-label="Market">{row.symbol}</td>
                      <td data-label="Side">{row.direction}</td>
                      <td data-label={`Entry · ${clockName}`}>
                        {tradeDate(row.entry_time, journalZone)}
                      </td>
                      <td data-label="Net result">{money(row.net_pnl)}</td>
                      <td data-label="Realised R">{rvalue(row.r_multiple)}</td>
                      <td data-label="Strategy">
                        {row.setup_name || "Unclassified"}
                      </td>
                      <td data-label="Setup details">
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
                          {row.target_rr && row.target_rr !== "Not recorded"
                            ? ` · Target RR ${row.target_rr}${row.fixed_exit ? " · full target / stop" : ""}`
                            : ""}
                        </small>
                      </td>
                      <td data-label="Status">{row.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > pageSize && (
            <nav className="preview-pagination" aria-label="Preview pages">
              <span>
                {previewPage * pageSize + 1}–
                {Math.min((previewPage + 1) * pageSize, preview.rows.length)} of{" "}
                {preview.rows.length} preview rows
              </span>
              <div>
                <Button
                  disabled={previewPage === 0}
                  onClick={() => setPreviewPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  disabled={(previewPage + 1) * pageSize >= preview.rows.length}
                  onClick={() => setPreviewPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
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
                    {item.target_rr && item.target_rr !== "Not recorded"
                      ? ` · Target RR ${item.target_rr}`
                      : ""}
                    {item.note_added ? " · Note appended" : ""}
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
      {preview && (
        <div className="import-action-bar" aria-label="Import actions">
          <div className="import-action-summary" role="status">
            {error && <span role="alert">{error}</span>}
            <strong>
              {preview.counts.new || preview.counts.updates
                ? `${preview.counts.new} new trades · ${preview.counts.duplicates} duplicates skipped`
                : "Nothing new to import"}
            </strong>
            <small>
              {preview.counts.updates
                ? `${preview.counts.updates} existing trades have label updates.`
                : preview.counts.new
                  ? "Review the preview, then confirm to save."
                  : `${preview.counts.duplicates} duplicates skipped · Your lab is unchanged.`}
              {preview.counts.errors
                ? ` ${preview.counts.errors} rows with errors — check the preview.`
                : ""}
            </small>
          </div>
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
        </div>
      )}
      {confirm && (
        <Modal
          title="Confirm import"
          onClose={() => !busy && setConfirm(false)}
        >
          <div className="stack">
            <p>
              Add {preview.counts.new} trades to your lab? Duplicates
              and invalid rows will be skipped.{" "}
              {preview.excluded_breakeven > 0
                ? `${preview.excluded_breakeven} break-even trades will also be excluded. `
                : ""}
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
    </div>
  );
}
