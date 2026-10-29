import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Button, Field, Select, Notice } from "./components";

export default function TagCleanup({ refresh, toast }) {
  const [options, setOptions] = useState(null),
    [field, setField] = useState("confirmation");
  const [source, setSource] = useState(""),
    [target, setTarget] = useState("");
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/label-cleanup")
      .then(setOptions)
      .catch((error) => setError(error.message));
  }, []);
  function change(category, from = "", to = "") {
    setField(category);
    setSource(from);
    setTarget(to);
    setPreview(null);
    setError("");
  }
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/label-cleanup/${action}`, {
        method: "POST",
        body: {
          field,
          source,
          target,
          preview_token: preview?.preview_token || "",
        },
      });
      if (action === "preview") setPreview(result);
      else {
        await refresh();
        setOptions(await api("/label-cleanup"));
        change(field);
        toast(
          `Labels combined on ${result.updated} trades. CSV meanings and saved setups are updated.`,
        );
      }
    } catch (error) {
      setError(error.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack tag-cleanup">
      <div>
        <h3>Keep your tags consistent</h3>
        <p className="muted">
          Combine spellings or rename a label across your trades, saved setups
          and CSV meanings. Preview the change first.
        </p>
      </div>
      {options?.duplicates.length > 0 && (
        <div className="cleanup-suggestions">
          <strong>Possible duplicates</strong>
          {options.duplicates.map((item, index) => (
            <Button
              type="button"
              key={index}
              onClick={() => change(item.field, item.values[1], item.values[0])}
            >
              {item.values.join(" / ")}
            </Button>
          ))}
        </div>
      )}
      {options && (
        <>
          <Select
            label="Label category"
            values={Object.entries(options.fields).map(([value, label]) => ({
              value,
              label,
            }))}
            value={field}
            onChange={(e) => change(e.target.value)}
          />
          <div className="form-grid two">
            <Select
              label="Existing label"
              values={[
                { value: "", label: "Choose a label" },
                ...options.choices[field],
              ]}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPreview(null);
              }}
            />
            <Field label="Combine into / new name">
              <input
                list="cleanup-labels"
                value={target}
                maxLength={120}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setPreview(null);
                }}
              />
              <datalist id="cleanup-labels">
                {options.choices[field].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
          </div>
          <Button
            type="button"
            disabled={!source || !target.trim() || source === target}
            busy={busy}
            onClick={() => run("preview")}
          >
            Preview label change
          </Button>
        </>
      )}
      {preview && (
        <div className="cleanup-preview stack">
          <strong>
            {preview.source} → {preview.target}
          </strong>
          <p>
            {preview.count} saved trades will use this label. Matching settings,
            CSV tag meanings and saved setup filters will use it too.
          </p>
          <small>
            Financial results, notes and test membership stay saved. Future
            imports use the combined name.
          </small>
          <Button
            type="button"
            variant="primary"
            busy={busy}
            onClick={() => run("apply")}
          >
            Apply label change
          </Button>
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
