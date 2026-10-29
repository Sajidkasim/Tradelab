import React, { createContext } from "react";

export const AppearanceContext = createContext("modern");

export function AppearanceSwitch({ value, onChange }) {
  return (
    <div className="appearance-switch" role="group" aria-label="Website appearance">
      {["modern", "classic"].map((appearance) => (
        <button
          key={appearance}
          type="button"
          aria-pressed={value === appearance}
          onClick={() => onChange(appearance)}
        >
          {appearance === "classic" ? "Classic" : "Modern"}
        </button>
      ))}
    </div>
  );
}
