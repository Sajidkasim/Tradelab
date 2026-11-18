import type {Finding} from './InteractiveChartPreview';

export type Point = {x: number; y: number};
export type Box = Finding['box'];
type Region = Box;
type OCRLine = {text: string; box: Box; confidence: number; words: {text: string; box: Box}[]};
export type Vocabulary = {
  markets: string[]; confirmations: string[]; levels: string[];
  entryTimeframes: string[]; levelTimeframes: string[]; aliases?: Record<string,string>;
};
export type ChartRead = {header: OCRLine[]; lines: OCRLine[]; position?: {entry: Point; box: Box; direction: 'long' | 'short'}};

const whole = {x: 0, y: 0, width: 1, height: 1};
const header = {x: 0, y: 0, width: .64, height: .13};
const simplify = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

function sample(image: ImageBitmap, region: Region, longest: number) {
  const canvas = document.createElement('canvas');
  const w = image.width * region.width, h = image.height * region.height;
  const scale = longest / Math.max(w, h);
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Chart reading is unavailable in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, image.width * region.x, image.height * region.y, w, h, 0, 0, canvas.width, canvas.height);
  return {canvas, context};
}

export function entryRegion(point: Point, width: number, height: number): Box {
  const x = Math.max(0, Math.min(1-width, point.x-width/2));
  const y = Math.max(0, Math.min(1-height, point.y-height/2));
  return {x,y,width,height};
}

function locatePosition(image: ImageBitmap): ChartRead['position'] {
  const {canvas, context} = sample(image, whole, 180);
  const {width, height} = canvas;
  const {data} = context.getImageData(0, 0, width, height);
  const bands: {sign: number; left: number; right: number; top: number; bottom: number}[] = [];
  for (let y = Math.floor(height * .12); y < height * .93; y++) {
    let sign = 0, left = 0;
    for (let x = 0; x <= width; x++) {
      const i = (y*width+x)*4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const shade = x === width ? 0 : g-r >= 14 && g >= b-5 ? 1 : r-g >= 15 && r-b >= 9 ? -1 : 0;
      if (shade === sign) continue;
      if (sign && x-left >= width*.08 && x-left <= width*.68) {
        const previous = bands.find(band => band.sign === sign && band.bottom === y &&
          Math.abs(band.left-left) <= 2 && Math.abs(band.right-x) <= 2);
        if (previous) previous.bottom = y+1;
        else bands.push({sign,left,right:x,top:y,bottom:y+1});
      }
      left = x;
      sign = shade;
    }
  }
  const candidates = bands.filter(band => band.bottom-band.top >= 3);
  const pairs = candidates.flatMap(upper => candidates.filter(lower => upper.sign !== lower.sign &&
    Math.abs(upper.bottom-lower.top) <= 2 && Math.abs(upper.left-lower.left) <= 2 &&
    Math.abs(upper.right-lower.right) <= 2).map(lower => ({upper,lower})));
  if (pairs.length !== 1) return;
  const {upper, lower} = pairs[0];
  return {
    entry: {x: upper.left/width, y: upper.bottom/height},
    box: {x: upper.left/width, y: upper.top/height, width: (upper.right-upper.left)/width, height: (lower.bottom-upper.top)/height},
    direction: upper.sign === 1 ? 'long' : 'short',
  };
}

async function readRegions(file: File, regions: {area: Region; size: number}[], signal: AbortSignal) {
  const [engine, {default: workerPath}, {default: corePath}] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
  ]);
  signal.throwIfAborted();
  const image = await createImageBitmap(file);
  let worker: Awaited<ReturnType<typeof engine.createWorker>> | undefined;
  let stop = () => {};
  try {
    if (image.width*image.height > 32_000_000) throw new Error('Choose a chart image under 32 megapixels.');
    const cancel = new Promise<never>((_, reject) => {
      stop = () => {
        if (worker) void worker.terminate();
        reject(signal.reason);
      };
      signal.addEventListener('abort', stop, {once:true});
    });
    signal.throwIfAborted();
    const pending = engine.createWorker('eng', engine.OEM.LSTM_ONLY, {
      workerPath, corePath, workerBlobURL:false, langPath:'/assets/chart-ocr-eng-v1',
    });
    pending.then(instance=>{if(signal.aborted) void instance.terminate()}).catch(()=>{});
    worker = await Promise.race([pending, cancel]);
    await Promise.race([worker.setParameters({tessedit_pageseg_mode:engine.PSM.SPARSE_TEXT}),cancel]);
    const readings: OCRLine[][] = [];
    for (const {area,size} of regions) {
      const {canvas} = sample(image,area,size);
      const {data: result} = await Promise.race([worker.recognize(canvas, {}, {blocks:true}),cancel]);
      const locate = ({x0,y0,x1,y1}: {x0:number;y0:number;x1:number;y1:number}): Box => ({
        x:area.x+x0/canvas.width*area.width, y:area.y+y0/canvas.height*area.height,
        width:(x1-x0)/canvas.width*area.width, height:(y1-y0)/canvas.height*area.height,
      });
      readings.push((result.blocks || []).flatMap(block=>block.paragraphs).flatMap(paragraph=>paragraph.lines)
        .map(line=>({text:line.text.trim(), box:locate(line.bbox), confidence:line.confidence,
                     words:line.words.map(word=>({text:word.text,box:locate(word.bbox)}))})));
    }
    return {readings, position:regions[1]?.area===whole?locatePosition(image):undefined};
  } finally {
    signal.removeEventListener('abort',stop);
    if (worker && !signal.aborted) await worker.terminate();
    image.close();
  }
}

