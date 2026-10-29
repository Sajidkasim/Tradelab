import React, { useState } from "react";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Button, Modal, Field, Select, Notice } from "./components";

export default function SavedSetups({
  items,
  filters,
  onApply,
  refresh,
  toast,
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/saved-setups", { method: "POST", body: { name, filters } });
      await refresh();
      setOpen(false);
      setName("");
      toast("Setup saved. Restore these filters in one click.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    setBusy(true);
    setError("");
    try {
      await api(`/saved-setups/${id}`, { method: "DELETE" });
      await refresh();
      toast("Saved setup removed.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="saved-setup-toolbar">
        {items.length > 0 && (
          <Select
            label="Saved setup"
            value=""
            values={[
              { value: "", label: "Choose a saved setup" },
              ...items.map((item) => ({ value: item.id, label: item.name })),
            ]}
            onChange={(e) => {
              const item = items.find((item) => item.id === e.target.value);
              if (item) onApply(item.filters);
            }}
          />
        )}
        <Button
          className="save-setup-button"
          aria-label="Save current setup"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <BookmarkPlus size={15} /> Save setup
        </Button>
      </div>
      {open && (
        <Modal title="Saved setups" onClose={() => !busy && setOpen(false)}>
          <form className="stack" onSubmit={save}>
            <p className="muted">
              Save your current Explore filters. Restore them in whichever test
              you are viewing.
            </p>
            <div className="setup-filter-summary">
              <strong>{filters.strategy}</strong>
              <span>
                {[filters.level, ...filters.confirmations]
                  .filter((v) => v !== "Any level")
                  .join(" · ") || "Your current filter selection"}
              </span>
            </div>
            <Field label="Save setup as">
              <input
                required
                maxLength={80}
                placeholder="For example: London reversal + SMT"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" busy={busy}>
              Save these filters
            </Button>
          </form>
          {items.length > 0 && (
            <div className="saved-setup-list">
              <h3>Your saved setups</h3>
              {items.map((item) => (
                <div className="saved-setup-item" key={item.id}>
                  <Button
                    onClick={() => {
                      onApply(item.filters);
                      setOpen(false);
                    }}
                  >
                    {item.name}
                  </Button>
                  <button
                    className="icon-button delete-trade"
                    disabled={busy}
                    aria-label={`Remove saved setup ${item.name}`}
                    onClick={() => remove(item.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <Notice error>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
