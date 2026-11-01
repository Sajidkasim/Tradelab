import React, { useState } from "react";
import { Modal, Button, Select, Segments, Notice } from "./components";
import { useJournalClock } from "./JournalClock";
import TagMeanings from "./TagMeanings";
import { sourceOptions, testingType, sourceForType } from "./importOptions";

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
  const { clockName } = useJournalClock();
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
    <Modal className="import-settings-modal" title={review ? "Review tags" : "Import settings"} onClose={() => !busy && onClose()}>
      <div className="import-settings">
        {!review && <Segments
          values={[
            { value: "files", label: "File setup" },
            { value: "tags", label: "Tag meanings" },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value);
            setError("");
          }}
          label="Import settings sections"
        />}
        {tab === "files" ? (
          <form className="stack import-file-settings" onSubmit={save}>
            <div>
              <h3>Your import defaults</h3>
              <p>Set these once. We’ll remember them for your next import.</p>
            </div>
            <Select
              label="Testing type"
              values={sourceOptions}
              value={testingType(files.source)}
              onChange={(e) => change("source", sourceForType(e.target.value, files.source))}
            />
            <Select
              label="File time zone"
              values={[
                { value: "UTC", label: "UTC" },
                { value: "Etc/GMT+4", label: "Fixed UTC−4" },
                {
                  value: "America/New_York",
                  label: "New York · EST / EDT",
                },
                { value: "Europe/London", label: "UK · GMT / BST" },
              ]}
              value={files.timezone}
              onChange={(e) => change("timezone", e.target.value)}
            />
            <small className="muted">
              Choose the clock used in your CSV. Tester display: {clockName} time.
            </small>
            <div className="notice import-default-note">
              Duplicates are skipped. Your tag meanings are remembered.
            </div>
            <details
              className="disclosure import-extra-options"
              open={profile.dayfirst || profile.update_labels || undefined}
            >
              <summary>More options</summary>
              <div className="stack">
                <p>
                  Date format, changes to existing trades and manual column
                  matching.
                </p>
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
                      onChange={(e) =>
                        change("update_labels", e.target.checked)
                      }
                    />{" "}
                    Update labels on existing trades
                  </label>
                  <small>
                    Normally, duplicates are skipped. Turn this on to preview
                    label changes to trades already saved. Financial results
                    stay unchanged and existing notes are retained.
                  </small>
                </div>
                <details className="disclosure">
                  <summary>Match columns manually</summary>
                  <div className="stack">
                    <p>
                      FX Replay files are recognised automatically. Use this
                      only if another export's columns need matching.
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
              </div>
            </details>
            {error && <Notice error>{error}</Notice>}
            <div className="settings-actions">
              <Button type="submit" variant="primary" busy={busy}>
                Save settings
              </Button>
              <Button type="button" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
          <TagMeanings
            saved={meta.tag_mappings || {}}
            automatic={meta.automatic_tags || {}}
            unresolvedTags={detected?.unresolved_tags}
            questions={detected?.tag_questions || []}
            suggestions={{ ...meta.tag_suggestions, ...detected?.suggestions }}
            fileTags={detected?.tags || []}
            onSave={onSaveMeanings}
            busy={busy}
            initialReview={review}
          />
          {review && <div className="settings-actions"><Button disabled={busy} onClick={onClose}>Back to preview</Button><Button disabled={busy} onClick={onClose}>Cancel</Button></div>}
          </>
        )}
      </div>
    </Modal>
  );
}
