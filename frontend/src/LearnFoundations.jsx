import React, { useState, useEffect, useRef } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { STARTER_GUIDES, GLOSSARY, searchGlossary } from "./learningContent";
import "./learn-foundations.css";
import StarterGuideDiagram from "./StarterGuideDiagram";
import { api } from "./api";
export default function LearnFoundations({ identity }) {
  const requested = new URLSearchParams(location.search).get("lesson");
  const initial = STARTER_GUIDES.some((g) => g.id === requested)
    ? requested
    : "chart";
  const [progress, setProgress] = useState({ last: initial, completed: [] }),
    [saved, setSaved] = useState(false),
    [saveError, setSaveError] = useState("");
  const latest = useRef({ last: initial, completed: [] }),
    generation = useRef(0);
  const [ready, setReady] = useState(false);
  const queue = useRef(Promise.resolve()),
    touched = useRef(false);
  useEffect(() => {
    let alive = true;
    generation.current++;
    touched.current = false;
    setReady(false);
    latest.current = { last: initial, completed: [] };
    setSaved(false);
    setProgress({ last: initial, completed: [] });
    if (identity?.authenticated)
      api("/learning-progress")
        .then((p) => {
          if (alive) {
            latest.current = p;
            setProgress(p);
            setReady(true);
            if (!touched.current) setGuideId(requested ? initial : p.last);
          }
        })
        .catch((e) => {
          if (alive) setSaveError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [identity]);
  function remember(id, complete) {
    touched.current = true;
    setGuideId(id);
    setSaved(false);
    setSaveError("");
    if (identity?.authenticated && !ready) return;
    const previous = latest.current;
    {
      const next = {
        last: id,
        completed: complete
          ? previous.completed.includes(id)
            ? previous.completed.filter((x) => x !== id)
            : [...previous.completed, id]
          : previous.completed,
      };
      latest.current = next;
      setProgress(next);
      const epoch = generation.current;
      if (identity?.authenticated)
        queue.current = queue.current
          .catch(() => {})
          .then(() => {
            if (epoch === generation.current)
              return api("/learning-progress", { method: "PUT", body: next });
          })
          .then(() => {
            if (epoch === generation.current) setSaved(true);
          })
          .catch((e) => setSaveError(e.message));
    }
  }

  const [guideId, setGuideId] = useState(initial),
    [query, setQuery] = useState("");
  const guide = STARTER_GUIDES.find((g) => g.id === guideId),
    terms = searchGlossary(query);
  return (
    <>
      <section
        className="learn-foundations"
        aria-labelledby="learn-start-title"
      >
        <header className="learn-intro">
          <h2 id="learn-start-title">Foundations</h2>
        </header>
        <p className="wp-footnote">
          {identity?.authenticated
            ? `${progress.completed.length} of ${STARTER_GUIDES.length} complete`
            : "Sign in to remember your place across visits."}
        </p>
        {saveError && <p role="alert">Could not save progress: {saveError}</p>}
        <div className="learn-path" role="group" aria-label="Trading basics">
          {STARTER_GUIDES.map((g) => (
            <button
              key={g.id}
              onClick={() => remember(g.id, false)}
              aria-pressed={guideId === g.id}
              aria-controls="learn-guide"
            >
              <span>{g.step}</span>
              <strong>
                {g.label}
                {progress.completed.includes(g.id) ? " ✓" : ""}
              </strong>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
        <article
          className="learn-guide"
          id="learn-guide"
          aria-labelledby="learn-guide-title"
        >
          <div className="learn-guide-heading">
            <span className="pt-overline">
              PRIMUS STARTER GUIDE / {guide.step}
            </span>
            <h3 id="learn-guide-title">{guide.title}</h3>
            <p>{guide.summary}</p>
            <StarterGuideDiagram guideId={guide.id} />
          </div>
          <div className="learn-guide-body">
            <p>{guide.body}</p>
            <aside>
              <span>TRY THIS NEXT</span>
              <p>{guide.exercise}</p>
            </aside>
            <div className="settings-actions">
              <button
                className="button"
                aria-pressed={progress.completed.includes(guide.id)}
                onClick={() => remember(guide.id, true)}
              >
                {progress.completed.includes(guide.id)
                  ? "Completed ✓ — undo"
                  : "Mark guide complete"}
              </button>
            </div>
            <p className="wp-footnote" role="status">{saved ? "Progress saved privately." : ""}</p>
            <a className="button" href={`${guide.link}?lesson=${guide.id}`}>
              {guide.action}
              <ArrowUpRight size={15} />
            </a>
            <a href={`/journal?lesson=${guide.id}`}>
              Reflect on this lesson in Journal ↗
            </a>
          </div>
        </article>
        <div className="learn-source-note">
          <span>Further reading</span>
          <a
            href="https://www.cmegroup.com/education/courses/introduction-to-futures/tick-movements-understanding-how-they-work"
            target="_blank"
            rel="noopener noreferrer"
          >
            CME · Tick sizes ↗
          </a>
          <a
            href="https://www.cmegroup.com/education/courses/introduction-to-futures/calculating-futures-contract-profit-or-loss"
            target="_blank"
            rel="noopener noreferrer"
          >
            CME · Contract P&L ↗
          </a>
          <a
            href="https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            CFTC · Simulation limitations ↗
          </a>
        </div>
        <p className="wp-footnote">
          Introductory education. Futures involve leverage and the risk of
          substantial loss. Practice and historical results do not guarantee
          future performance.
        </p>
      </section>
      <section data-learn-tour="glossary" className="learn-glossary" aria-labelledby="glossary-title">
        <div className="wp-section-heading">
          <div>
            <span className="pt-overline">THE WORDS BEHIND THE CHART</span>
            <h2 id="glossary-title">A little less jargon.</h2>
            <p>Quick definitions to keep beside your research.</p>
          </div>
          <label className="glossary-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search glossary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try R, slippage or drawdown"
            />
          </label>
        </div>
        <p className="glossary-count" role="status">
          {terms.length} of {GLOSSARY.length} terms
        </p>
        {Object.entries(terms.reduce((groups, entry) => {
          (groups[entry[2] || "Other"] ??= []).push(entry);
          return groups;
        }, Object.create(null))).sort(([a], [b]) => a.localeCompare(b)).map(([category, entries]) => (
          <section className="glossary-category" key={category} aria-label={category}>
            <h3>{category}</h3>
            <div className="glossary-grid">
              {entries.map(([term, meaning]) => (
                <details key={term}>
                  <summary>{term}<span aria-hidden="true">+</span></summary>
                  <p>{meaning}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
        {!terms.length && (
          <p className="wp-empty">
            No terms match. Try a shorter word or clear your search.
          </p>
        )}
      </section>
    </>
  );
}
