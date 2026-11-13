import React from 'react';
import CustomTradeFields from './CustomTradeFields';
import {Select,Field} from './components';

export const emptyReplaySetup={strategy:'',level:'',timeframe:'',entry_timeframe:'',condition:'',news:'',checklist:[],notes:'',custom_fields:{}};
export default function ReplaySetupFields({value,onChange,catalog,loading}){
 const update=(key,next)=>onChange({...value,[key]:next});
 const options=(items,current)=>[...new Set(items||[])].filter(Boolean).map(label=>({value:label,label})).concat(current&&!(items||[]).includes(current)?[{value:current,label:`${current} (saved)`}]:[]);
 const picker=(key,label,items)=><Select label={label} empty={`Choose ${label.toLowerCase()}`} values={options(items,value[key])} value={value[key]||''} disabled={loading} onChange={e=>update(key,e.target.value)}/>;
 const confirmations=[...new Set([...(catalog?.confirmations||[]),...(value.checklist||[])])].filter(Boolean);
 return <>
  <small>Uses your Strategy Lab choices. Edit them in My lab → Lab settings.</small>
  {loading&&<p role="status">Loading your Lab choices…</p>}
  {picker('strategy','Strategy',catalog?.strategies)}
  {picker('level','Key level / PDA',catalog?.playbook?.levels)}
  <div className="form-grid two">{picker('timeframe','Key level timeframe',catalog?.level_timeframes)}{picker('entry_timeframe','Entry timeframe',catalog?.entry_timeframes)}</div>
  <fieldset className="bt-research-confirmations"><legend>Confirmations</legend><div className="bt-research-checklist">{confirmations.map(label=><label key={label}><input type="checkbox" checked={(value.checklist||[]).includes(label)} onChange={e=>update('checklist',e.target.checked?[...(value.checklist||[]),label]:(value.checklist||[]).filter(x=>x!==label))}/>{label}</label>)}</div>{!confirmations.length&&<small>Add your confirmations in Lab settings to see them here.</small>}</fieldset>
  <details className="disclosure"><summary>News & market</summary><div className="form-grid two">{picker('news','News',catalog?.news)}{picker('condition','Market condition',catalog?.conditions)}</div></details>
  <CustomTradeFields definitions={catalog?.custom_trade_fields} value={value.custom_fields || {}} onChange={(next) => update("custom_fields", next)} />
  <Field label="Notes"><textarea maxLength={10000} rows={4} value={value.notes||''} onChange={e=>update('notes',e.target.value)}/></Field>
 </>;
}
