import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal, Field, Select, Button, Notice, Segments } from "./components";
import CustomFilterBuilder from "./CustomFilterBuilder";
import TagCleanup from "./TagCleanup";

export default function LabSettings({ meta, refresh, toast, onClose, onCreateFilter }) {
  const [journalClock, setJournalClock] = useState(meta.journal_preferences?.timezone || "America/New_York");
  const [settings, setSettings] = useState(() =>
    structuredClone(meta.lab_settings),
  );
  const [news, setNews] = useState(settings.news.join("\n"));
  const [conditions, setConditions] = useState(settings.conditions.join("\n"));
  const [tab, setTab] = useState("setup");
  const [strategies, setStrategies] = useState(meta.playbook.strategies.join("\n"));
  const [levels, setLevels] = useState(meta.playbook.levels.join("\n"));
  const [labels, setLabels] = useState({
    confirmations: settings.confirmations.join("\n"),
    level_timeframes: settings.level_timeframes.join("\n"),
    entry_timeframes: settings.entry_timeframes.join("\n"),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [archiveToDelete, setArchiveToDelete] = useState(null);
  const requestClose = () => {
    if (!busy) setConfirmClose(true);
  };
  async function deleteArchive() {
    setBusy(true);
    setError("");
    try {
      await api("/lab-settings/archives/delete", { method: "POST", body: archiveToDelete });
      setArchiveToDelete(null);
      await refresh();
      toast("Archived choice deleted.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const changeSession = (index, key, value) =>
    setSettings((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) =>
        i === index ? { ...session, [key]: value } : session,
      ),
    }));
  function archiveList(field, current, onRestore) {
    const title = {
      strategies: "strategies", levels: "key levels", confirmations: "confirmations",
      level_timeframes: "key level timeframes", entry_timeframes: "entry timeframes",
    }[field];
    const active = current.split("\n").map((value) => value.trim()).filter(Boolean);
    const removed = (meta.archived_choices?.[field] || []).filter((value) => !active.includes(value));
    if (!removed.length) return null;
    return (
      <details className="disclosure">
        <summary>Archived {title} · {removed.length}</summary>
        <div className="stack">
          <p>Restore a choice and save to bring it back, or delete it from this list. Saved trades keep their original labels.</p>
          {removed.map((name) => (
            <div className="archive-row" key={name}>
              <span>{name}</span>
              <div className="archive-actions">
                <Button type="button" onClick={() => onRestore([...active, name].join("\n"))}>Restore {name}</Button>
                <button className="icon-button delete-trade" type="button" aria-label={`Delete archived ${name}`}
                  onClick={() => { setError(""); setArchiveToDelete({ field, name }); }}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </details>
    );
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "clock") {
        await api("/journal-preferences", { method: "PUT", body: { timezone: journalClock } });
        await refresh(); toast("Tester clock saved."); onClose(); return;
      }
      if (tab === "strategies") {
        await api("/playbook", { method: "PUT", body: { strategies: strategies.split("\n"), levels: levels.split("\n") } });
        await refresh();
        toast("Your strategy and level lists are saved.");
        onClose();
        return;
      }
      await api("/lab-settings", {
        method: "PUT",
        body: {
          ...settings,
          ...Object.fromEntries(
            Object.entries(labels).map(([key, value]) => [
              key,
              value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            ]),
          ),
          news: news
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          conditions: conditions
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
        },
      });
      await refresh();
      toast("Lab settings saved. Explore and trade entry are updated.");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const settingsDialog = (
    <Modal
      title="Lab settings"
      className="lab-settings-modal"
      onClose={requestClose}
    >
      <form
        onSubmit={(event) =>
          ["cleanup", "advanced"].includes(tab) ? event.preventDefault() : save(event)
        }
        className="stack lab-settings-form"
      >
        <Segments
          label="Lab settings sections"
          values={[
            { value: "clock", label: "Tester clock" },
            { value: "strategies", label: "Strategies & levels" },
            { value: "setup", label: "Setup labels" },
            { value: "sessions", label: "Session windows" },
            { value: "news", label: "News & market" },
            { value: "cleanup", label: "Clean up tags" },
            { value: "advanced", label: "Advanced" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "clock" && <div className="stack">
          <h3>Your tester clock</h3>
          <Select label="Tester clock" value={journalClock} onChange={(e) => setJournalClock(e.target.value)} values={[{value:"America/New_York",label:"New York · EST / EDT"},{value:"Europe/London",label:"UK · GMT / BST"}]} />
          <p className="muted">Used for trade entry, trade dates, graph times and From/To date filters. UK time follows GMT and BST automatically. Stored trade timestamps stay in UTC.</p>
          <p className="muted">Session windows and the Day filter use the Session clock. CSV files use the export time zone in Import settings.</p>
        </div>}
        {tab === "strategies" && (
          <div className="stack">
            <div><h3>Strategies & key levels</h3><p className="muted">One name per line. Each choice becomes an import tag automatically and is shared with Explore and trade entry. Removing a name hides the choice; its saved trades are kept.</p></div>
            <div className="form-grid two">
              <Field label="Strategies" hint="The setups you want available in your lab."><textarea rows={12} value={strategies} onChange={(event) => setStrategies(event.target.value)} /></Field>
              <Field label="Key levels" hint="The levels you use to classify your trades."><textarea rows={12} value={levels} onChange={(event) => setLevels(event.target.value)} /></Field>
            </div>
            {archiveList('strategies',strategies,setStrategies)}
            {archiveList('levels',levels,setLevels)}
            <small className="muted">Changing a list keeps existing trade labels. Use Clean up tags when you want to merge or rename labels already saved on trades.</small>
          </div>
        )}
        {tab === "cleanup" && <TagCleanup refresh={refresh} toast={toast} />}
        {tab === "setup" && (
          <div className="stack">
            <div>
              <h3>Your setup choices</h3>
              <p className="muted">
                One label per line. These lists are shared by Explore and trade
                entry. Removing a choice keeps it on saved trades.
              </p>
            </div>
            <Field
              label="Confirmations / confluence"
              hint="For example: SMT, CISD, MACRO — one per line."
            >
              <textarea
                rows={6}
                value={labels.confirmations}
                onChange={(e) =>
                  setLabels({ ...labels, confirmations: e.target.value })
                }
              />
            </Field>
            {archiveList('confirmations',labels.confirmations,value=>setLabels({...labels,confirmations:value}))}
            <div className="form-grid two">
              <Field
                label="Key level timeframes"
                hint="For example: Weekly, Daily, 4H, 1H — one per line."
              >
                <textarea
                  rows={6}
                  value={labels.level_timeframes}
                  onChange={(e) =>
                    setLabels({ ...labels, level_timeframes: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Entry timeframes"
                hint="For example: 15m, 5m, 1m, 15s — one per line."
              >
                <textarea
                  rows={6}
                  value={labels.entry_timeframes}
                  onChange={(e) =>
                    setLabels({ ...labels, entry_timeframes: e.target.value })
                  }
                />
              </Field>
            </div>
            {archiveList('level_timeframes',labels.level_timeframes,value=>setLabels({...labels,level_timeframes:value}))}
            {archiveList('entry_timeframes',labels.entry_timeframes,value=>setLabels({...labels,entry_timeframes:value}))}
            <small className="muted">
              Every saved choice is recognised on import automatically. If the same
              timeframe is in both lists, use CSV tags such as Key level timeframe: 15m
              and Entry timeframe: 15m. Missing labels can be left blank.
            </small>
          </div>
        )}
        {tab === "sessions" && (
          <>
            <div>
              <h3>Session windows</h3>
              <p className="muted">
                Trades are grouped by entry time. Changing these windows
                regroups the results without changing your saved trades.
              </p>
            </div>
            <Select
              label="Session clock"
              value={settings.timezone}
              onChange={(e) =>
                setSettings({ ...settings, timezone: e.target.value })
              }
              values={[
                { value: "Europe/London", label: "UK clock · GMT / BST" },
                {
                  value: "Etc/GMT+4",
                  label: "Fixed UTC−4 · same offset all year",
                },
                {
                  value: "America/New_York",
                  label: "New York clock · follows daylight saving",
                },
              ]}
            />
            <small className="muted">
              New York uses UTC−4 in summer and UTC−5 in winter. Fixed UTC−4
              stays the same all year. Overnight windows, such as 20:00–02:00,
              continue into the next day.
            </small>
            <div className="session-settings-list">
              {settings.sessions.map((session, index) => (
                <div className="session-settings-row" key={index}>
                  <Field label={`Session ${index + 1} name`}>
                    <input
                      required
                      maxLength={80}
                      value={session.name}
                      onChange={(e) =>
                        changeSession(index, "name", e.target.value)
                      }
                    />
                  </Field>
                  <Field label={`Session ${index + 1} starts`}>
                    <input
                      type="time"
                      required
                      value={session.start}
                      onChange={(e) =>
                        changeSession(index, "start", e.target.value)
                      }
                    />
                  </Field>
                  <Field label={`Session ${index + 1} ends`}>
                    <input
                      type="time"
                      required
                      value={session.end}
                      onChange={(e) =>
                        changeSession(index, "end", e.target.value)
                      }
                    />
                  </Field>
                  <button
                    className="icon-button delete-trade"
                    type="button"
                    disabled={settings.sessions.length === 1}
                    aria-label={`Remove session ${index + 1}`}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        sessions: settings.sessions.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              disabled={settings.sessions.length >= 16}
              onClick={() =>
                setSettings({
                  ...settings,
                  sessions: [
                    ...settings.sessions,
                    { name: "", start: "16:00", end: "20:00" },
                  ],
                })
              }
            >
              <Plus size={16} /> Add session
            </Button>
            <small className="muted">
              Start times are included; end times belong to the next window.
              Times outside your windows remain included under All sessions.
            </small>
          </>
        )}
        {tab === "news" && (
          <div className="stack">
            <h3>News & market condition labels</h3>
            <div className="form-grid two">
              <Field label="News labels" hint="One per line">
                <textarea
                  rows={5}
                  value={news}
                  onChange={(e) => setNews(e.target.value)}
                />
              </Field>
              <Field label="Market condition labels" hint="One per line">
                <textarea
                  rows={5}
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                />
              </Field>
            </div>
            <p className="muted">
              Removing a label from these lists keeps it on existing trades. Not
              recorded is provided automatically for unlabelled trades.
            </p>
          </div>
        )}
        {tab === "advanced" && (
          <div className="stack">
            <CustomFilterBuilder definitions={meta.custom_trade_fields || []} refresh={refresh} toast={toast} />
            <h3>Saved Explore presets</h3>
            <p className="muted">Save your current strategy, session and other Explore choices as a named setup you can apply again from the Results page.</p>
            <Button type="button" onClick={() => setConfirmClose("filter")}>Create a saved filter</Button>
          </div>
        )}
        {error && !archiveToDelete && <Notice error>{error}</Notice>}
        {!["cleanup", "advanced"].includes(tab) && (
          <div className="actions">
            <Button type="button" disabled={busy} onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              {tab === "strategies" ? "Save strategies & levels" : "Save lab settings"}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
  return (
    <>
      {settingsDialog}
      {confirmClose && (
        <Modal title={confirmClose === "filter" ? "Open saved filters?" : "Close Lab settings?"} onClose={() => setConfirmClose(false)}>
          <p>Any unsaved changes will be lost.</p>
          <div className="actions">
            <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
            <Button variant="primary" onClick={confirmClose === "filter" ? onCreateFilter : onClose}>
              {confirmClose === "filter" ? "Open saved filters" : "Close settings"}
            </Button>
          </div>
        </Modal>
      )}
      {archiveToDelete && (
        <Modal title="Delete archived choice?" onClose={() => !busy && setArchiveToDelete(null)}>
          <p>Remove “{archiveToDelete.name}” from the archive list. Saved trades keep this label.</p>
          {error && <Notice error>{error}</Notice>}
          <div className="actions">
            <Button disabled={busy} onClick={() => setArchiveToDelete(null)}>Keep choice</Button>
            <Button variant="primary" busy={busy} onClick={deleteArchive}>Delete from archive</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
