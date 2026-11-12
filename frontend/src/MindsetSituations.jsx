import React, { useState } from "react";
const situations = [
  {
    id: "missed",
    title: "I missed the move",
    feeling:
      "Urgency or fear of missing out can make a late entry feel necessary.",
    steps: [
      "Pause before placing another order.",
      "Describe what changed: is the original entry still available?",
      "Use your existing entry rules to decide whether to pass.",
    ],
    question: "What did I observe, and what am I assuming?",
  },
  {
    id: "loss",
    title: "I’ve had consecutive losses",
    feeling:
      "Frustration, disappointment or the urge to recover money may show up after losses.",
    steps: [
      "Step away from the order controls for a moment.",
      "Check the loss and stopping limits you wrote before the session.",
      "Review rule adherence separately from whether a trade won.",
    ],
    question:
      "Am I following the next valid setup or trying to undo the last result?",
  },
  {
    id: "plan",
    title: "I want to break my plan",
    feeling:
      "Excitement, boredom or pressure can make an exception feel convincing.",
    steps: [
      "Name the specific rule you want to change.",
      "Keep a new idea as a future test rather than silently changing the current test.",
      "Choose a break if you do not want to continue under the existing rules.",
    ],
    question: "Would I make this change if I had not seen the latest candle?",
  },
];
export default function MindsetSituations() {
  const [id, setId] = useState("missed"),
    item = situations.find((s) => s.id === id);
  return (
    <section className="wp-panel mindset-situations">
      <span className="pt-overline">WHEN THE SESSION GETS LOUD</span>
      <h2>What’s happening for you?</h2>
      <p>
        Choose a familiar moment. These are reflection prompts, not a reading of
        your brain activity.
      </p>
      <div className="settings-actions">
        {situations.map((s) => (
          <button
            className="button"
            aria-pressed={id === s.id}
            key={s.id}
            onClick={() => setId(s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div className="situation-reading" aria-live="polite">
        <h3>{item.title}</h3>
        <p>{item.feeling}</p>
        <ol>
          {item.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p>
          <strong>Ask yourself:</strong> {item.question}
        </p>
      </div>
      <div className="settings-actions">
        <a className="button" href="#warm-up-title">
          Return to warm-up ↑
        </a>
        <a className="button" href="/journal">
          Reflect in Journal ↗
        </a>
      </div>
    </section>
  );
}
