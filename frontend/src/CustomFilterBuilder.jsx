import React, { useState } from "react";
import OptionTokenizer, { appendOptions } from "./OptionTokenizer";
import { api } from "./api";
import { Button, Field, Notice, Select } from "./components";

const types = [
  { value: "dropdown", label: "Single choice" },
  { value: "checkbox", label: "Multiple choices" },
];

export default function CustomFilterBuilder({ definitions, refresh, toast }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("dropdown");
  const [options, setOptions] = useState([]);
  const [optionDraft, setOptionDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(id) {
    setPending(true);
    setError("");
    try {
      if (id) {
        await api(`/lab-settings/custom-fields/${id}`, { method: "DELETE" });
      } else {
        await api("/lab-settings/custom-fields", {
          method: "POST",
          body: { name: name.trim(), type, options: appendOptions(options, optionDraft) },
        });
        setName("");
        setOptions([]);
        setOptionDraft("");
      }
      await refresh();
      toast(id ? "Trade field removed." : "Trade field added to Strategy Lab.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="stack">
      <h3>Custom trade fields</h3>
      <p className="muted">Add an indicator, market condition, or any other detail you want to record on trades and filter by in Explore. These fields are private to your workspace.</p>
      <div className="form-grid">
        <Field label="Field name">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. EDRA" />
        </Field>
        <Select label="Field type" values={types} value={type} onChange={(event) => setType(event.target.value)} />
        <OptionTokenizer options={options} draft={optionDraft} onChange={setOptions}
          onDraftChange={setOptionDraft} disabled={pending} />
      </div>
      <div className="actions">
        <Button type="button" variant="primary" disabled={pending || !name.trim() || (!options.length && !optionDraft.trim())} onClick={() => save()}>
          Add trade field
        </Button>
      </div>
      {definitions.map((field) => (
        <div key={field.id} className="archive-row">
          <div><strong>{field.name}</strong><p className="muted">{field.options.join(", ")}</p></div>
          <Button type="button" disabled={pending} onClick={() => {
            if (window.confirm(`Remove “${field.name}” from trade forms and Explore? Existing trades will keep their saved values.`)) save(field.id);
          }}>Remove</Button>
        </div>
      ))}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
