import React from "react";
import { STARTER_GUIDES } from "./learningContent";
export default function LearningTrail() {
  const guide = STARTER_GUIDES.find(
    (g) => g.id === new URLSearchParams(location.search).get("lesson"),
  );
  if (!guide || location.pathname === "/learn") return null;
  return (
    <aside className="learning-trail" aria-label="Learning journey">
      <strong>{guide.label}</strong>
      <span>
        {location.pathname === "/journal"
          ? "Reflect on what you noticed."
          : guide.exercise}
      </span>
      <a href={`/learn?lesson=${guide.id}`}>Read</a>
      <a href={`${guide.link}?lesson=${guide.id}`}>Practise</a>
      <a href={`/journal?lesson=${guide.id}`}>Reflect ↗</a>
      <a href={location.pathname} aria-label="Leave learning journey">
        ×
      </a>
    </aside>
  );
}
