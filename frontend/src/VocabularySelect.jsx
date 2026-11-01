import React, {useState} from 'react';
import StyledSelect from './StyledSelect';

export const realChoice = value => Boolean(value) && !['not recorded','unclassified'].includes(String(value).trim().toLowerCase());

// Archives are a view of old vocabulary. Selecting one never restores the list
// or edits historical trades. Missing values remain internal empty annotations.
export default function VocabularySelect({archived=[],values,...props}) {
  const [showArchived,setShowArchived]=useState(false);
  const active=values.filter(item=>typeof item==='object'||realChoice(item));
  const names=new Set(active.map(item=>typeof item==='object'?item.value:item));
  const old=[...new Set(archived)].filter(value=>realChoice(value)&&!names.has(value));
  return <div className="vocabulary-select">
    <StyledSelect {...props} values={[...active,...(showArchived?old.map(value=>({value,label:`${value} · archived`})) : [])]}/>
    {!!old.length&&<button type="button" className="archive-toggle" disabled={props.disabled} aria-pressed={showArchived} onClick={()=>setShowArchived(!showArchived)}>{showArchived?'Hide archived':'Show archived'} {props.label.toLowerCase()} · {old.length}</button>}
  </div>;
}
