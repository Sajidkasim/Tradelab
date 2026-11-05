import {replayBucketOpen} from './replayHistoryCalendar';

function hasBarOpen(bars, open) {
  let low = 0, high = bars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bars[middle].time < open) low = middle + 1;
    else high = middle;
  }
  return bars[low]?.time === open;
}

export function containingDrawingBar(bars, time, timeframe) {
  const open = replayBucketOpen(time, timeframe);
  return hasBarOpen(bars, open) ? open : time;
}

const labeledLines = new Set(['trendline', 'hline', 'hray']);
const fontSizes = {tiny: 10, small: 12, normal: 14, large: 18, huge: 24};

export function installDrawingGeometry(chart) {
  const native = chart.renderer.renderer;
  const layer = native.userDrawings;
  const original = layer?.deps?.projector;
  const snap = native.snapToCandle;
  const painter = layer?.painter;
  const paint = painter?.paintLabel;
  if (!original || !snap) return () => {};
  const debug = new URLSearchParams(location.search).get('drawingDebug') === '1';
  let cachedTimeframe;
  const buckets = new Map();
  layer.deps.projector = function () {
    const projector = original.call(this);
    const timeframe = String(chart.market.timeframe);
    if (cachedTimeframe !== timeframe) {
      cachedTimeframe = timeframe;
      buckets.clear();
    }
    const xOf = projector.xOf;
    projector.xOf = time => {
      if (!buckets.has(time)) {
        if (buckets.size >= 4096) buckets.clear();
        buckets.set(time, replayBucketOpen(time, timeframe));
      }
      const open = buckets.get(time);
      // Project the anchor onto the displayed candle without updating the drawing document.
      return xOf(open !== time && hasBarOpen(native.bars, open) ? open : time);
    };
    return projector;
  };
  native.snapToCandle = function (point, paneId, mode, cursor) {
    const index = Math.round(cursor ? this.coords.xToLogical(cursor.x) : this.coords.timeToLogical(point.time));
    const bar = this.bars[index];
    if (!bar || mode === 'off') return point;
    return snapToRealCandle(snap, this, point, bar, paneId, mode, cursor);
  };
  if (paint) painter.paintLabel = function (ctx, drawing, projector, theme) {
    if ((!labeledLines.has(drawing.type) && drawing.type !== 'box') || !drawing.text?.value) {
      return paint.call(this, ctx, drawing, projector, theme);
    }
    if (drawing.id === this.targets.mutedLabel) return;
    const {anchors, text, paneId} = drawing;
    const bounds = projector.paneRect(paneId);
    if (!anchors[0] || !bounds) return;
    let x1 = projector.xOf(anchors[0].time), y1 = projector.yOf(anchors[0].price, paneId);
    let x2 = anchors[1] ? projector.xOf(anchors[1].time) : projector.width;
    let y2 = anchors[1] ? projector.yOf(anchors[1].price, paneId) : y1;
    if (drawing.type === 'hline') {x1 = 0; x2 = projector.width;}
    if (drawing.type === 'hray') {x2 = projector.width; y2 = y1;}
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    if (x2 < x1) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
    const align = text.place === 'start' ? 'left' : text.place === 'end' ? 'right' : text.hAlign || 'center';
    const ratio = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const size = fontSizes[text.size] || fontSizes.normal;
    const lines = text.value.split('\n');
    const height = size * 1.2;
    const box = drawing.type === 'box';
    const x = x1 + (x2 - x1) * ratio + (box ? (0.5 - ratio) * Math.min(10, x2 - x1) : 0);
    const y = box
      ? text.vAlign === 'top' ? Math.min(y1, y2) + 4
        : text.vAlign === 'bottom' ? Math.max(y1, y2) - 4 - lines.length * height
        : (y1 + y2 - lines.length * height) / 2
      : y1 + (y2 - y1) * ratio + (text.side === 'above' ? -lines.length * height - 3
        : text.side === 'below' ? 3 : -lines.length * height / 2);
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.font = `${text.bold ? 'bold ' : ''}${text.italic ? 'italic ' : ''}${size}px ${theme.fontFamily}`;
    ctx.fillStyle = text.color || theme.textColor;
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * height));
    ctx.restore();
  };
  const trace = phase => {
    const timeframe = String(chart.market.timeframe);
    const legacy = original.call(native);
    const projected = layer.deps.projector();
    console.debug('[replay drawings]', phase, timeframe, JSON.stringify(chart.drawings.all().map(drawing => ({
      id: drawing.id, anchors: drawing.anchors.map(({time, price}) => ({
        time, price, barOpen: containingDrawingBar(native.bars, time, timeframe),
        legacyX: legacy.xOf(time), x: projected.xOf(time), y: projected.yOf(price, drawing.paneId),
      })),
    }))), JSON.stringify(native.bars.slice(-3).map(bar => ({time:bar.time, x:legacy.xOf(bar.time)}))));
  };
  let traceFrame;
  return Object.assign(() => {
    if (traceFrame !== undefined) cancelAnimationFrame(traceFrame);
    layer.deps.projector = original;
    native.snapToCandle = snap;
    if (paint) painter.paintLabel = paint;
  }, {trace: debug ? phase => {
    if (phase === 'before') trace(phase);
    else traceFrame = requestAnimationFrame(() => {
      traceFrame = requestAnimationFrame(() => trace(phase));
    });
  } : undefined});
}

function snapToRealCandle(snap, renderer, point, bar, paneId, mode, cursor) {
  const candidate = {...point, time: bar.time};
  const result = snap.call(renderer, candidate, paneId, mode, cursor);
  return result === candidate ? point : result;
}
