import {expect, test, vi} from 'vitest';
import {installDrawingGeometry, containingDrawingBar} from './replayDrawingGeometry';
import {replayBucketOpen} from './replayHistoryCalendar';

test('hourly edit keeps its exact anchor and maps to the existing Daily candle through interval changes', () => {
  vi.stubGlobal('location', {search: '?drawingDebug=1'});
  vi.stubGlobal('requestAnimationFrame', callback => { callback(); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const anchor = {time: Date.parse('2023-09-12T20:00:00Z'), price: 15422.75};
  const daily = Date.parse('2023-09-11T22:00:00Z');
  const original = {time: daily, price: anchor.price};
  const native = {
    bars: [],
    coords: {timeToLogical(time) {return native.bars.findIndex(bar => bar.time === time);}, xToLogical: x => x / 20},
    drawingProjector: () => ({yOf: () => 50, xOf: time => 80 + (time - native.bars[0].time) / 4_000_000}),
    snapToCandle: point => ({time: point.time, price: anchor.price}),
  };
  native.userDrawings = {deps:{projector:native.drawingProjector}};
  const drawing = {id: 'pdh', paneId: 'price', anchors: [original]};
  const chart = {renderer: {renderer: native}, market: {}, drawings: {all: () => [drawing]}};
  const release = installDrawingGeometry(chart);
  const switchTo = timeframe => {
    release.trace('before');
    chart.market.timeframe = timeframe;
    native.bars = [...new Set([original.time, anchor.time].map(time => replayBucketOpen(time, timeframe)))]
      .sort((a,b) => a-b).map(time => ({time}));
    release.trace('after');
  };
  try {
    chart.market.timeframe = '1D';
    native.bars = [{time: daily}];
    for (const timeframe of ['240', '60', '15', '1D']) {
      switchTo(timeframe);
      expect(drawing.anchors).toEqual([original]);
    }
    switchTo('60');
    expect(native.snapToCandle({time: anchor.time + 1, price: 15422.72}, 'price', 'strong', {x:20})).toEqual(anchor);
    drawing.anchors[0] = anchor;
    switchTo('1D');
    expect(drawing.anchors).toEqual([anchor]);
    expect(native.userDrawings.deps.projector().xOf(anchor.time)).toBe(native.drawingProjector().xOf(daily));
    expect(native.drawingProjector().xOf(anchor.time)).toBe(99.8);
    const [,phase,timeframe,rows] = debug.mock.lastCall;
    expect([phase,timeframe]).toEqual(['after','1D']);
    expect(JSON.parse(rows)[0].anchors[0]).toMatchObject({...anchor, barOpen: daily, legacyX:99.8, x:80});
    const space = {time:anchor.time + 1,price:100};
    expect(native.snapToCandle(space,'price','strong',{x:1000})).toBe(space);
  } finally {
    release();
    debug.mockRestore();
    vi.unstubAllGlobals();
  }
});

test('missing periods do not remap an anchor onto another candle', () => {
  const open = Date.parse('2023-03-12T22:00:00Z');
  const sunday = Date.parse('2023-03-12T23:00:00Z');
  expect(containingDrawingBar([{time:open}], sunday, '1D')).toBe(open);
  expect(containingDrawingBar([{time:open - 86400000}], sunday, '1D')).toBe(sunday);
});
