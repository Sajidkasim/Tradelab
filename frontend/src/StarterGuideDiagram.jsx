import React from 'react';

const diagrams = {
  chart: {
    label: 'Candlestick anatomy. The wick spans high to low. The body spans open to close.',
    drawing: <>
      <path d="M100 18v94 M100 18h42 M120 40h22 M120 88h22 M100 112h42"/>
      <rect x="80" y="40" width="40" height="48"/>
      <text x="151" y="22">High</text><text x="151" y="44">Close</text>
      <text x="151" y="92">Open</text><text x="151" y="116">Low</text>
    </>,
  },
  risk: {
    label: 'The distance from entry to stop determines planned price risk.',
    drawing: <>
      <path d="M28 35h120 M28 100h120 M85 43v49 M79 50l6-7 6 7 M79 85l6 7 6-7"/>
      <text x="158" y="39">Entry</text><text x="158" y="104">Stop</text>
      <text x="97" y="71">Stop distance</text>
    </>,
  },
  test: {
    label: 'Replay reveals one candle at a time. Future candles stay hidden.',
    drawing: <>
      <path d="M43 67v39 M79 43v45 M115 48v42 M151 22v47"/>
      <rect x="37" y="77" width="12" height="19"/><rect x="73" y="53" width="12" height="23"/>
      <rect x="109" y="59" width="12" height="17"/><rect x="145" y="33" width="12" height="23"/>
      <path d="M178 20v91" strokeDasharray="4 4"/>
      <text x="190" y="66">Future hidden</text>
    </>,
  },
  review: {
    label: 'Review sequence. Record the plan, execution and lesson.',
    drawing: <>
      <path d="M48 48h196"/>
      <circle cx="48" cy="48" r="10"/><circle cx="146" cy="48" r="10"/><circle cx="244" cy="48" r="10"/>
      <text x="48" y="83" textAnchor="middle">Plan</text>
      <text x="146" y="83" textAnchor="middle">Execution</text>
      <text x="244" y="83" textAnchor="middle">Lesson</text>
    </>,
  },
};

export default function StarterGuideDiagram({guideId}) {
  const {label, drawing} = diagrams[guideId];
  return <svg className="learn-guide-diagram" viewBox="0 0 300 130"
    role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="1.5">
    {drawing}
  </svg>;
}
