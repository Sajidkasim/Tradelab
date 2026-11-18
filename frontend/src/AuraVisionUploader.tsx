import React, {useEffect, useRef, useState} from 'react';
import {ScanLine, Sparkles} from 'lucide-react';
import {api} from './api';
import InteractiveChartPreview, {type Finding} from './InteractiveChartPreview';
import JournalChartProjection, {projectionFields, type Projection, type ProjectionField} from './JournalChartProjection';
import type {ChartOcrSession, ChartRead, Point, Vocabulary} from './chartVisionLocal';
import './chart-vision.css';

const mediaTypes = ['image/png', 'image/jpeg', 'image/webp'];
const caption = {
  asset: 'Market', direction: 'Direction', entry_timeframe: 'Entry timeframe',
  confirmation: 'Confirmation', key_level: 'Key level', level_timeframe: 'Level timeframe',
  visible_level: 'Other level', annotation: 'Visible text',
};

async function compressChart(file: File): Promise<Blob> {
  if (!mediaTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG or WebP under 8 MB.');
  }
  const image = await createImageBitmap(file);
  try {
    let widthLimit = 2700;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable.');
    while (widthLimit >= 1400) {
      const scale = Math.min(1, widthLimit / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.88, .76, .64]) {
        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (jpeg?.type === 'image/jpeg' && jpeg.size < 500_000) return jpeg;
      }
      widthLimit = Math.floor(widthLimit * .82);
    }
    throw new Error('Try cropping to the chart and its entry labels.');
  } finally {
    image.close();
  }
}

type Props = {
  vocabulary: Vocabulary;
  cloudEnabled: boolean;
  tradeDirection?: 'long' | 'short' | '';
  disabled: boolean;
  savedRR?: number | null;
  realised?: number | null;
  focusedConfirmation?: string;
  onFindings: (findings: Finding[]) => void;
  onDraft: (findings: Finding[], explicit?: boolean) => void;
  onProjection: (projection: Projection) => void;
  onAttach?: (file: File) => Promise<boolean | undefined>;
};

