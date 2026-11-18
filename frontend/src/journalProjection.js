// All three inputs must be in the same coordinate system. Invert chart Y before
// calling so that a larger number always represents a higher price.
export function readProjection({entry, stop, target, exit}) {
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = entry - stop, reward = target - entry;
  if (!risk || !reward || Math.sign(risk) !== Math.sign(reward)) return null;
  const multiple = Math.abs(reward / risk);
  if (!Number.isFinite(multiple) || multiple > 1000 || multiple < .01) return null;
  const move = Number.isFinite(exit) ? (exit - entry) * Math.sign(risk) : null;
  return {
    direction: risk > 0 ? 'long' : 'short',
    plannedRR: Math.round(multiple * 100) / 100,
    outcome: move === null ? null : move > 0 ? 'win' : move < 0 ? 'loss' : 'breakeven',
  };
}

export function priceInput(value) {
  if (!value.trim()) return NaN;
  const price = Number(value);
  return Number.isFinite(price) ? price : NaN;
}

export function realisedR(netPnl, originalRisk) {
  return Number.isFinite(netPnl) && Number.isFinite(originalRisk) && originalRisk > 0
    ? netPnl / originalRisk : null;
}
