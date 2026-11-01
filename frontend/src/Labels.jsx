import React from "react";
import { Select, Checkboxes, Disclosure } from "./components";
import { unknown } from "./format";
import VocabularySelect from './VocabularySelect';

export default function Labels({ value, onChange, meta }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  const options = (list, current) => [
    ...new Set([unknown, ...list, current].filter(Boolean)),
  ];
  return (
    <>
      <div className="form-grid">
        <VocabularySelect
          label="Key level / PDA"
          values={[{value:'',label:'Choose a key level'},...meta.playbook.levels]}
          archived={[...(meta.archived_choices?.levels||[]),...(!meta.playbook.levels.includes(value.level)?[value.level]:[])]}
          value={value.level === unknown ? '' : value.level || ''}
          onChange={(e) => change("level", e.target.value || unknown)}
        />
        <VocabularySelect
          label="Key level timeframe"
          values={[{value:'',label:'Choose a timeframe'},...(meta.level_timeframes || meta.timeframes)]}
          archived={[...(meta.archived_choices?.level_timeframes||[]),value.timeframe]}
          value={value.timeframe === unknown ? '' : value.timeframe || ''}
          onChange={(e) => change("timeframe", e.target.value || unknown)}
        />
        <VocabularySelect
          label="Entry timeframe"
          values={[{value:'',label:'Choose a timeframe'},...(meta.entry_timeframes || meta.timeframes)]}
          archived={[...(meta.archived_choices?.entry_timeframes||[]),value.entry_timeframe]}
          value={value.entry_timeframe === unknown ? '' : value.entry_timeframe || ''}
          onChange={(e) => change("entry_timeframe", e.target.value || unknown)}
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
