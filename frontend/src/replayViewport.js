// Compatibility seam for the pinned Vela native renderer (0.9.3).
// Its public time range rounds/clamps to complete candles; restoring that range
// repeatedly changes candle spacing. Preserve the exact logical viewport instead.
export function holdReplayViewport(chart, appended) {
 const native=chart.renderer?.renderer;
 const viewport=native?.coords?.getViewport?.();
 if(!viewport||typeof native.applyViewport!=='function')return ()=>{};
 const saved={...viewport,rightOffset:viewport.rightOffset-appended};
 return ()=>native.applyViewport(saved);
}

// Same pinned compatibility seam as the logical viewport: shared native drawing
// projector respects manual scales, log mode, inversion and separate study panes.
export function replayProjector(chart){return chart?.renderer?.renderer?.drawingProjector?.()??null}