export async function scanChart(file: File, signal: AbortSignal): Promise<ChartRead> {
  const {readings,position} = await readRegions(file,[{area:header,size:2100},{area:whole,size:2800}],signal);
  return {header:readings[0],lines:readings[1],position};
}

export async function scanEntry(file: File, point: Point, signal: AbortSignal) {
  const neighbourhood={x:Math.max(0,Math.min(.60,point.x-.09)),y:Math.max(0,Math.min(.72,point.y-.11)),width:.40,height:.28};
  const entryLine = entryRegion({x:point.x+.14,y:point.y},.32,.10);
  const {readings} = await readRegions(file,[{area:neighbourhood,size:2350},{area:entryLine,size:1750}],signal);
  return readings.flat();
}

function findLabel(line: OCRLine, choices: string[]) {
  for (const value of choices) {
    const expected = simplify(value);
    if (!expected) continue;
    for (let i=0;i<line.words.length;i++) {
      let actual = '';
      for (let j=i;j<line.words.length&&actual.length<expected.length;j++) {
        actual += simplify(line.words[j].text);
        if (actual !== expected) continue;
        const first = line.words[i].box, last = line.words[j].box;
        const y = Math.min(first.y,last.y);
        return {value, text:line.words.slice(i,j+1).map(word=>word.text).join(' '),
                box:{x:first.x,y,width:last.x+last.width-first.x,
                     height:Math.max(first.y+first.height,last.y+last.height)-y}};
      }
    }
  }
}

function confirmationLabel(line: OCRLine, vocabulary: Vocabulary) {
  const aliases = vocabulary.aliases || {};
  const label = findLabel(line,Object.keys(aliases).filter(key=>vocabulary.confirmations.includes(aliases[key])));
  return label ? {...label,value:aliases[label.value]} : findLabel(line,vocabulary.confirmations);
}

export async function scanLabel(file: File, point: Point, vocabulary: Vocabulary, signal: AbortSignal): Promise<Finding[]> {
  const {readings} = await readRegions(file,[{area:entryRegion(point,.16,.095),size:1250}],signal);
  return readings[0].filter(line=>line.confidence>=25).sort((a,b)=>{
    const distance = ({box}: OCRLine)=>Math.hypot(point.x-box.x-box.width/2,point.y-box.y-box.height/2);
    return distance(a)-distance(b);
  }).flatMap((line): Finding[]=>{
    const term = confirmationLabel(line,vocabulary);
    const label = term || {text:line.text,value:line.text,box:line.box};
    if (!/^[A-Za-z][A-Za-z0-9 ().+/-]{0,55}$/.test(label.text) || label.box.width>.15 || label.box.height>.06) return [];
    return [{kind:'annotation',...label}];
  }).slice(0,6);
}

