import {fitChartPriceAxis, firstBoundaryTouch} from './chartProjectionEvidence';
import type {Finding} from './InteractiveChartPreview';

export type Point = {x: number; y: number};
export type Box = Finding['box'];
type Region = Box;
type OCRLine = {text: string; box: Box; confidence: number; isolated?: boolean; words: {text: string; box: Box}[]};
export type Vocabulary = {
  markets: string[]; confirmations: string[]; levels: string[];
  entryTimeframes: string[]; levelTimeframes: string[]; aliases?: Record<string,string>;
};
type Position = {entry: Point; box: Box; direction: 'long' | 'short'};
export type ProjectionEvidence = {prices?: {entry: number; stop: number; target: number}; touch: 'target'|'stop'|'ambiguous'|null};
export type ChartRead = {header: OCRLine[]; lines: OCRLine[]; position?: Position; projection?: ProjectionEvidence};

const whole = {x: 0, y: 0, width: 1, height: 1};
const priceAxis = {x:.92,y:.025,width:.08,height:.9};
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

// The reward fill darkens the red channel more than green. Compare across
// the tool edges so this also works when a session shade sits underneath.
function locateTranslucentPosition(image: ImageBitmap, anchor?: Point): Position | undefined {
  const {canvas, context} = sample(image,whole,720);
  const {width,height}=canvas;
  const {data}=context.getImageData(0,0,width,height);
  const pixel=(x:number,y:number,c:number)=>data[(y*width+x)*4+c];
  function rewardEdge(x:number,y:number,side:number) {
    const outside=x-side*4, inside=x+side*4;
    const r=pixel(outside,y,0)-pixel(inside,y,0);
    const g=pixel(outside,y,1)-pixel(inside,y,1);
    const b=pixel(outside,y,2)-pixel(inside,y,2);
    return r>=24&&r<=85&&g>=10&&b>=8&&r-g>=9&&r-b>=9;
  }
  function boundary(x:number,right:number,y:number,kind:'reward' | 'risk' | 'seam', direction:'long'|'short') {
    const profitableAbove=direction==='long';
    let votes=0;
    for(let column=x+7;column<right-6;column+=3){
      const sign=(kind==='reward')===profitableAbove?1:-1;
      const r=sign*(pixel(column,y-3,0)-pixel(column,y+3,0));
      const g=sign*(pixel(column,y-3,1)-pixel(column,y+3,1));
      const b=sign*(pixel(column,y-3,2)-pixel(column,y+3,2));
      const match=kind==='reward'? r>=24&&r<=85&&g>=10&&b>=8&&r-g>=9&&r-b>=9
        :kind==='risk'? Math.min(r,g,b)>=14&&Math.max(r,g,b)<=65&&Math.max(r,g,b)-Math.min(r,g,b)<16
        : r>=3&&r<60&&r-g>9&&r-b>9;
      if(match)votes++;
    }
    return votes;
  }
  const minHeight=Math.round(height*.028), candidates:{score:number;position:Position}[]=[];
  const ax=anchor&&anchor.x*width, ay=anchor&&anchor.y*height;
  for(let x=Math.max(6,Math.floor((ax??0)-width*.24));x<Math.min(width-28,(ax??width)+9);x++){
    const rewardRows=Array.from({length:height},(_,y)=>rewardEdge(x,y,1));
    for(let top=6;top<height-2*minHeight;top++){
      if(!rewardRows[top])continue;
      let bottom=top;
      while(bottom+6<height&&rewardRows.slice(bottom+1,bottom+7).some(Boolean))bottom++;
      const rewardTop=top;
      top=bottom;
      if(bottom-rewardTop<minHeight)continue;
      for(let right=Math.max(x+22,Math.floor((ax??0)-4));right<Math.min(width-6,x+width*.48);right++){
        let support=0;
        for(let y=rewardTop+2;y<bottom-1;y+=3) if(rewardEdge(right,y,-1))support++;
        if(support<(bottom-rewardTop)*.17)continue;
        const minimum=Math.max(3,(right-x-13)*.13);
        for(const direction of ['long','short'] as const){
          const approxSeam=direction==='long'?bottom:rewardTop;
          const approxTarget=direction==='long'?rewardTop:bottom;
          if(ay!==undefined&&Math.abs(approxSeam-ay)>height*.055)continue;
          const nearestBoundary=(from:number,to:number,kind:Parameters<typeof boundary>[3], guess:number)=>{
            let best:{row:number;votes:number;score:number}|undefined;
            for(let row=Math.max(5,from);row<=Math.min(height-5,to);row++){
              const votes=boundary(x,right,row,kind,direction);
              const score=votes-Math.abs(row-guess)*.12;
              if(votes>=minimum&&(!best||score>best.score))best={row,votes,score};
            }
            return best;
          };
          const seam=nearestBoundary(approxSeam-12,approxSeam+12,'seam',ay??approxSeam);
          const target=nearestBoundary(approxTarget-8,approxTarget+8,'reward',approxTarget);
          if(!seam||!target||Math.abs(seam.row-target.row)<minHeight)continue;
          const stop=direction==='long'
            ?nearestBoundary(seam.row+minHeight,seam.row+height*.24,'risk',seam.row)
            :nearestBoundary(seam.row-height*.24,seam.row-minHeight,'risk',seam.row);
          if(!stop)continue;
          const y=Math.min(target.row,stop.row), end=Math.max(target.row,stop.row);
          candidates.push({score:support+seam.score+target.score+stop.score,
            position:{direction, entry:{x:x/width,y:seam.row/height},
              box:{x:x/width,y:y/height,width:(right-x)/width,height:(end-y)/height}}});
        }
      }
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  if(!best)return;
  const rival=candidates.find(({position})=>Math.abs(position.entry.x-best.position.entry.x)>.025||
    Math.abs(position.entry.y-best.position.entry.y)>.035||position.direction!==best.position.direction);
  if(!rival||best.score-rival.score>4)return best.position;
}

function locatePosition(image: ImageBitmap, anchor?: Point): ChartRead['position'] {
  const {canvas, context} = sample(image, whole, 360);
  const {width, height} = canvas;
  const {data} = context.getImageData(0, 0, width, height);
  const bands: {sign: number; left: number; right: number; top: number; bottom: number}[] = [];
  for (let y = Math.floor(height * .12); y < height * .93; y++) {
    let sign = 0, left = 0;
    for (let x = 0; x <= width; x++) {
      const i = (y*width+x)*4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const shade = x === width || g < 95 || r < 70 ? 0
        : g-r >= 28 && r<215 && g >= b-7 ? 1
        : r-g >= 15 && r-b >= 9 ? -1
        : r < 220 && g-r >= 3 && g-r <= 28 && Math.abs(g-b)<=7 ? 2 : 0;
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
  const candidates = bands.filter(band => band.bottom-band.top >= 4);
  const pairs = candidates.flatMap(upper => candidates.filter(lower => {
    if (upper.sign===lower.sign || (upper.sign!==1 && lower.sign!==1 && (upper.sign===2 || lower.sign===2))) return false;
    if (Math.abs(upper.bottom-lower.top)>3 || Math.abs(upper.left-lower.left)>3) return false;
    if (Math.abs(upper.right-lower.right)>width*(upper.sign===2||lower.sign===2?.065:.018)) return false;
    return !anchor || (Math.abs(upper.bottom/height-anchor.y)<.035 &&
      anchor.x>=Math.min(upper.left,lower.left)/width-.025 && anchor.x<=Math.max(upper.right,lower.right)/width+.025);
  }).map(lower=>({upper,lower})));
  if (pairs.length !== 1) {
    const starts = [...new Set(candidates.filter(band=>band.sign===1).map(band=>band.left))];
    const possible: Position[] = [];
    for (const left of starts) {
      if (anchor && (anchor.x*width < left-9 || anchor.x*width > left+width*.24)) continue;
      const columnEnd=Math.min(width,left+Math.round(width*.055));
      const rows=Array.from({length:height},(_,y)=>{
        let teal=0, grey=0;
        for(let x=left+3;x<columnEnd;x++){
          const i=(y*width+x)*4, r=data[i], g=data[i+1], b=data[i+2];
          if(r>=85&&r<205&&g-r>=29&&Math.abs(g-b)<13)teal++;
          if(r>=145&&r<215&&g-r>=6&&g-r<=28&&Math.abs(g-b)<9)grey++;
        }
        return teal>=Math.ceil((columnEnd-left-3)*.48)?1:grey>=Math.ceil((columnEnd-left-3)*.48)?2:0;
      });
      for(let seam=8;seam<height-8;seam++){
        if(rows[seam]!==2||rows[seam-2]!==1||rows[seam-1]===2)continue;
        if(anchor&&Math.abs(anchor.y-seam/height)>.035)continue;
        let top=seam-2, bottom=seam;
        while(top>3&&(rows[top-1]===1||rows.slice(top-3,top).includes(1)))top--;
        while(bottom<height-4&&(rows[bottom+1]===2||rows.slice(bottom+1,bottom+4).includes(2)))bottom++;
        while(top<seam&&rows[top]!==1)top++;
        while(bottom>seam&&rows[bottom]!==2)bottom--;
        if(seam-top<height*.07||bottom-seam<height*.035)continue;
        const lower=candidates.filter(band=>band.sign===2&&Math.abs(band.left-left)<=7&&band.top>=seam-3&&band.bottom<=bottom+4)
          .sort((a,b)=>b.right-a.right)[0];
        if(!lower)continue;
        const position: Position={entry:{x:left/width,y:seam/height},direction:'long',
          box:{x:left/width,y:top/height,width:(lower.right-left)/width,height:(bottom+1-top)/height}};
        if(!possible.some(prior=>Math.abs(prior.entry.x-position.entry.x)<.025&&Math.abs(prior.entry.y-position.entry.y)<.025))possible.push(position);
      }
    }
    return possible.length===1?possible[0]:locateTranslucentPosition(image,anchor);
  }
  const {upper, lower} = pairs[0];
  const left=Math.min(upper.left,lower.left), right=Math.max(upper.right,lower.right);
  return {
    entry: {x:left/width,y:(upper.bottom+lower.top)/2/height},
    box: {x:left/width,y:upper.top/height,width:(right-left)/width,height:(lower.bottom-upper.top)/height},
    direction: upper.sign === 1 ? 'long' : 'short',
  };
}

function projectionEvidence(image: ImageBitmap, position: Position, axis: OCRLine[]): ProjectionEvidence {
  const long = position.direction==='long';
  const upper=position.box.y, lower=upper+position.box.height;
  const stop=long?lower:upper, target=long?upper:lower;
  const quotes=axis.flatMap(line=>line.words).flatMap(({text,box})=>{
    if (!/^[0-9][0-9,]*\.[0-9]{1,5}$/.test(text)) return [];
    return [{price:Number(text.replaceAll(',','')),y:box.y+box.height/2}];
  });
  const at=fitChartPriceAxis(quotes);
  const estimate=(y:number)=>Number(at!(y).toFixed(5));
  const prices=at?{entry:estimate(position.entry.y),stop:estimate(stop),target:estimate(target)}:undefined;

  const {canvas,context}=sample(image,whole,1800);
  const {width,height}=canvas;
  const {data}=context.getImageData(0,0,width,height);
  const left=Math.ceil((position.box.x+.008)*width), right=Math.min(width-10,Math.floor((position.box.x+position.box.width+.004)*width));
  function firstCrossing(level:number) {
    const y=Math.round(level*height);
    if (y<4 || y+4>=height) return null;
    const dark=(x:number,row:number)=>{
      const i=(row*width+x)*4;
      return data[i]<105&&data[i+1]<116&&data[i+2]<124;
    };
    for(let x=left;x<right;x++){
      // Wicks have a narrow, mostly vertical dark stroke on both sides.
      const wick=[-3,-2,-1,0,1,2,3].filter(offset=>dark(x,y+offset)).length>=6;
      if(wick&&![-9,9].some(dx=>dark(x+dx,y-2)&&dark(x+dx,y+2)))return x;
    }
    return null;
  }
  return {prices,touch:firstBoundaryTouch({target:firstCrossing(target),stop:firstCrossing(stop)})};
}

async function startWorker() {
  const [engine, {default: workerPath}, {default: corePath}] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
  ]);
  const worker = await engine.createWorker('eng', engine.OEM.LSTM_ONLY, {
    workerPath, corePath, workerBlobURL:false, langPath:'/assets/chart-ocr-eng-v1',
  });
  try {
    await worker.setParameters({tessedit_pageseg_mode:engine.PSM.SPARSE_TEXT});
    return worker;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

export class ChartOcrSession {
  private worker?: ReturnType<typeof startWorker>;

  acquire() {
    return this.worker ??= startWorker();
  }

  dispose() {
    const pending = this.worker;
    this.worker = undefined;
    if (pending) void pending.then(worker=>worker.terminate()).catch(()=>{});
  }
}

function levelLabelRegion(point:Point): Region {
  return {x:Math.min(.53,point.x+.10),y:Math.max(0,Math.min(.84,point.y-.075)),width:.46,height:.16};
}

// Remove connected drawing strokes wider or taller than nearby chart text.
function isolateChartText(context:CanvasRenderingContext2D,width:number,height:number) {
  const image = context.getImageData(0,0,width,height);
  const pixels = image.data;
  const ink = new Uint8Array(width*height);
  for (let i=0;i<ink.length;i++) {
    const offset=i*4;
    ink[i]=pixels[offset]+pixels[offset+1]+pixels[offset+2]<435?1:0;
    pixels[offset]=pixels[offset+1]=pixels[offset+2]=255;
  }
  for (let i=0;i<ink.length;i++) {
    if (!ink[i]) continue;
    const component=[i];
    ink[i]=0;
    let left=width,right=0,top=height,bottom=0;
    for (let j=0;j<component.length;j++) {
      const p=component[j], x=p%width, y=Math.floor(p/width);
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
      for (let ny=Math.max(0,y-1);ny<=Math.min(height-1,y+1);ny++) {
        for (let nx=Math.max(0,x-1);nx<=Math.min(width-1,x+1);nx++) {
          const next=ny*width+nx;
          if (ink[next]) {ink[next]=0;component.push(next);}
        }
      }
    }
    if (right-left>width*.09 || bottom-top>height*.28 || component.length<5) continue;
    for (const p of component) pixels[p*4]=pixels[p*4+1]=pixels[p*4+2]=0;
  }
  context.putImageData(image,0,0);
}

async function readRegions(file: File, regions: {area: Region; size: number; isolateText?: boolean; shear?: number}[], signal: AbortSignal, session: ChartOcrSession, anchor?: Point) {
  signal.throwIfAborted();
  const image = await createImageBitmap(file);
  let stop = () => {};
  try {
    if (image.width*image.height > 32_000_000) throw new Error('Choose a chart image under 32 megapixels.');
    signal.throwIfAborted();
    const cancel = new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, {once:true});
    });
    const worker = await Promise.race([session.acquire(), cancel]);
    const readings: OCRLine[][] = [];
    const axis=regions.findIndex(region=>region.area===priceAxis);
    const position=axis>=0?locatePosition(image,anchor):undefined;
    const fullChart = regions.some(region=>region.area===whole);
    if (position && fullChart) regions.push({area:levelLabelRegion(position.entry),size:2200},
      {area:entryRegion({x:position.entry.x+.14,y:position.entry.y},.32,.10),size:1750});
    if (position || anchor) {
      const entry = anchor || position!.entry;
      const bottom = position ? position.box.y + position.box.height : entry.y + .07;
      regions.push({area:entryRegion({x:entry.x+.025,y:bottom+.044},.115,.072),size:850,isolateText:true},
        {area:entryRegion({x:entry.x+.025,y:bottom+.044},.115,.072),size:850,isolateText:true,shear:.16});
    }
    const {PSM} = await import('tesseract.js');
    for (const {area,size,isolateText,shear=0} of regions) {
      const {canvas,context} = sample(image,area,size);
      if (isolateText) isolateChartText(context,canvas.width,canvas.height);
      if (shear) {
        const source = await createImageBitmap(canvas);
        context.fillStyle = '#fff';
        context.fillRect(0,0,canvas.width,canvas.height);
        context.setTransform(1,shear,0,1,0,-shear*canvas.width/2);
        context.drawImage(source,0,0);
        source.close();
      }
      if (shear) await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
      const {data: result} = await Promise.race([worker.recognize(canvas, {}, {blocks:true}),cancel]);
      if (shear) await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
      const locate = ({x0,y0,x1,y1}: {x0:number;y0:number;x1:number;y1:number}): Box => ({
        x:area.x+x0/canvas.width*area.width, y:area.y+(y0-shear*(x1-canvas.width/2))/canvas.height*area.height,
        width:(x1-x0)/canvas.width*area.width, height:(y1-y0+shear*(x1-x0))/canvas.height*area.height,
      });
      readings.push((result.blocks || []).flatMap(block=>block.paragraphs).flatMap(paragraph=>paragraph.lines)
        .map(line=>({text:line.text.trim(), box:locate(line.bbox), confidence:line.confidence, isolated:Boolean(shear),
                     words:line.words.map(word=>({text:word.text,box:locate(word.bbox)}))})));
    }
    return {readings,position,projection:position?projectionEvidence(image,position,readings[axis]):undefined};
  } catch (error) {
    session.dispose();
    throw error;
  } finally {
    signal.removeEventListener('abort',stop);
    image.close();
  }
}

export async function scanChart(file: File, signal: AbortSignal, session: ChartOcrSession): Promise<ChartRead> {
  const {readings,position,projection} = await readRegions(file,[{area:header,size:2100},{area:whole,size:2800},{area:priceAxis,size:2450}],signal,session);
  return {header:readings[0],lines:[...readings.slice(3).flat(),...readings[1]],position,projection};
}

export async function scanEntry(file: File, point: Point, signal: AbortSignal, session: ChartOcrSession) {
  const neighbourhood={x:Math.max(0,Math.min(.60,point.x-.09)),y:Math.max(0,Math.min(.72,point.y-.11)),width:.40,height:.28};
  const entryLine = entryRegion({x:point.x+.14,y:point.y},.32,.10);
  const {readings,position,projection} = await readRegions(file,[{area:neighbourhood,size:2350},{area:entryLine,size:1750},
    {area:levelLabelRegion(point),size:2200},{area:priceAxis,size:2450}],signal,session,point);
  return {lines:[...readings[2],...readings.slice(4).flat(),...readings[0],...readings[1]],position,projection};
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

function confirmationLabels(line: OCRLine, vocabulary: Vocabulary) {
  const terms = new Map(vocabulary.confirmations.map(value=>[value,value]));
  for (const [alias, value] of Object.entries(vocabulary.aliases || {})) {
    if (vocabulary.confirmations.includes(value)) terms.set(alias,value);
  }
  return [...terms].flatMap(([term,value])=>{
    const label = findLabel(line,[term]);
    return label ? [{...label,value}] : [];
  });
}

export async function scanLabel(file: File, point: Point, vocabulary: Vocabulary, signal: AbortSignal, session: ChartOcrSession): Promise<Finding[]> {
  const {readings} = await readRegions(file,[{area:entryRegion(point,.16,.095),size:1250}],signal,session);
  return readings[0].filter(line=>line.confidence>=25).sort((a,b)=>{
    const distance = ({box}: OCRLine)=>Math.hypot(point.x-box.x-box.width/2,point.y-box.y-box.height/2);
    return distance(a)-distance(b);
  }).flatMap((line): Finding[]=>{
    const [term] = confirmationLabels(line,vocabulary);
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
  for (const line of chart.lines.filter(line=>(line.confidence>=24 || line.isolated) && line.box.y>.085 && line.box.x<.94)) {
    const tags = confirmationLabels(line,vocabulary).filter(tag=>line.confidence>=24 || (
      // Whole-line confidence is penalised by stray strokes outside the label.
      tag.text===tag.value && /^[A-Z]{2,5}$/.test(tag.text)
    ));
    const explicit = line.text.match(/(?:^|[-—_.]{3,}\s*)([A-Za-z][A-Za-z0-9 /-]{2,55})\s*\((?:W|D|M|[0-9]+[HM])\)\s*$/i);
    const quadrant = line.text.match(/\b(?:upper|lower)\s*quadrant\s*(?:\d+\s*(?:h(?:r|our)?|m(?:in)?)\s*)?(?:OB|RB|order blocks?|rejection blocks?)\b/i);
    const recognisedLevel = findLabel(line,vocabulary.levels);
    const highLow = line.text.match(/\bhighs?\s*(?:and|&|\/)\s*lows?\b/i);
    const labelledZone = (quadrant?.[0] || explicit?.[1])?.trim().replace(/([a-z])([A-Z])/g,'$1 $2');
    const level = highLow ? {
      value:vocabulary.levels.find(choice=>/^highs?(?:and)?lows?$/i.test(simplify(choice))) || 'High and Low',
      text:highLow[0],box:findLabel(line,[highLow[0]])?.box || line.box,
    } : labelledZone && /\b(?:RB|OB|FVG|IFVG|WICK|PDA|GAP|blocks?)\b/i.test(labelledZone)
      ? {value:vocabulary.levels.find(choice=>simplify(choice)===simplify(labelledZone)) || labelledZone,
        text:line.text,box:line.box} : recognisedLevel;
    const midY = line.box.y+line.box.height/2;
    const gapX = point ? Math.max(point.x-line.box.x-line.box.width,line.box.x-point.x,0) : 1;
    const gapY = point ? Math.abs(midY-point.y) : 1;
    for (const tag of tags) {
      const {x,y,width,height} = tag.box;
      const right = position ? position.box.x + position.box.width : point?.x ?? 0;
      const nearX = point && x < right+.23 && x+width > point.x-.23;
      const mid = y+height/2;
      const nearY = point && (Math.abs(mid-point.y)<.14 ||
        (position && mid>=position.box.y-.055 && mid<=position.box.y+position.box.height+.075));
      findings.push({kind:nearX && nearY?'confirmation':'annotation',...tag});
    }
    if (level && line.confidence>=24) {
      const suffix = line.text.match(/\((W|D|M|[0-9]+[HM])\)/i)?.[1]?.toUpperCase();
      const inline = line.text.match(/\b(\d+)\s*(h(?:ours?|rs?)?|m(?:in(?:utes?)?)?)\b/i);
      const normalized = suffix ? ({W:'Weekly',D:'Daily',M:'Monthly'}[suffix]||suffix)
        : inline ? inline[1]+(inline[2].toLowerCase().startsWith('h')?'H':'m') : undefined;
      const timeframe = vocabulary.levelTimeframes.find(item=>item.toLowerCase()===normalized?.toLowerCase());
      rankedLevels.push({score:gapX<.33 && gapY<.12?gapX*.3+gapY:Infinity,
                         item:{kind:'visible_level',...level,text:line.text,box:line.box},timeframe});
    } else if (!tags.length && line.confidence>=40 && /^[A-Za-z][A-Za-z0-9 ().+/-]{1,55}$/.test(line.text)) {
      findings.push({kind:'annotation',value:line.text,text:line.text,box:line.box});
    }
  }
  rankedLevels.sort((a,b)=>a.score-b.score);
  for (const level of rankedLevels) {
    if (level.timeframe) continue;
    level.timeframe = rankedLevels.find(other=>other.item.value===level.item.value && other.timeframe &&
      Math.abs(other.item.box.y-level.item.box.y)<.015 && Math.abs(other.item.box.x-level.item.box.x)<.04)?.timeframe;
  }
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
