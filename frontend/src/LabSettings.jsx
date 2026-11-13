import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal, Field, Select, Button, Notice, Segments } from "./components";
import CustomFilterBuilder from "./CustomFilterBuilder";
import TagInput from "./TagInput";
import TagCleanup from "./TagCleanup";

const lines = (value) => value.split("\n").map((item) => item.trim()).filter(Boolean);

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
    confirmations: settings.confirmations,
    level_timeframes: settings.level_timeframes,
    entry_timeframes: settings.entry_timeframes,
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
    const active = Array.isArray(current) ? current : lines(current);
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
                <Button type="button" onClick={() => onRestore([...active, name])}>Restore {name}</Button>
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
      if (tab === "context") {
        await api("/lab-settings", { method: "PUT", body: {
          sessions: settings.sessions, timezone: settings.timezone,
          news: lines(news), conditions: lines(conditions),
        } });
        if (journalClock !== (meta.journal_preferences?.timezone || "America/New_York")) {
          await api("/journal-preferences", { method: "PUT", body: { timezone: journalClock } });
        }
      } else {
        await api("/lab-settings", { method: "PUT", body: { ...meta.lab_settings, ...labels } });
        const strategyList = lines(strategies);
        const levelList = lines(levels);
        if (strategies !== meta.playbook.strategies.join("\n") || levels !== meta.playbook.levels.join("\n")) {
          await api("/playbook", { method: "PUT", body: { strategies: strategyList, levels: levelList } });
        }
      }
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
          ["maintenance", "dynamic"].includes(tab) ? event.preventDefault() : save(event)
        }
        className="stack lab-settings-form"
      >
        <Segments
          label="Lab settings sections"
          values={[
            { value: "context", label: "Time & Context" },
            { value: "setup", label: "Setup Labels" },
            { value: "dynamic", label: "Dynamic Fields" },
            { value: "maintenance", label: "Maintenance" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "context" && <section className="lab-settings-card stack">
          <h3>Timezone Settings</h3>
          <Select label="Tester clock" value={journalClock} onChange={(e) => setJournalClock(e.target.value)} values={[{value:"America/New_York",label:"New York · EST / EDT"},{value:"Europe/London",label:"UK · GMT / BST"}]} />
          <p className="muted">Used for trade entry, trade dates, graph times and From/To date filters. UK time follows GMT and BST automatically. Stored trade timestamps stay in UTC.</p>
          <p className="muted">Session windows and the Day filter use the Session clock. CSV files use the export time zone in Import settings.</p>
        </section>}
        {tab === "setup" && (
          <div className="lab-settings-card stack">
            <div><h3>Strategies & key levels</h3><p className="muted">One name per line. Each choice becomes an import tag automatically and is shared with Explore and trade entry. Removing a name hides the choice; its saved trades are kept.</p></div>
            <div className="form-grid two">
              <Field label="Strategies" hint="The setups you want available in your lab."><textarea rows={12} value={strategies} onChange={(event) => setStrategies(event.target.value)} /></Field>
              <Field label="Key levels" hint="The levels you use to classify your trades."><textarea rows={12} value={levels} onChange={(event) => setLevels(event.target.value)} /></Field>
            </div>
            <small className="muted">Changing a list keeps existing trade labels. Use Clean up tags when you want to merge or rename labels already saved on trades.</small>
          </div>
        )}
        {tab === "maintenance" && <>
          <section className="lab-settings-card stack"><TagCleanup refresh={refresh} toast={toast} /></section>
          <section className="lab-settings-card stack">
            <h3>Archived choices</h3>
            {archiveList('strategies', strategies, (items) => { setStrategies(items.join("\n")); setTab("setup"); })}
            {archiveList('levels', levels, (items) => { setLevels(items.join("\n")); setTab("setup"); })}
            {Object.entries(labels).map(([key, values]) => <React.Fragment key={key}>
              {archiveList(key, values, (items) => { setLabels((current) => ({ ...current, [key]: items })); setTab("setup"); })}
            </React.Fragment>)}
            {!Object.values(meta.archived_choices || {}).some((items) => items.length) && <p className="muted">No archived choices.</p>}
          </section>
        </>}
        {tab === "setup" && (
          <section className="lab-settings-card stack">
            <div>
              <h3>Setup choices</h3>
              <p className="muted">Press Enter to add a choice. Removed choices stay on saved trades.</p>
            </div>
            <TagInput label="Confirmations / confluence" values={labels.confirmations}
              onChange={(values) => setLabels((current) => ({ ...current, confirmations: values }))} />
            <div className="form-grid two">
              <TagInput label="Key level timeframes" values={labels.level_timeframes}
                onChange={(values) => setLabels((current) => ({ ...current, level_timeframes: values }))} />
              <TagInput label="Entry timeframes" values={labels.entry_timeframes}
                onChange={(values) => setLabels((current) => ({ ...current, entry_timeframes: values }))} />
            </div>
            <small className="muted">
              Every saved choice is recognised on import automatically. If the same
              timeframe is in both lists, use CSV tags such as Key level timeframe: 15m
              and Entry timeframe: 15m. Missing labels can be left blank.
            </small>
          </section>
        )}
        {tab === "context" && (
          <section className="lab-settings-card stack">
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
          </section>
        )}
        {tab === "context" && (
          <section className="lab-settings-card stack">
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
          </section>
        )}
        {tab === "dynamic" && (
          <>
            <div className="lab-settings-card"><CustomFilterBuilder definitions={meta.custom_trade_fields || []} refresh={refresh} toast={toast} /></div>
            <section className="lab-settings-card stack">
              <h3>Saved Explore presets</h3>
              <p className="muted">Save your current Explore choices as a named setup.</p>
              <div><Button type="button" onClick={() => setConfirmClose("filter")}>Create a saved filter</Button></div>
            </section>
          </>
        )}
        {error && !archiveToDelete && <Notice error>{error}</Notice>}
        {!["maintenance", "dynamic"].includes(tab) && (
          <div className="actions">
            <Button type="button" disabled={busy} onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              {tab === "setup" ? "Save setup labels" : "Save time & context"}
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
