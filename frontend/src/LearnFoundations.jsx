import React, { useState } from "react";
import { ArrowUpRight, BookOpen, Search } from "lucide-react";
import { STARTER_GUIDES, GLOSSARY, searchGlossary } from "./learningContent";
import "./learn-foundations.css";
export default function LearnFoundations() {
  const [guideId, setGuideId] = useState("chart"),
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
          <span className="pt-overline">START HERE / THE FOUNDATIONS</span>
          <h2 id="learn-start-title">
            Understand it.
            <br />
            <em>Then put it to the test.</em>
          </h2>
          <p>
            Four short starting points. Follow the path, or choose the part you
            want to understand today.
          </p>
        </header>
        <div className="learn-path" role="group" aria-label="Trading basics">
          {STARTER_GUIDES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGuideId(g.id)}
              aria-pressed={guideId === g.id}
              aria-controls="learn-guide"
            >
              <span>{g.step}</span>
              <strong>{g.label}</strong>
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
            <BookOpen size={42} strokeWidth={1} aria-hidden="true" />
          </div>
          <div className="learn-guide-body">
            <p>{guide.body}</p>
            <aside>
              <span>TRY THIS NEXT</span>
              <p>{guide.exercise}</p>
            </aside>
            <a className="button" href={guide.link}>
              {guide.action}
              <ArrowUpRight size={15} />
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
      <section className="learn-glossary" aria-labelledby="glossary-title">
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
        <div className="glossary-grid">
          {terms.map(([term, meaning]) => (
            <details key={term}>
              <summary>
                {term}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{meaning}</p>
            </details>
          ))}
        </div>
        {!terms.length && (
          <p className="wp-empty">
            No terms match. Try a shorter word or clear your search.
          </p>
        )}
      </section>
    </>
  );
}
