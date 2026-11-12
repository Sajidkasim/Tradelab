import React from "react";
import { Checkboxes, Select } from "./components";

export default function CustomTradeFields({ definitions = [], value = {}, onChange, filtering = false }) {
  function update(id, choices) {
    onChange({ ...value, [id]: choices });
  }

  return definitions.map(({ id, name, type, options }) =>
    type === "dropdown" ? (
      <Select
        key={id}
        label={name}
        values={[{ value: "", label: filtering ? "Any" : "Not recorded" }, ...options]}
        value={value[id]?.[0] || ""}
        onChange={(event) => update(id, event.target.value ? [event.target.value] : [])}
      />
    ) : (
      <div key={id} className="field" role="group" aria-label={name}>
        <span>{name}</span>
        <Checkboxes values={options} selected={value[id] || []} onChange={(choices) => update(id, choices)} />
      </div>
    ),
  );
}
