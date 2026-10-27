import React, { useState } from "react";
import { Modal, Button, Select, Segments, Notice } from "./components";
import TagMeanings from "./TagMeanings";
import { sourceOptions } from "./importOptions";

const columns = {
  symbol: "Market",
  direction: "Buy or sell",
  qty: "Contracts / quantity",
  entry_time: "Entry time",
  exit_time: "Exit time",
  entry_price: "Entry price",
  exit_price: "Exit price",
  stop_price: "Original stop",
  target_price: "Planned target",
  fees: "Fees",
  pnl: "Realised profit or loss",
  risk_amount: "Original risk ($)",
  r_multiple: "Realised R",
  setup_name: "Strategy",
  tags: "Tags",
  notes: "Notes",
  external_id: "Trade ID",
  price: "Fill price",
  timestamp: "Fill time",
};
export default function ImportSettings({
  meta,
  profile,
  mapping,
  detected,
  section = "files",
  review = false,
  onSaveFiles,
  onSaveMeanings,
  onClose,
  busy,
}) {
  const [tab, setTab] = useState(section);
  const [files, setFiles] = useState({ ...profile });
  const [columnMap, setColumnMap] = useState({
    ...detected?.mapping,
    ...mapping,
  });
  const [error, setError] = useState("");
  const change = (key, value) => setFiles((f) => ({ ...f, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      await onSaveFiles(files, columnMap);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal title="Import settings" onClose={() => !busy && onClose()}>
      <div className="import-settings">
        <Segments
          values={[
            { value: "files", label: "File preferences" },
            { value: "tags", label: "Tag meanings" },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value);
            setError("");
          }}
          label="Import settings sections"
        />
        {tab === "files" ? (
          <form className="stack import-file-settings" onSubmit={save}>
            <div>
              <h3>Where and how to read your trades</h3>
              <p>
                Saved for future imports. Check the export's clock if trade
                times look different.
              </p>
            </div>
            <Select
              label="Save into account"
              values={meta.accounts.map((a) => ({
                value: a.id,
                label: a.name,
              }))}
              value={files.account_id}
              onChange={(e) => change("account_id", Number(e.target.value))}
            />
            <Select
              label="These trades are…"
              values={sourceOptions}
              value={files.source}
              onChange={(e) => change("source", e.target.value)}
            />
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
              value={files.timezone}
              onChange={(e) => change("timezone", e.target.value)}
            />
            <small className="muted">
              Choose the clock used in the file. PrimusLab displays trade times
              in New York time.
            </small>
            <label className="review-check">
              <input
                type="checkbox"
                checked={files.dayfirst}
                onChange={(e) => change("dayfirst", e.target.checked)}
              />{" "}
              Day-first dates (31/12/2026)
            </label>
            <div className="import-update-option">
              <label className="review-check">
                <input
                  type="checkbox"
                  checked={files.update_labels}
                  onChange={(e) => change("update_labels", e.target.checked)}
                />{" "}
                Update labels on existing trades
              </label>
              <small>
                Normally, duplicates are skipped. Turn this on to preview label
                changes to trades already saved. Financial results stay
                unchanged and existing notes are retained.
              </small>
            </div>
            <details className="disclosure">
              <summary>Match columns manually</summary>
              <div className="stack">
                <p>
                  FX Replay files are recognised automatically. Use this only if
                  another export's columns need matching.
                </p>
                {detected && !detected.native ? (
                  <div className="form-grid two">
                    {Object.entries(columns).map(([key, title]) => (
                      <Select
                        key={key}
                        label={title}
                        values={[
                          { value: "", label: "Not in file" },
                          ...detected.columns,
                        ]}
                        value={columnMap[key] || ""}
                        onChange={(e) =>
                          setColumnMap({
                            ...columnMap,
                            [key]: e.target.value || null,
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <small>Preview a file first to see its columns.</small>
                )}
              </div>
            </details>
            {error && <Notice error>{error}</Notice>}
            <div className="settings-actions">
              <Button type="submit" variant="primary" busy={busy}>
                Save preferences
              </Button>
              <Button type="button" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <TagMeanings
            saved={meta.tag_mappings || {}}
            suggestions={{ ...meta.tag_suggestions, ...detected?.suggestions }}
            fileTags={detected?.tags || []}
            onSave={onSaveMeanings}
            busy={busy}
            initialReview={review}
          />
        )}
      </div>
    </Modal>
  );
}
