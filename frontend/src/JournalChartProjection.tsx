import React from 'react';
import {priceInput, readProjection} from './journalProjection';

export const projectionFields = ['entry', 'stop', 'target'] as const;
export type ProjectionField = typeof projectionFields[number];
export type Projection = {direction: 'long' | 'short'; plannedRR: number; outcome: 'win' | 'loss' | 'breakeven' | null};
type Props = {
  levels: Partial<Record<ProjectionField,number>>;
  prices: Record<ProjectionField|'exit',string>;
  onPrice: (field: ProjectionField|'exit', value: string) => void;
  marking: boolean;
  nextLevel?: ProjectionField;
  onMark: () => void;
  disabled: boolean;
  estimated: boolean;
  touch?: 'target'|'stop'|'ambiguous'|null;
  tradeDirection?: 'long' | 'short' | '';
  onApply: (result: Projection) => void;
};

const labels = {entry:'Entry price',stop:'Stop price',target:'Target price',exit:'Actual exit price'};

export default function JournalChartProjection({levels, prices, onPrice, marking, nextLevel, onMark, disabled, estimated, touch, tradeDirection, onApply}: Props) {
  const priceProjection = readProjection({
    entry:priceInput(prices.entry), stop:priceInput(prices.stop), target:priceInput(prices.target), exit:priceInput(prices.exit),
  });
  const chartProjection = readProjection({
    entry:-(levels.entry ?? NaN), stop:-(levels.stop ?? NaN), target:-(levels.target ?? NaN), exit:NaN,
  });
  const hasPrices = projectionFields.some(field=>prices[field].trim());
  const projection: Projection|null = hasPrices ? priceProjection : chartProjection;
  const conflict = Boolean(projection && tradeDirection && projection.direction !== tradeDirection);
  return <details className="pj-vision-projection">
    <summary>Projection &amp; trade result</summary>
    <div className="pj-vision-projection-content">
      <button className="pt-btn" type="button" disabled={disabled} aria-pressed={marking} onClick={onMark}>
        {marking?'Cancel marking':'Mark entry, stop and target on chart'}
      </button>
      {marking&&<p role="status">Tap the {nextLevel} line on the chart.</p>}
      <div className="pj-trade-fields">
        {[...projectionFields,'exit' as const].map(field=><label className="pj-field" key={field}>{labels[field]}
          <input type="number" step="any" inputMode="decimal" value={prices[field]} disabled={disabled}
            placeholder={field==='exit'?'Optional · confirmed fill':'Optional · exact value'}
            onChange={event=>onPrice(field,event.target.value)}/>
        </label>)}
      </div>
      {estimated&&<small>Prices estimated from the chart scale. Check them against the position tool before saving.</small>}
      {!estimated&&<small>{hasPrices?'Enter all three planned prices. The stop and target must be on opposite sides of entry.':
        'Chart estimates assume a linear price scale. Enter exact prices for log or percentage charts.'}</small>}
      {projection&&<p role="status"><strong>Planned R:R 1:{projection.plannedRR.toFixed(2)}</strong>
        {' · '}{projection.direction==='long'?'Buy':'Sell'}
        {projection.outcome&&<> · {projection.outcome==='breakeven'?'Break-even':projection.outcome==='win'?'Win':'Loss'} from exit price</>}
      </p>}
      {projection&&touch&&<p role="status">{touch==='ambiguous'?'Target and stop order unclear on the chart.':
        `Chart suggests ${touch==='target'?'Win · target reached first':'Loss · stop reached first'}. Confirm your fill below.`}</p>}
      {!projection&&!marking&&!hasPrices&&<small>Position drawing unclear. Mark its three lines or enter the prices.</small>}
      <small>Use your confirmed exit. A candle crossing a line can’t establish your fill. Fees and partial fills can change the result.</small>
      {conflict&&<p role="alert">The projection direction differs from this trade. Check the levels or the trade direction before applying.</p>}
      {projection&&!projection.outcome&&!conflict&&<div className="pj-vision-tags">
        <button type="button" disabled={disabled} onClick={()=>onApply({...projection,outcome:'win'})}>Confirm closed at target</button>
        <button type="button" disabled={disabled} onClick={()=>onApply({...projection,outcome:'loss'})}>Confirm closed at stop</button>
      </div>}
      <button className="pt-btn" type="button" disabled={disabled||!projection||conflict} onClick={()=>projection&&onApply(projection)}>
        {projection?.outcome?'Use R:R and outcome':'Use planned R:R'}
      </button>
    </div>
  </details>;
}
