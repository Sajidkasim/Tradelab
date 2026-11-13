import {AccountSelector,tradeAccountIds} from './JournalReview';
import CustomTradeFields from "./CustomTradeFields";
import React, {useRef,useState} from 'react';
import {Plus, ImagePlus, ArrowUpRight, Trash2, Download, ChevronDown, Link2, FlaskConical} from 'lucide-react';
import {Select} from './components';
import VocabularySelect from './VocabularySelect';
import {money} from './format';
import {ReplayButton} from './JournalReplay';

export function JournalScreenshots({images,allImages,day,busy,onUpload,onRemove,onView,label='Upload screenshot',canUpload=true}){
  const input=useRef();
  const [clipboardHint,setClipboardHint]=useState('');
  const [reading,setReading]=useState(false);
  const disabled=busy||allImages.length>=6;
  const supported=['image/png','image/jpeg','image/webp'];

  async function pasteImage(event){
    const area=event.currentTarget.closest('.pt-dropzone');
    setReading(true);
    setClipboardHint('');
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){
        const type=supported.find(value=>item.types.includes(value));
        if(!type)continue;
        const blob=await item.getType(type);
        if(area.isConnected&&!input.current?.disabled){
          onUpload(new File([blob],`clipboard.${type.split('/')[1]}`,{type}));
        }
        return;
      }
      setClipboardHint('Copy a screenshot first, then try Paste image again.');
    }catch{
      if(area.isConnected)area.focus();
      setClipboardHint('Press Ctrl+V or ⌘V here to paste your screenshot.');
    }finally{
      setReading(false);
    }
  }

  return <div className="pj-screenshots">
    {canUpload?<div key={day} className="pt-dropzone" tabIndex={0} aria-label={label==='Upload screenshot'?'Screenshot drop area':`${label} drop area`}
      onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();if(!disabled)onUpload(e.dataTransfer.files[0])}}
      onPaste={e=>{
        const file=Array.from(e.clipboardData.files).find(item=>supported.includes(item.type));
        if(file){e.preventDefault();if(!disabled){setClipboardHint('');onUpload(file)}}
      }}
      onKeyDown={e=>{if(e.target===e.currentTarget&&e.key==='Enter')input.current?.click()}}>
      <ImagePlus size={23}/><div><strong>Drop a chart, <button type="button" disabled={disabled||reading} onClick={pasteImage}>Paste image</button> or <button type="button" disabled={disabled} onClick={()=>input.current?.click()}>choose an image</button></strong><small>PNG, JPEG, WebP · up to 8 MB · six screenshots per day</small>{clipboardHint&&<small role="status">{clipboardHint}</small>}</div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={label} hidden disabled={busy||allImages.length>=6} onChange={e=>{onUpload(e.target.files[0]);e.target.value=''}}/>
    </div>:<p className="pj-image-pending">Screenshot uploads will be available once private cloud storage is connected.</p>}
    {!!images.length&&<div className="pt-image-grid">{images.map(item=>{const n=allImages.findIndex(i=>i.id===item.id)+1,url=`/api/journal/${day}/images/${item.id}`;return <figure key={item.id}><button type="button" className="pt-image-open" aria-label={`Open screenshot ${n}`} onClick={()=>onView(url)}><img src={url} alt={`Trading screenshot ${n}`} loading="lazy"/></button><figcaption><span>Chart {n}</span><a href={url} download="primus-screenshot.webp" aria-label={`Download screenshot ${n}`}><Download size={16}/></a><button type="button" disabled={busy} aria-label={`Remove screenshot ${n}`} onClick={()=>onRemove(item.id)}><Trash2 size={16}/></button></figcaption></figure>})}</div>}
  </div>;
}

function TradeMetrics({trade}){
  const setupValue=value=>value&&value!=='Not recorded'?value:'—';
  const metrics=[
    ['Key level',setupValue(trade.level)],
    ['Level timeframe',setupValue(trade.timeframe)],
    ['Entry timeframe',setupValue(trade.entry_timeframe)],
    ['Original risk',money(trade.risk_amount).replace(/^\+/, '')],
    ['Net P&L',money(trade.net_pnl)],
  ];
  return <dl className="pj-trade-metrics">{metrics.map(([label,value])=><div key={label}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>)}</dl>;
}