export function chartFindings(chart: ChartRead, vocabulary: Vocabulary, anchor?: Point): Finding[] {
  const findings: Finding[] = [];
  const position = chart.position;
  const point = anchor || position?.entry;
  const market = [...vocabulary.markets].sort((a,b)=>b.length-a.length);
  const headerLines = chart.header.filter(line=>line.confidence>=40);
  for (const line of headerLines) {
    const match = line.words.find(word=>market.some(symbol=>word.text.toUpperCase().replace(/\d+!$|[!,.]+$/g,'')===symbol));
    if (match && !findings.some(item=>item.kind==='asset')) {
      const value = match.text.toUpperCase().replace(/\d+!$|[!,.]+$/g,'');
      findings.push({kind:'asset',value,text:match.text,box:match.box});
    }
    if (!findings.some(item=>item.kind==='entry_timeframe')) {
      const explicit = findLabel(line,vocabulary.entryTimeframes);
      const interval = line.text.match(/(?:^|[·|•\s])([0-9]{1,3}|[DWM])\s*[·|•.,:–—-]*\s*(?:CME|CBOT|NASDAQ|NYSE|OANDA|COMEX)\b/i)?.[1]?.toUpperCase();
      const value = interval && (interval==='D'?'Daily':interval==='W'?'Weekly':interval==='M'?'Monthly':`${interval}m`);
      const implied = value && vocabulary.entryTimeframes.find(item=>item.toLowerCase()===value.toLowerCase());
      if (explicit) findings.push({kind:'entry_timeframe',...explicit});
      else if (implied) {
        const word = line.words.find(token=>token.text===interval);
        findings.push({kind:'entry_timeframe',value:implied,text:interval!,box:word?.box||line.box});
      }
    }
  }
  if (position && (!anchor || Math.hypot(anchor.x-position.entry.x,anchor.y-position.entry.y)<.085)) {
    findings.push({kind:'direction',value:position.direction,text:'Position drawing',box:position.box});
  }
  const rankedLevels: {score:number; item:Finding; timeframe?: string}[] = [];
  for (const line of chart.lines.filter(line=>line.confidence>=24 && line.box.y>.085 && line.box.x<.94)) {
    const tag = confirmationLabel(line,vocabulary);
    const explicit = line.text.match(/(?:^|[-—_.]{3,}\s*)([A-Za-z][A-Za-z0-9 /-]{2,55})\s*\((?:W|D|M|[0-9]+[HM])\)\s*$/i);
    const recognizedLevel = findLabel(line,vocabulary.levels);
    const labelledZone = explicit && explicit[1].trim().replace(/([a-z])([A-Z])/g,'$1 $2');
    const level = recognizedLevel || (labelledZone && /\b(?:RB|OB|FVG|IFVG|WICK|PDA|GAP)\b/i.test(labelledZone)
      ? {value:labelledZone,text:line.text,box:line.box} : null);
    const midY = line.box.y+line.box.height/2;
    const gapX = point ? Math.max(point.x-line.box.x-line.box.width,line.box.x-point.x,0) : 1;
    const gapY = point ? Math.abs(midY-point.y) : 1;
    if (tag) findings.push({kind:gapX<.23 && gapY<.115?'confirmation':'annotation',...tag});
    if (level) {
      const suffix = line.text.match(/\((W|D|M|[0-9]+[HM])\)/i)?.[1]?.toUpperCase();
      const normalized = suffix && ({W:'Weekly',D:'Daily',M:'Monthly'}[suffix]||suffix);
      const timeframe = vocabulary.levelTimeframes.find(item=>item.toLowerCase()===normalized?.toLowerCase());
      rankedLevels.push({score:gapX<.33 && gapY<.12?gapX*.3+gapY:Infinity,
                         item:{kind:'visible_level',...level,text:line.text,box:line.box},timeframe});
    } else if (!tag && line.confidence>=40 && /^[A-Za-z][A-Za-z0-9 ().+/-]{1,55}$/.test(line.text)) {
      findings.push({kind:'annotation',value:line.text,text:line.text,box:line.box});
    }
  }
  rankedLevels.sort((a,b)=>a.score-b.score);
  const best = rankedLevels[0], next = rankedLevels.find(entry=>entry.item.value!==best?.item.value);
  if (best && Number.isFinite(best.score) && (!next || next.score-best.score>.02)) {
    best.item.kind='key_level';
    if (best.timeframe) findings.push({...best.item,kind:'level_timeframe',value:best.timeframe});
  }
  const primary = rankedLevels.find(level=>level.item.kind==='key_level');
  findings.push(...rankedLevels.filter(level=>level===primary || level.item.value!==primary?.item.value).map(level=>level.item));
  const unique = new Map<string, Finding>();
  for (const item of findings) {
    const key = `${item.kind}:${item.value.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key,item);
  }
  return [...unique.values()].slice(0,60);
}

export async function compressCrop(file: File, region: Box): Promise<File> {
  const image = await createImageBitmap(file);
  try {
    const {canvas} = sample(image,region,1200);
    for (const quality of [.86,.74,.62]) {
      const blob = await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if (blob && blob.size<500_000) return new File([blob],'entry-crop.jpg',{type:'image/jpeg'});
    }
    throw new Error('The chart crop could not be compressed.');
  } finally { image.close(); }
}
