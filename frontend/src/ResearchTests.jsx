import React, { useState } from "react";
import { FlaskConical, Plus, Copy, Pencil, Archive, ArrowDown } from "lucide-react";
import { api } from "./api";
import { Button, Modal, Field, Select, Notice } from "./components";
import { testOptions } from "./research";

const blank = {
  name: "",
  strategy: "",
  symbol: "",
  target_rr: "",
  rules: "",
  archived: false,
};
const editable = (test) =>
  Object.fromEntries(
    Object.keys(blank).map((key) => [key, test[key] ?? blank[key]]),
  );

export function TestSelector({ studies, value, onChange, onManage, onAssign, onTrades }) {
  const current = studies.find((test) => test.id === value);
  return (
    <section className="research-toolbar" aria-label="Research controls">
      <Select
        label="Research test"
        values={testOptions(studies, value, true)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button onClick={onManage}>
        <FlaskConical size={16} /> My tests
      </Button>
      {current && (
        <div className="research-context">
          <span>
            {current.trade_count} trades
            {current.target_rr ? ` · planned ${current.target_rr}` : ""}
          </span>
          <Button onClick={() => onAssign(current.id)}>
            Add existing trades
          </Button>
        </div>
      )}
      <Button variant="primary" className="jump-to-trades" onClick={onTrades}>
        Go to trades <ArrowDown size={16} aria-hidden="true" />
      </Button>
    </section>
  );
}

export default function ResearchTests({
  meta,
  refresh,
  toast,
  onSelect,
  onAssign,
  onClose,
}) {
  const [editing, setEditing] = useState(meta.studies.length ? null : "new");
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = meta.studies.find((test) => test.id === editing);
  const frozen = Boolean(current?.trade_count);
  function edit(test, duplicate = false) {
    setError("");
    setEditing(duplicate ? "new" : test.id);
    setForm({
      ...editable(test),
      archived: false,
      ...(duplicate ? { name: `${test.name} · new test` } : {}),
    });
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(
        editing === "new" ? "/studies" : `/studies/${editing}`,
        { method: editing === "new" ? "POST" : "PUT", body: form },
      );
      await refresh();
      onSelect(result.id);
      toast(
        "Test saved. Its rules describe the test; recorded results stay unchanged.",
      );
      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(test) {
    setBusy(true);
    setError("");
    try {
      await api(`/studies/${test.id}`, {
        method: "PUT",
        body: { ...editable(test), archived: !test.archived },
      });
      await refresh();
      toast(
        test.archived
          ? "Test restored."
          : "Test archived. Its trades remain saved.",
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="My tests" onClose={() => !busy && onClose()}>
      <div className="stack">
        <p className="muted">
          Keep each experiment together. Choose your own strategy, market and
          optional target. Existing trades start outside tests.
        </p>
        {editing === null ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditing("new");
                setForm(blank);
              }}
            >
              <Plus size={16} /> New test
            </Button>
            <div className="research-test-list">
              {meta.studies.map((test) => (
                <article className="research-test-item" key={test.id}>
                  <div>
                    <strong>{test.name}</strong>
                    <small>
                      {test.trade_count} trades
                      {test.target_rr ? ` · planned ${test.target_rr}` : ""}
                      {test.archived ? " · Archived" : ""}
                    </small>
                  </div>
                  <div className="actions">
                    <Button
                      onClick={() => {
                        onSelect(test.id);
                        onClose();
                      }}
                    >
                      Open test
                    </Button>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${test.name}`}
                      onClick={() => edit(test)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Duplicate ${test.name}`}
                      onClick={() => edit(test, true)}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`${test.archived ? "Restore" : "Archive"} ${test.name}`}
                      onClick={() => archive(test)}
                    >
                      <Archive size={16} />
                    </button>
                  </div>
                  {!test.archived && (
                    <Button
                      onClick={() => {
                        onAssign(test.id);
                        onClose();
                      }}
                    >
                      Add existing trades
                    </Button>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={save}>
            <Field
              label="Test name"
              hint="For example: NQ reversals · Jan–Mar 2013"
            >
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="form-grid two">
              <Field label="Strategy for this test · optional">
                <input
                  list="test-strategies"
                  disabled={frozen}
                  value={form.strategy}
                  maxLength={120}
                  onChange={(e) =>
                    setForm({ ...form, strategy: e.target.value })
                  }
                />
                <datalist id="test-strategies">
                  {meta.strategies.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Market for this test · optional">
                <input
                  list="test-markets"
                  disabled={frozen}
                  maxLength={30}
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                />
                <datalist id="test-markets">
                  {Object.keys(meta.instruments).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field
              label="Planned target RR · optional"
              hint="For example 1:3. This is a test rule, not a realised return."
            >
              <input
                placeholder="Leave blank if it varies"
                disabled={frozen}
                maxLength={30}
                value={form.target_rr}
                onChange={(e) =>
                  setForm({ ...form, target_rr: e.target.value })
                }
              />
            </Field>
            <Field label="Test rules · optional">
              <textarea
                rows={4}
                disabled={frozen}
                maxLength={6000}
                placeholder="What must happen before you take a trade?"
                value={form.rules}
                onChange={(e) => setForm({ ...form, rules: e.target.value })}
              />
            </Field>
            <small className="muted">
              {frozen
                ? "This test has trades, so its rules are fixed. Duplicate it to try a different target or entry rule."
                : "After adding trades, start a new test to change these rules. Importing into a test never guesses a strategy or risk amount."}
            </small>
            <div className="actions">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Back
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Save test
              </Button>
            </div>
          </form>
        )}
        {error && <Notice error>{error}</Notice>}
      </div>
    </Modal>
  );
}
