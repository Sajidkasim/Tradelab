import React from "react";
import { Field, Select, Checkboxes, Disclosure } from "./components";
import { unknown } from "./format";

export default function Labels({ value, onChange, meta }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  const options = (list, current) => [
    ...new Set([unknown, ...list, current].filter(Boolean)),
  ];
  return (
    <>
      <div className="form-grid">
        <Field label="Key level / PDA">
          <input
            list="levels"
            value={value.level === unknown ? "" : value.level}
            placeholder="Choose or type a key level"
            onChange={(e) => change("level", e.target.value || unknown)}
          />
          <datalist id="levels">
            {meta.playbook.levels.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Select
          label="Level timeframe"
          values={options(meta.timeframes, value.timeframe)}
          value={value.timeframe}
          onChange={(e) => change("timeframe", e.target.value)}
        />
        <Select
          label="Entry timeframe"
          values={options(meta.timeframes, value.entry_timeframe)}
          value={value.entry_timeframe}
          onChange={(e) => change("entry_timeframe", e.target.value)}
        />
      </div>
      <div className="field">
        <span>Entry confirmations</span>
        <Checkboxes
          values={[...new Set([...meta.confirmations, ...value.confirmations])]}
          selected={value.confirmations}
          onChange={(v) => change("confirmations", v)}
        />
      </div>
      <Disclosure title="News & market condition">
        <div className="form-grid two">
          <Select
            label="News that day"
            values={options(meta.news, value.news)}
            value={value.news}
            onChange={(e) => change("news", e.target.value)}
          />
          <Select
            label="Market condition"
            values={options(meta.conditions, value.condition)}
            value={value.condition}
            onChange={(e) => change("condition", e.target.value)}
          />
        </div>
      </Disclosure>
    </>
  );
}
