import React from 'react';

export default function PrepProgress({checked, total, label="Prep progress", accessibleLabel="Pre-session checklist progress"}) {
  if (!total) return null;
  const status = `${checked} of ${total} complete`;
  return <div className="prep-progress">
    <div className="prep-progress-label" aria-hidden="true">
      <span>{label}</span><strong>{status}</strong>
    </div>
    <div className="prep-progress-track" role="progressbar" aria-label={accessibleLabel}
      aria-valuemin={0} aria-valuenow={checked} aria-valuemax={total} aria-valuetext={status}>
      <span style={{'--checklist-progress':checked / total}}/>
    </div>
  </div>;
}