export default function AuraVisionUploader({vocabulary, cloudEnabled, tradeDirection, disabled, savedRR, realised, focusedConfirmation, onFindings, onDraft, onProjection, onAttach}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const ocr = useRef<ChartOcrSession | null>(null);
  const draft = useRef(onDraft);
  draft.current = onDraft;
  const [url, setUrl] = useState('');
  const [chart, setChart] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [highlight, setHighlight] = useState<Finding | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState('');
  const [readingLabel,setReadingLabel] = useState(false);
  const [cropFindings,setCropFindings] = useState<Finding[]>([]);
  const [aliases,setAliases] = useState<Record<string,string>>({});
  const [aliasLabel,setAliasLabel] = useState('');
  const [aliasConfirmation,setAliasConfirmation] = useState('');
  const [aliasBusy,setAliasBusy] = useState(false);
  const dictionary={...vocabulary,aliases};

  const [original, setOriginal] = useState<File | null>(null);
  const [local, setLocal] = useState<ChartRead | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [marking, setMarking] = useState(false);
  const [review, setReview] = useState<Finding[]>([]);
  const point = anchor || local?.position?.entry;
  const [levels,setLevels] = useState<Partial<Record<ProjectionField,number>>>({});
  const [prices,setPrices] = useState({entry:'',stop:'',target:'',exit:''});
  const [markProjection,setMarkProjection] = useState<ProjectionField>();
  const position = local?.position;
  const chartLevels = Object.keys(levels).length || markProjection ? levels : position ? {
    entry:position.entry.y,
    stop:position.direction==='long'?position.box.y+position.box.height:position.box.y,
    target:position.direction==='long'?position.box.y:position.box.y+position.box.height,
  } : {};
  function markLevel(selected: Point) {
    if (!markProjection) return;
    setLevels(current=>({...current,[markProjection]:selected.y}));
    setMarkProjection(projectionFields[projectionFields.indexOf(markProjection)+1]);
  }


  useEffect(() => () => {
    active.current?.abort();
    ocr.current?.dispose();
    ocr.current = null;
  }, []);
  useEffect(() => () => {if (url) URL.revokeObjectURL(url)}, [url]);

  function publish(next: Finding[], proposed=next) {
    setFindings(next);
    onFindings(next);
    draft.current(proposed);
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => {
      setError('This scan took too long. Try a smaller crop.');
      controller.abort();
      setScanning(false);
    }, 45_000);
    setScanning(true);
    setError('');
    try {
      await task(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Chart scan failed.');
    } finally {
      window.clearTimeout(timeout);
      active.current = null;
      if (!controller.signal.aborted) setScanning(false);
    }
  }

  async function scan(file?: File) {
    if (!file || disabled || active.current) return;
    setPicked('');
    setReadingLabel(false);
    setCropFindings([]);
    setFindings(null);
    onFindings([]);
    setHighlight(null);
    setChart(null);
    setOriginal(null);
    setLocal(null);
    setAnchor(null);
    setLevels({});
    setPrices({entry:'',stop:'',target:'',exit:''});
    setMarkProjection(undefined);
    setMarking(false);
    setReview([]);
    setUrl('');
    await run(async signal => {
      const jpeg = await compressChart(file);
      signal.throwIfAborted();
      setChart(new File([jpeg], 'chart.jpg', {type: 'image/jpeg'}));
      setOriginal(file);
      setUrl(URL.createObjectURL(jpeg));
      const {ChartOcrSession, scanChart, chartFindings} = await import('./chartVisionLocal');
      signal.throwIfAborted();
      const session = ocr.current ??= new ChartOcrSession();
      const [read, savedAliases] = await Promise.all([
        scanChart(file,signal,session),
        api('/vision/aliases',{signal}).catch(()=>aliases),
      ]);
      signal.throwIfAborted();
      setAliases(savedAliases);
      setLocal(read);
      publish(chartFindings(read,{...vocabulary,aliases:savedAliases}));
    });
  }

  async function markEntry(selected: Point) {
    if (!original || disabled || active.current) return;
    setAnchor(selected);
    setMarking(false);
    setReview([]);
    await run(async signal => {
      const {ChartOcrSession,scanEntry,chartFindings} = await import('./chartVisionLocal');
      signal.throwIfAborted();
      const session = ocr.current ??= new ChartOcrSession();
      const previous = local || {header:[],lines:[]};
      const existing = chartFindings(previous,dictionary,selected);
      publish(existing);
      const lines = await scanEntry(original,selected,signal,session);
      signal.throwIfAborted();
      const expanded = {...previous,lines:[...lines,...previous.lines]};
      setLocal(expanded);
      publish(chartFindings(expanded,dictionary,selected));
    });
  }

  async function readLabel(selected: Point) {
    if (!original || disabled || active.current) return;
    setReadingLabel(false);
    setCropFindings([]);
    await run(async signal=>{
      const {ChartOcrSession,scanLabel} = await import('./chartVisionLocal');
      signal.throwIfAborted();
      const session = ocr.current ??= new ChartOcrSession();
      const matches = await scanLabel(original,selected,dictionary,signal,session);
      signal.throwIfAborted();
      setCropFindings(matches);
      setPicked(matches.length?'Choose a label from the crop.':'No readable label in that crop. Try tapping closer to the text.');
    });
  }

  async function saveAlias(remove=false, label=aliasLabel) {
    if (!label.trim() || (!remove&&!aliasConfirmation) || aliasBusy) return;
    setAliasBusy(true);
    setError('');
    try {
      setAliases(await api('/vision/aliases',{method:'PUT',body:{label,confirmation:remove?null:aliasConfirmation}}));
      setAliasLabel('');
      setPicked(remove?'Label mapping removed.':'Label mapping saved for future scans.');
    } catch (err) {
      setError(err instanceof Error?err.message:'Could not save the label mapping.');
    } finally { setAliasBusy(false); }
  }

  async function improve() {
    if (!original || !point || !cloudEnabled) return;
    await run(async signal => {
      const {compressCrop,entryRegion} = await import('./chartVisionLocal');
      const region = entryRegion(point,.62,.55);
      const crop = await compressCrop(original,region);
      signal.throwIfAborted();
      const form = new FormData();
      form.append('image',crop);
      form.append('user_tags',JSON.stringify(vocabulary.confirmations.slice(0,200)));
      const {findings: suggestions}: {findings: Finding[]} = await api('/vision/extract',{method:'POST',body:form,signal});
      signal.throwIfAborted();
      const baseline = findings || [];
      const additions: Finding[] = [];
      const conflicts: Finding[] = [];
      for (const finding of suggestions) {
        if (['asset','entry_timeframe','annotation'].includes(finding.kind)) continue;
        const mapped = {...finding,box:{
          x:region.x+finding.box.x*region.width,y:region.y+finding.box.y*region.height,
          width:finding.box.width*region.width,height:finding.box.height*region.height,
        }};
        const matches = baseline.filter(item=>item.kind===finding.kind);
        if (matches.some(item=>item.value.toLowerCase()===finding.value.toLowerCase())) continue;
        if (matches.length&&['direction','key_level','level_timeframe'].includes(finding.kind)) conflicts.push(mapped);
        else additions.push(mapped);
      }
      // A disputed key level and its timeframe should be reviewed together.
      if (conflicts.some(item=>item.kind==='key_level')) {
        const timeframe = additions.findIndex(item=>item.kind==='level_timeframe');
        if (timeframe>=0) conflicts.push(...additions.splice(timeframe,1));
      }
      setReview(conflicts);
      publish([...baseline,...additions], [...baseline,...additions]);
      setPicked(additions.length||conflicts.length?'Cloudflare suggestions are ready.':'Cloudflare found no additional suggestions.');
    });
  }

  function addConfirmation(finding: Finding) {
    if (disabled) return;
    const text = finding.value;
    onDraft([{...finding, kind: 'confirmation', value: text}],true);
    setHighlight(finding);
    setAliasLabel(finding.text===finding.value?'':finding.text);
    setPicked(`Selected ${text} for confirmations.`);
  }

  return <section className="pj-vision" aria-label="Chart scan">
    <div className="pt-dropzone" tabIndex={0} aria-label="Chart scan drop area"
      onDragOver={event=>event.preventDefault()}
      onDrop={event=>{event.preventDefault();void scan(event.dataTransfer.files[0])}}
      onPaste={event=>{
        const file = Array.from(event.clipboardData.files).find(item=>mediaTypes.includes(item.type));
        if (file) {event.preventDefault();void scan(file)}
      }}>
      <ScanLine size={21}/>
      <div><strong><button type="button" disabled={disabled || scanning} onClick={()=>picker.current?.click()}>Scan chart</button></strong>
        <small>Drop, paste or choose a TradingView screenshot. The first scan runs on this device.</small></div>
      <input ref={picker} type="file" hidden aria-label="Choose chart to scan" accept={mediaTypes.join(',')}
        disabled={disabled || scanning} onChange={event=>{void scan(event.target.files?.[0]);event.target.value=''}}/>
    </div>
    {scanning&&<div className="pj-vision-loading" role="status">Scanning chart…<span/><span/></div>}
    {error&&<p role="alert">{error}</p>}
    {url&&<div className="pj-vision-review">
    <InteractiveChartPreview url={url} findings={findings || []} highlight={highlight || findings?.find(finding =>
      ['confirmation','annotation'].includes(finding.kind) && finding.value === focusedConfirmation) || null}
      disabled={disabled || scanning} onPick={addConfirmation} anchor={point} projectionLevels={markProjection||Object.keys(levels).length?levels:undefined}
      marking={marking||readingLabel||Boolean(markProjection)} markingLabel={readingLabel?'Pick label area on chart':markProjection?`Mark ${markProjection} on projection`:undefined}
      onMark={readingLabel?readLabel:markProjection?markLevel:markEntry}/>
    <div className="pj-vision-review-panel" aria-label="Chart review">
    <p className="pj-vision-label"><Sparkles size={14}/> Chart review</p>
    {(savedRR!=null||realised!=null)&&<p className="pj-vision-help">
      {savedRR!=null&&<strong>Planned 1:{savedRR.toFixed(2)}</strong>}
      {savedRR!=null&&realised!=null?' · ':''}
      {realised!=null&&<strong>Realised {realised>0?'+':''}{realised.toFixed(2)}R</strong>}
    </p>}
    {url&&!scanning&&<div className="pj-vision-tags">
      <button type="button" aria-pressed={marking} disabled={disabled} onClick={()=>{setReadingLabel(false);setMarkProjection(undefined);setMarking(value=>!value)}}>
        {marking?'Cancel marking':point?'Move entry marker':'Mark entry on chart'}
      </button>
      <button type="button" disabled={disabled} aria-pressed={readingLabel} onClick={()=>{
        setMarking(false);setMarkProjection(undefined);setReadingLabel(value=>!value);
      }}>{readingLabel?'Cancel label scan':'Rescan a label'}</button>
      {cloudEnabled&&<button type="button" disabled={disabled||!point} onClick={()=>void improve()}>Improve with Cloudflare</button>}
    </div>}
    {readingLabel&&<p className="pj-vision-help" role="status">Tap the label to read just that area.</p>}
    {!!cropFindings.length&&<div className="pj-vision-tags" aria-label="Labels from crop">
      {cropFindings.map((finding,index)=><button key={index} type="button" disabled={disabled||scanning}
        onFocus={()=>setHighlight(finding)} onMouseEnter={()=>setHighlight(finding)}
        onClick={()=>{addConfirmation(finding);setAliasLabel(finding.text)}}>Add {finding.value}</button>)}
    </div>}
    {marking&&<p className="pj-vision-help" role="status">Tap where the trade entered to read nearby labels again.</p>}
    {url&&cloudEnabled&&!scanning&&<p className="pj-vision-help">Cloudflare assistance sends an entry crop. {point?'Optional, within the configured free allowance.':'Mark the entry to use it.'}</p>}
    {!!review.length&&<div className="pj-vision-tags" aria-label="Suggestions to check">{review.map(finding=>
      <button type="button" key={`${finding.kind}:${finding.value}`} onFocus={()=>setHighlight(finding)}
        onBlur={()=>setHighlight(null)} onMouseEnter={()=>setHighlight(finding)} onMouseLeave={()=>setHighlight(null)}
        onClick={()=>setHighlight(finding)}>Check {caption[finding.kind]} · {finding.value}</button>)}</div>}
    {!!findings?.length&&<>
      <p className="pj-vision-help">Review the suggestions in your trade fields. Filled fields are kept. Tap highlighted chart text to select it as a confirmation.</p>
      <div className="pj-vision-tags">{findings.filter(finding=>!['annotation','visible_level'].includes(finding.kind)).map(finding=>
        <button type="button" key={`${finding.kind}:${finding.value}`}
          onMouseEnter={()=>setHighlight(finding)} onMouseLeave={()=>setHighlight(null)}
          onFocus={()=>setHighlight(finding)} onBlur={()=>setHighlight(null)} onClick={()=>setHighlight(finding)}
          title={finding.text}><small>{caption[finding.kind]}</small> {finding.kind==='direction'?(finding.value==='long'?'Buy':'Sell'):finding.value}</button>)}</div>
    </>}
    {!!findings?.some(finding=>finding.kind==='visible_level')&&<details>
      <summary>Other chart levels</summary>
      <div className="pj-vision-tags">{findings.filter(finding=>finding.kind==='visible_level').map(finding=>
        <button type="button" key={finding.value} onClick={()=>setHighlight(finding)}>{finding.value}</button>)}</div>
    </details>}
    {findings?.length===0&&<p>No readable trade labels found. Try a tighter crop of the setup.</p>}
    {picked&&<p role="status">{picked}</p>}
    {url&&!scanning&&<JournalChartProjection levels={chartLevels} prices={prices}
      onPrice={(field,value)=>setPrices(current=>({...current,[field]:value}))}
      marking={Boolean(markProjection)} nextLevel={markProjection} tradeDirection={tradeDirection} disabled={disabled}
      onMark={()=>{
        setMarking(false);
        setReadingLabel(false);
        if(markProjection){setMarkProjection(undefined);setLevels({})}
        else{setLevels({});setMarkProjection('entry')}
      }}
      onApply={projection=>{
        onProjection(projection);
        setPicked('Projection added to available Journal fields.');
      }}/>}
    {!scanning&&!!vocabulary.confirmations.length&&<details className="pj-vision-vocabulary">
      <summary>Remember a chart label</summary>
      <label>Chart text<input value={aliasLabel} maxLength={80} placeholder="e.g. CHOCH"
        onChange={event=>setAliasLabel(event.target.value)}/></label>
      <label>Journal confirmation<select aria-label="Journal confirmation" value={aliasConfirmation} onChange={event=>setAliasConfirmation(event.target.value)}>
        <option value="">Choose a confirmation</option>
        {vocabulary.confirmations.map(tag=><option key={tag}>{tag}</option>)}
      </select></label>
      <button className="pt-btn" type="button" disabled={disabled||aliasBusy||!aliasLabel.trim()||!aliasConfirmation}
        onClick={()=>void saveAlias()}>Save mapping</button>
      {Object.entries(aliases).map(([label,tag])=><div className="pj-vision-alias" key={label}>
        <span>{label} → {tag}</span><button type="button" disabled={disabled||aliasBusy}
          aria-label={`Remove mapping for ${label}`} onClick={()=>void saveAlias(true,label)}>Remove</button>
      </div>)}
    </details>}
    </div></div>}
    {chart&&onAttach&&!scanning&&<button type="button" className="pt-btn" disabled={disabled}
      onClick={async()=>{if(await onAttach(chart))setChart(null)}}>Save entry &amp; attach chart</button>}
  </section>;
}