export default function JournalTradeCards({entry,meta,palette,accounts,accountFilter,busy,expanded,setExpanded,onChange,onAdd,onRemove,onUpload,onRemoveImage,onView,onAddToLab,onLink,canUpload,freshTradeId}){
  const visibleTrades=entry.trades.filter(trade=>accountFilter==null||tradeAccountIds(trade).includes(accountFilter));
  const choices=meta?.strategies||[];
  const markets=Object.keys(meta?.instruments||{});
  const outcomes=[{value:'win',label:'Win'},{value:'loss',label:'Loss'},{value:'breakeven',label:'Break-even'}];
  return <section className="pj-trades" aria-label="Trades taken today">
    <div className="pj-trades-heading"><div><span className="pt-overline">THE TRADES</span><h3>Trades taken today <span>{visibleTrades.length}</span></h3><p>Keep the setup, decision and chart together. Times use {meta?.journal_preferences?.timezone==='Europe/London'?'UK time':meta?.journal_preferences?.timezone==='Etc/GMT+4'?'fixed UTC−4':'New York time'}.</p></div><button className="pt-btn pt-btn-dark" type="button" disabled={busy||entry.trades.length>=30} onClick={onAdd}><Plus size={17}/> Add trade</button></div>
    {!visibleTrades.length&&<div className="pj-trades-empty"><FlaskConical size={24}/><div><strong>{accountFilter==null?'What did you trade?':'No trades for this account'}</strong><p>{accountFilter==null?'Add the trades you took, or leave this empty for a no-trade day.':'Choose All accounts to see or assign unassigned trades.'}</p></div></div>}
    <div className="pj-trade-list">{visibleTrades.map((trade,index)=>{const open=expanded===trade.id;const selected=tradeAccountIds(trade);const multi=selected.length>1;return <article key={trade.id} className={`pj-trade-card ${open?'is-open':''} ${trade.id===freshTradeId?'is-new':''}`} aria-label={`Journal trade ${index+1}`}>
      <button type="button" className="pj-trade-summary" aria-expanded={open} onClick={()=>setExpanded(open?null:trade.id)}><span className="pj-trade-index">{String(index+1).padStart(2,'0')}</span><span className="pj-trade-name"><strong>{trade.symbol||'New trade'} <em>{trade.direction==='long'?'Buy':trade.direction==='short'?'Sell':''}</em></strong><small>{trade.strategy||'Choose a strategy'}{trade.time?` · ${trade.time}`:''} · {accounts?.filter(account=>selected.includes(account.id)).map(account=>account.name).join(', ') || 'Unassigned'}</small></span>{trade.outcome&&trade.outcome!=='not_recorded'&&<span className={`pj-outcome-badge ${trade.outcome}`} style={{'--pj-outcome-tone':trade.outcome==='win'?palette?.good:trade.outcome==='loss'?palette?.critical:palette?.axis}}>{outcomes.find(item=>item.value===trade.outcome)?.label}</span>}<span className={`pj-trade-state ${trade.lab_trade_id?'linked':''}`}>{trade.lab_trade_id?'In Strategy Lab':`${entry.images.filter(i=>i.trade_id===trade.id).length} charts`}</span><ChevronDown size={18}/></button>
      <TradeMetrics trade={trade}/>
      {open&&<div className="pj-trade-body">
        <fieldset className="pj-outcome"><legend>Trade outcome</legend><div>{outcomes.map(item=><button key={item.value} type="button" aria-pressed={(trade.outcome||'not_recorded')===item.value} disabled={busy||!!trade.lab_trade_id} onClick={()=>onChange(trade.id,'outcome',item.value)} className={item.value}>{(trade.outcome||'not_recorded')===item.value&&<span aria-hidden="true">✓ </span>}{item.label}</button>)}</div></fieldset>
        <div className="pj-trade-fields">
          {accounts?.length>1&&!trade.lab_trade_id?<fieldset className="pj-confirmations pj-wide"><legend>Trade accounts</legend><div>{accounts.map(account=><label key={account.id}><input type="checkbox" checked={selected.includes(account.id)} disabled={busy} onChange={e=>onChange(trade.id,'account_ids',e.target.checked?[...selected,account.id]:selected.filter(id=>id!==account.id))}/>{account.name}</label>)}</div>{multi&&<p>Enter the combined P&amp;L and risk for the selected accounts. Combined P&amp;L appears under All accounts.</p>}</fieldset>:<AccountSelector label="Trade account" accounts={accounts} value={trade.account_id} unassigned disabled={busy||!accounts} onChange={value=>onChange(trade.id,'account_id',value)}/>}
          <Select label="Market" value={trade.symbol} onChange={e=>onChange(trade.id,'symbol',e.target.value)} values={[{value:'',label:'Choose market'},...Array.from(new Set([...markets,trade.symbol].filter(Boolean))).map(value=>({value,label:value}))]} disabled={busy||!!trade.lab_trade_id}/>
          <Select label="Buy or sell" value={trade.direction} onChange={e=>onChange(trade.id,'direction',e.target.value)} values={[{value:'',label:'Choose direction'},{value:'long',label:'Buy'},{value:'short',label:'Sell'}]} disabled={busy||!!trade.lab_trade_id}/>
          <VocabularySelect archived={meta?.archived_choices?.strategies} label="Strategy" value={[...choices,...(meta?.archived_choices?.strategies||[])].includes(trade.strategy)?trade.strategy:trade.strategy?'__custom':''} onChange={e=>onChange(trade.id,'strategy',e.target.value==='__custom'?'New strategy':e.target.value)} values={[{value:'',label:'Choose strategy'},...choices.map(value=>({value,label:value})),{value:'__custom',label:'Other strategy…'}]} disabled={busy||!!trade.lab_trade_id}/>
          <label className="pj-field">Entry time <input type="time" aria-label="Entry time" value={trade.time} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'time',e.target.value)}/></label>
          {trade.strategy&&![...choices,...(meta?.archived_choices?.strategies||[])].includes(trade.strategy)&&<label className="pj-field pj-wide">Strategy name<input aria-label="Strategy name" maxLength={120} value={trade.strategy} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'strategy',e.target.value)}/></label>}
          <Select label="Setup grade" value={trade.setup_grade||''} onChange={e=>onChange(trade.id,'setup_grade',e.target.value)} values={[{value:'',label:'Choose grade'},{value:'A+',label:'A+ setup'},{value:'A',label:'A setup'},{value:'B',label:'B setup'}]} disabled={busy}/>
          <Select label="Trade type" value={trade.source} onChange={e=>onChange(trade.id,'source',e.target.value)} values={[{value:'manual',label:'Live'},{value:'backtest',label:'Backtesting'}]} disabled={busy||!!trade.lab_trade_id}/>
        </div>
        <details className="pj-setup-result" open={(trade.net_pnl!=null||trade.risk_amount!=null||(trade.level&&trade.level!=='Not recorded'))||undefined}>
          <summary>Setup & result <span>Optional · key level, timeframes and money</span></summary>
          <div className="pj-trade-fields">
            <VocabularySelect label="Key level / PDA" value={trade.level==='Not recorded'?'':trade.level||''} values={[{value:'',label:'Choose…'},...(meta?.playbook?.levels||[])]} archived={[...(meta?.archived_choices?.levels||[]),trade.level]} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'level',e.target.value||'Not recorded')}/>
            <VocabularySelect label="Key level timeframe" value={trade.timeframe==='Not recorded'?'':trade.timeframe||''} values={[{value:'',label:'Choose…'},...(meta?.level_timeframes||[])]} archived={[...(meta?.archived_choices?.level_timeframes||[]),trade.timeframe]} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'timeframe',e.target.value||'Not recorded')}/>
            <VocabularySelect label="Entry timeframe" value={trade.entry_timeframe==='Not recorded'?'':trade.entry_timeframe||''} values={[{value:'',label:'Choose…'},...(meta?.entry_timeframes||[])]} archived={[...(meta?.archived_choices?.entry_timeframes||[]),trade.entry_timeframe]} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'entry_timeframe',e.target.value||'Not recorded')}/>
            <label className="pj-field">Amount risked ($)<input type="number" inputMode="decimal" min="0.01" step="any" aria-label="Amount risked ($)" placeholder="e.g. 50" value={trade.risk_amount??''} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'risk_amount',e.target.value===''?null:Number(e.target.value))}/></label>
            <label className="pj-field">Profit / loss ($)<input type="number" inputMode="decimal" step="any" aria-label="Profit / loss ($)" placeholder="e.g. 150 or -50" value={trade.net_pnl??''} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'net_pnl',e.target.value===''?null:Number(e.target.value))}/></label>
          </div>
          <p>Key level timeframe is where you found the level; entry timeframe is where you entered. Enter a loss with a minus sign. A recorded result sets Win, Loss or Break-even when saved.</p>
        </details>
        <fieldset className="pj-confirmations"><legend>Entry confirmations</legend><p>Tick what you saw at entry.</p><div>{Array.from(new Set([...(meta?.confirmations||[]),...(trade.confirmations||[])])).map(value=><label key={value}><input type="checkbox" checked={(trade.confirmations||[]).includes(value)} disabled={busy||!!trade.lab_trade_id} onChange={e=>onChange(trade.id,'confirmations',e.target.checked?[...(trade.confirmations||[]),value]:(trade.confirmations||[]).filter(item=>item!==value))}/>{value}</label>)}</div></fieldset>
        {Boolean(meta?.custom_trade_fields?.length) && <div className="pj-trade-fields">
          <CustomTradeFields definitions={meta.custom_trade_fields} value={trade.custom_fields || {}}
            disabled={busy || Boolean(trade.lab_trade_id)}
            onChange={(value) => onChange(trade.id, 'custom_fields', value)} />
        </div>}
        <label className="pj-field">Trade notes<textarea aria-label="Trade notes" maxLength={6000} placeholder="Why I entered, how I managed it, and what happened…" value={trade.notes} disabled={busy} onChange={e=>onChange(trade.id,'notes',e.target.value)}/></label>
        <JournalScreenshots images={entry.images.filter(i=>i.trade_id===trade.id)} allImages={entry.images} day={entry.day} busy={busy} onUpload={file=>onUpload(file,trade.id)} onRemove={onRemoveImage} onView={onView} label={`Upload screenshot for trade ${index+1}`} canUpload={canUpload}/>
        <div className="pj-trade-actions">{trade.lab_trade_id&&<ReplayButton reference={`lab-${trade.lab_trade_id}`} notes={trade.notes}/>}<button type="button" className="pj-remove" disabled={busy} onClick={()=>onRemove(trade.id)}><Trash2 size={15}/> Remove card</button><div>{trade.lab_trade_id?<><a className="pt-btn" href={`/lab?trade=${trade.lab_trade_id}#trades`}>Open in Lab <ArrowUpRight size={16}/></a><button type="button" className="pj-link" disabled={busy} onClick={()=>onLink(trade)}>Change link</button></>:<><button type="button" className="pj-link" disabled={busy||multi} onClick={()=>onLink(trade)}><Link2 size={15}/> Link existing trade</button><button type="button" className="pt-btn" disabled={busy||multi||!trade.symbol||!trade.direction||!trade.strategy.trim()} onClick={()=>onAddToLab(trade)}><FlaskConical size={16}/> Add to Strategy Lab</button></>}</div></div>
        <p className="pj-trade-help">{multi?'This card records a shared Journal entry. Select one account to link a single Strategy Lab trade.':trade.lab_trade_id?'Linked to your Lab record. Keep personal notes here; edit results and setup labels in the Lab.':'Save entry keeps this card in your Journal. Add to Strategy Lab carries your setup, risk and result across for you to check before saving to statistics.'}</p>
      </div>}
    </article>})}</div>
  </section>;
}
