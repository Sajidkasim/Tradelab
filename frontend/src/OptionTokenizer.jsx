import React, { useId, useRef } from "react";
import { X } from "lucide-react";

export function appendOptions(options, text) {
  const seen = new Set(options.map((option) => option.toLowerCase()));
  const added = [];
  for (const part of text.split(/[,\n\r]+/)) {
    const option = part.trim();
    const key = option.toLowerCase();
    if (!option || seen.has(key)) continue;
    seen.add(key);
    added.push(option);
  }
  return [...options, ...added];
}

export default function OptionTokenizer({ options, draft, onChange, onDraftChange, disabled }) {
  const id = useId();
  const input = useRef(null);

  function commit(text) {
    onChange(appendOptions(options, text));
    onDraftChange("");
  }

  return (
    <div className="field option-tokenizer-field">
      <label htmlFor={id}>Options</label>
      <div className="option-tokenizer" onClick={(event) => {
        if (event.target === event.currentTarget) input.current?.focus();
      }}>
        {options.map((option) => (
          <span className="lab-tag" key={option}>
            {option}
            <button type="button" aria-label={`Remove option ${option}`} disabled={disabled}
              onClick={() => {
                onChange(options.filter((item) => item !== option));
                input.current?.focus();
              }}><X size={14} aria-hidden="true" /></button>
          </span>
        ))}
        <input ref={input} id={id} type="text" value={draft} disabled={disabled}
          placeholder={options.length ? "" : "e.g. Present"}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const text = event.target.value;
            if (!event.nativeEvent.isComposing && text.includes(",")) commit(text);
            else onDraftChange(text);
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!/[,\n\r]/.test(text)) return;
            event.preventDefault();
            const { selectionStart, selectionEnd } = event.currentTarget;
            commit(draft.slice(0, selectionStart) + text + draft.slice(selectionEnd));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Backspace" && !draft && options.length) {
              event.preventDefault();
              onChange(options.slice(0, -1));
            }
          }} />
      </div>
      <small id={`${id}-hint`}>Press Enter to add an option.</small>
    </div>
  );
}
