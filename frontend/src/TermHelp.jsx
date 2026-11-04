import React, { useState } from "react";
import { Modal } from "./components";
import { GLOSSARY, searchGlossary } from "./learningContent";
export default function TermHelp({ term, label }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const entries = term
    ? GLOSSARY.filter(([name]) => name === term)
    : searchGlossary(query);
  return (
    <>
      <button
        className="term-help"
        onClick={() => setOpen(true)}
        aria-label={term ? `Explain ${label || term}` : "Open quick glossary"}
      >
        {label || term || "Glossary"} <span aria-hidden="true">?</span>
      </button>
      {open && (
        <Modal
          title={term ? label || term : "Quick glossary"}
          onClose={() => setOpen(false)}
        >
          {!term && (
            <label className="field">
              Find a term
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <dl className="quick-terms">
            {entries.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          {!entries.length && <p>No matching terms.</p>}
        </Modal>
      )}
    </>
  );
}
