import React, { useState } from "react";
import { X } from "lucide-react";
import { Button, Field } from "./components";

export default function TagInput({ label, values, onChange }) {
  const [draft, setDraft] = useState("");
  function add() {
    const value = draft.trim();
    if (value && !values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setDraft("");
  }

  return (
    <div className="lab-tag-input">
      <div className="lab-tag-entry">
        <Field label={label}>
          <input value={draft} maxLength={120} placeholder="Type a label"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              add();
            }} />
        </Field>
        <Button type="button" disabled={!draft.trim()} aria-label={`Add ${label} label`} onClick={add}>Add</Button>
      </div>
      <div className="lab-tag-list" role="group" aria-label={`Saved choices for ${label}`}>
        {values.map((value) => (
          <span className="lab-tag" key={value}>
            {value}
            <button type="button" aria-label={`Remove ${value} from ${label}`}
              onClick={() => onChange(values.filter((item) => item !== value))}><X size={14} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}
