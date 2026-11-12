import React from 'react';

export default function PrepProgress({checked, total}) {
  if (!total) return null;
  const status = `${checked} of ${total} complete`;
  return <div className="prep-progress">
    <div className="prep-progress-label" aria-hidden="true">
      <span>Prep progress</span><strong>{status}</strong>
    </div>
    <div className="prep-progress-track" role="progressbar" aria-label="Pre-session checklist progress"
      aria-valuemin={0} aria-valuenow={checked} aria-valuemax={total} aria-valuetext={status}>
      <span style={{'--checklist-progress':checked / total}}/>
    </div>
  </div>;
}
