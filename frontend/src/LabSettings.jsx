import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal, Field, Select, Button, Notice, Segments } from "./components";
import TagCleanup from "./TagCleanup";

export default function LabSettings({ meta, refresh, toast, onClose }) {
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
  const changeSession = (index, key, value) =>
    setSettings((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) =>
        i === index ? { ...session, [key]: value } : session,
      ),
    }));
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
  return (
    <Modal
      title="Lab settings"
      className="lab-settings-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) =>
          tab === "cleanup" ? event.preventDefault() : save(event)
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
            <div><h3>Strategies & key levels</h3><p className="muted">One name per line. These lists are shared with Explore and trade entry. Removing a name hides the choice; its saved trades are kept.</p></div>
            <div className="form-grid two">
              <Field label="Strategies" hint="The setups you want available in your lab."><textarea rows={12} value={strategies} onChange={(event) => setStrategies(event.target.value)} /></Field>
              <Field label="Key levels / PDA" hint="The levels you use to classify your trades."><textarea rows={12} value={levels} onChange={(event) => setLevels(event.target.value)} /></Field>
            </div>
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
            <div className="form-grid two">
              <Field
                label="Level timeframes"
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
            <small className="muted">
              To recognise a different CSV tag name, use Import → Import
              settings → Tag meanings. Not recorded is provided automatically.
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
        {error && <Notice error>{error}</Notice>}
        {tab !== "cleanup" && (
          <div className="actions">
            <Button type="button" disabled={busy} onClick={onClose}>
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
}
