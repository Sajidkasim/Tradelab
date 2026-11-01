import React, { useState } from "react";
import { Plus, ArrowLeft, Pencil } from "lucide-react";
import { Button, Field, Select, Notice } from "./components";
import {
  tagFields,
  rulesOf,
  meaningText,
  pendingTags,
  cleanMeaning,
  addTagMeaning,
  weekdays,
} from "./importTags";

export default function TagMeanings({
  saved,
  automatic = {},
  unresolvedTags,
  questions = [],
  suggestions,
  fileTags,
  onSave,
  busy,
  initialReview = false,
}) {
  const [filter, setFilter] = useState(initialReview ? "new" : "saved");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pending = unresolvedTags ?? pendingTags(fileTags, saved, automatic);
  const questionFor = tag => questions.find(item => item.tag === tag);
  const reasonFor = tag => questionFor(tag)?.reason === 'ambiguous'
    ? 'This name is used in more than one category. The CSV does not tell us which one you meant.'
    : 'This name is not recognised yet. Choose its category once; we will remember it for your next import.';
  function edit(tag, alias = false) {
    const entry = saved[tag] || suggestions[tag];
    const rules = rulesOf(entry).filter((r) => r.field && r.value);
    setEditor({
      original: alias ? null : tag,
      tag: alias ? "" : tag,
      alias,
      keepOnly: entry?.ignore || false,
      rules: rules.length
        ? rules.map((r) => ({ ...r }))
        : [{ field: "", value: tag.length <= 120 ? tag : "" }],
    });
    setError("");
  }
  function add() {
    setEditor({
      original: null,
      tag: "",
      keepOnly: false,
      rules: [{ field: "strategy", value: "" }],
    });
    setError("");
  }
  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      const next = addTagMeaning(
        saved,
        editor.tag,
        cleanMeaning(editor.rules, editor.keepOnly),
        editor.original,
      );
      await onSave(next);
      setEditor(null);
      setFilter(pendingTags(fileTags, next).length ? "new" : "saved");
      setSearch("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function forget() {
    setError("");
    try {
      const next = { ...saved };
      delete next[editor.original];
      await onSave(next);
      setEditor(null);
    } catch (e) {
      setError(e.message);
    }
  }
  async function useChoice(tag, meaning) {
    setError('');
    try {
      await onSave(addTagMeaning(saved, tag, meaning, Object.hasOwn(saved,tag) ? tag : null));
      setEditor(null);
      setFilter('new');
    } catch(e) { setError(e.message); }
  }
  if (editor)
    return (
      <form onSubmit={save} className="stack tag-meaning-editor">
        <Button
          type="button"
          className="back-button"
          onClick={() => setEditor(null)}
          disabled={busy}
        >
          <ArrowLeft size={14} /> Back to tag guide
        </Button>
        <h3>
          {editor.alias
            ? "Another name for the same meaning"
            : editor.original
              ? "Set a tag meaning"
              : "Add a tag meaning"}
        </h3>
        {editor.original && !Object.hasOwn(saved,editor.original) && <div className="notice stack">
          <strong>Why are we asking?</strong><p>{reasonFor(editor.original)}</p>
          {!!questionFor(editor.original)?.choices.length && <div className="actions">{questionFor(editor.original).choices.map((choice,index)=><Button type="button" key={index} disabled={busy} onClick={()=>useChoice(editor.original,choice)}>Use as {meaningText(choice)}</Button>)}</div>}
        </div>}
        <Field
          label="Tag in your CSV"
          hint={
            editor.alias
              ? "Enter a different name for the same meaning. Capitals, spaces and clear typos already match automatically."
              : "Use the tag name from your export. Capitals and spaces do not need to match."
          }
        >
          <input
            value={editor.tag}
            readOnly={!!editor.original}
            maxLength={200}
            required
            onChange={(e) => setEditor({ ...editor, tag: e.target.value })}
            placeholder="e.g. BREAKOUT RETEST"
          />
        </Field>
        <label className="review-check">
          <input
            type="checkbox"
            checked={editor.keepOnly}
            onChange={(e) =>
              setEditor({ ...editor, keepOnly: e.target.checked })
            }
          />{" "}
          Keep original tag only
        </label>
        <small className="muted">
          Choose this for a tag you want to retain without using it as a setup
          filter.
        </small>
        {!editor.keepOnly &&
          editor.rules.map((rule, index) => (
            <div key={index} className="tag-meaning-rule">
              <Select
                label={index ? `Also use as ${index + 1}` : "Use this tag as"}
                values={[
                  { value: "", label: "Choose a category" },
                  ...tagFields,
                ]}
                value={rule.field}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    rules: editor.rules.map((r, i) =>
                      i === index ? { ...r, field: e.target.value } : r,
                    ),
                  })
                }
              />
              {rule.field === "weekday" ? (
                <Select
                  label={
                    index
                      ? `Name in PrimusLab ${index + 1}`
                      : "Name in PrimusLab"
                  }
                  values={[{ value: "", label: "Choose a day" }, ...weekdays]}
                  value={rule.value}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      rules: editor.rules.map((r, i) =>
                        i === index ? { ...r, value: e.target.value } : r,
                      ),
                    })
                  }
                />
              ) : (
                <Field
                  label={
                    index
                      ? `Name in PrimusLab ${index + 1}`
                      : "Name in PrimusLab"
                  }
                  hint="Use the same name for tags you want grouped together in Results."
                >
                  <input
                    required
                    value={rule.value}
                    maxLength={120}
                    placeholder={
                      tagFields.find((field) => field.value === rule.field)
                        ?.example || "Choose a short, clear name"
                    }
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        rules: editor.rules.map((r, i) =>
                          i === index ? { ...r, value: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </Field>
              )}
              {rule.field === "weekday" && (
                <small className="muted">
                  Entry date in your session timezone determines the day filter.
                  A conflicting CSV day tag is flagged during preview.
                </small>
              )}
              {rule.field === "target_rr" && (
                <div className="stack">
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={rule.full_exit === true}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          rules: editor.rules.map((r, i) =>
                            i === index
                              ? { ...r, full_exit: e.target.checked }
                              : r,
                          ),
                        })
                      }
                    />
                    Wins hit the full target; losses hit the full stop
                  </label>
                  <small className="muted">
                    Backtests only. Confirms full exits for this target ratio
                    only. A 1:2 target models a full win as +2R; 1:3 models it
                    as +3R. Full-stop losses are −1R, before costs. Each ratio
                    needs its own confirmation. Break-even rows and live trades
                    are excluded. Partial and early exits need actual recorded
                    risk. Saved financial results stay unchanged.
                  </small>
                </div>
              )}
              {editor.rules.length > 1 && (
                <Button
                  type="button"
                  onClick={() =>
                    setEditor({
                      ...editor,
                      rules: editor.rules.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove meaning {index + 1}
                </Button>
              )}
            </div>
          ))}
        {!editor.keepOnly && (
          <details className="disclosure">
            <summary>One tag describes more than one thing?</summary>
            <div>
              <p>
                A combined tag can describe a level and its timeframe, for
                example.
              </p>
              <Button
                type="button"
                disabled={editor.rules.length >= 8}
                onClick={() =>
                  setEditor({
                    ...editor,
                    rules: [...editor.rules, { field: "", value: "" }],
                  })
                }
              >
                Add another meaning
              </Button>
            </div>
          </details>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="settings-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save meaning
          </Button>
          <Button type="button" disabled={busy} onClick={() => setEditor(null)}>
            Cancel
          </Button>
        </div>
        {Object.hasOwn(saved, editor.original || "") && (
          <details className="disclosure">
            <summary>Stop recognising this tag</summary>
            <div>
              <p>
                This removes its saved meaning for future imports. Existing
                trades keep their labels. To keep recognising the tag without
                classifying it, choose “Keep original tag only” above.
              </p>
              <Button type="button" busy={busy} onClick={forget}>
                Forget this meaning
              </Button>
            </div>
          </details>
        )}
      </form>
    );
  const candidates = filter === "new" ? pending : Object.keys(saved);
  const matches = candidates.filter((tag) =>
    `${tag} ${meaningText(saved[tag] || suggestions[tag])}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const offered = Object.keys(suggestions).filter(
    (tag) => !Object.hasOwn(saved, tag) && !pending.includes(tag),
  );
  return (
    <div className="stack tag-guide">
      <div className="tag-guide-heading">
        <div>
          <h3>Your tag guide</h3>
          <p>
            Your Lab choices already work as import tags. Use this guide only for
            unfamiliar names or tags with more than one possible meaning.
          </p>
        </div>
        <Button onClick={add}>
          <Plus size={14} /> Add a tag
        </Button>
      </div>
      <details className="disclosure">
        <summary>How to tag your CSV · a quick guide</summary>
        <div className="stack">
          <p><strong>1. Add your choices in Lab settings.</strong> Strategies, key levels, timeframes and confirmations become import tags automatically.</p>
          <p><strong>2. Use those names in FX Replay.</strong> Capitals and spaces do not matter. Export and preview your CSV; recognised tags are already filled in.</p>
          <p><strong>3. Give shared names a category.</strong> The key level timeframe is where you found the level, for example a 1H FVG. The entry timeframe is where you entered, for example a 1m CISD. They describe different things, even when both are 15m.</p>
          <p>Use <strong>Key level timeframe: 15m</strong> and <strong>Entry timeframe: 15m</strong> as separate CSV tag names. If the export only says “15m”, we cannot see the FX Replay group, so we ask once instead of guessing.</p>
          <p>For a completely new name, choose its meaning below. Your other tags and saved trades stay unchanged.</p>
        </div>
      </details>
      <details className="disclosure">
        <summary>Tags from your Lab settings · already connected</summary>
        <div className="stack">
          <p>Adding or changing a Lab choice updates these tags automatically. No extra Save meaning step is needed.</p>
          <p>Use a category when names overlap: Key level: FVG, Confirmation: FVG, Key level timeframe: 15m or Entry timeframe: 15m.</p>
          {tagFields.map(field => {
            const values = [...new Set(Object.values(automatic).filter(entry => entry.field === field.value).map(entry => entry.value))];
            return values.length ? <div key={field.value}><strong>{field.label}</strong><p className="muted">{values.join(" · ")}</p></div> : null;
          })}
        </div>
      </details>
      <div className="tag-guide-tabs" role="group" aria-label="Tag list">
        <Button
          className={filter === "saved" ? "selected" : ""}
          onClick={() => setFilter("saved")}
        >
          Saved · {Object.keys(saved).length}
        </Button>
        <Button
          className={filter === "new" ? "selected" : ""}
          onClick={() => setFilter("new")}
        >
          New in this file · {pending.length}
        </Button>
      </div>
      <Field label="Find a tag">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tag name or meaning"
        />
      </Field>
      <div className="tag-meaning-list">
        {matches.map((tag) => (
          <div className="tag-meaning-row" key={tag}>
            <div>
              <strong>{tag}</strong>
              <small>{meaningText(saved[tag] || suggestions[tag])}</small>
              {filter === 'new' && <small>{reasonFor(tag)}</small>}
            </div>
            <Button
              onClick={() => edit(tag)}
              aria-label={`${Object.hasOwn(saved, tag) ? "Edit" : "Review"} ${tag}`}
            >
              <Pencil size={13} />
              {Object.hasOwn(saved, tag) ? "Edit" : "Review"}
            </Button>
            {Object.hasOwn(saved, tag) && (
              <Button
                className="tag-alias-button"
                onClick={() => edit(tag, true)}
                aria-label={`Add another CSV name for ${tag}`}
              >
                Another CSV name
              </Button>
            )}
          </div>
        ))}
        {!matches.length && (
          <p className="settings-empty">
            {search
              ? "No matching tags."
              : filter === "new"
                ? "No new tags need a meaning."
                : "Add a tag, or preview an export to discover its tags."}
          </p>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {!!offered.length && (
        <details
          className="disclosure"
          open={showSuggestions || undefined}
          onToggle={(e) => setShowSuggestions(e.currentTarget.open)}
        >
          <summary>Suggested meanings · {offered.length}</summary>
          <div className="tag-meaning-list">
            {offered.map((tag) => (
              <div className="tag-meaning-row" key={tag}>
                <div>
                  <strong>{tag}</strong>
                  <small>{meaningText(suggestions[tag])}</small>
                </div>
                <Button onClick={() => edit(tag)}>Review {tag}</Button>
              </div>
            ))}
          </div>
        </details>
      )}
      <details className="disclosure">
        <summary>New strategy or renamed tags?</summary>
        <div className="stack">
          <p>
            Add as many strategy names as you need. Choose Strategy and type the
            new model name; it becomes available in your strategy list.
          </p>
          <p>
            Capitals, spaces and clear word typos are matched automatically.
            For a completely different name, use “Another CSV name”.
          </p>
          <p>
            If the same tag means different things in two groups, use distinct
            CSV names, such as <strong>Level TF: 15M</strong> and{" "}
            <strong>Entry TF: 15M</strong>. The export must preserve that
            distinction.
          </p>
        </div>
      </details>
      <p className="settings-footnote">
        Changes affect future imports. Existing trades only change when you
        choose to update their labels and confirm the import preview.
      </p>
    </div>
  );
}
