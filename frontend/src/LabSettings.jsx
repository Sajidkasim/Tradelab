import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal, Field, Select, Button, Notice } from "./components";

export default function LabSettings({ meta, refresh, toast, onClose }) {
  const [settings, setSettings] = useState(() =>
    structuredClone(meta.lab_settings),
  );
  const [news, setNews] = useState(settings.news.join("\n"));
  const [conditions, setConditions] = useState(settings.conditions.join("\n"));
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
      await api("/lab-settings", {
        method: "PUT",
        body: {
          ...settings,
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
      toast("Lab settings saved. Session filters now use your windows.");
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
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save} className="stack lab-settings-form">
        <div>
          <h3>Session windows</h3>
          <p className="muted">
            Trades are grouped by entry time. Changing these windows regroups
            the results without changing your saved trades.
          </p>
        </div>
        <Select
          label="Session clock"
          value={settings.timezone}
          onChange={(e) =>
            setSettings({ ...settings, timezone: e.target.value })
          }
          values={[
            { value: "Etc/GMT+4", label: "Fixed UTC−4 · same offset all year" },
            {
              value: "America/New_York",
              label: "New York clock · follows daylight saving",
            },
          ]}
        />
        <small className="muted">
          New York uses UTC−4 in summer and UTC−5 in winter. Fixed UTC−4 stays
          the same all year. Overnight windows, such as 20:00–02:00, continue
          into the next day.
        </small>
        <div className="session-settings-list">
          {settings.sessions.map((session, index) => (
            <div className="session-settings-row" key={index}>
              <Field label={`Session ${index + 1} name`}>
                <input
                  required
                  maxLength={80}
                  value={session.name}
                  onChange={(e) => changeSession(index, "name", e.target.value)}
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
                  onChange={(e) => changeSession(index, "end", e.target.value)}
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
                    sessions: settings.sessions.filter((_, i) => i !== index),
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
          Start times are included; end times belong to the next window. Times
          outside your windows remain included under All sessions.
        </small>
        <details className="disclosure">
          <summary>News & market condition labels</summary>
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
        </details>
        {error && <Notice error>{error}</Notice>}
        <div className="actions">
          <Button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save lab settings
          </Button>
        </div>
      </form>
    </Modal>
  );
}
