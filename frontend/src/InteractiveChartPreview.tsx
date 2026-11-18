import React from 'react';

export type Finding = {
  kind: 'asset' | 'entry_timeframe' | 'direction' | 'confirmation' | 'key_level' | 'level_timeframe' | 'visible_level' | 'annotation';
  text: string;
  value: string;
  box: {x: number; y: number; width: number; height: number};
};

type Props = {
  url: string;
  findings: Finding[];
  highlight: Finding | null;
  disabled: boolean;
  anchor?: {x:number;y:number};
  projectionLevels?: Partial<Record<'entry'|'stop'|'target',number>>;
  marking: boolean;
  markingLabel?: string;
  onMark: (point:{x:number;y:number})=>void;
  onPick: (finding: Finding) => void;
};

export default function InteractiveChartPreview({url, findings, highlight, disabled, onPick, anchor, projectionLevels, marking, markingLabel, onMark}: Props) {
  return <div className="pj-vision-chart">
    <img src={url} alt="Uploaded chart with selectable annotation regions"/>
    {anchor&&<span className="pj-vision-entry" aria-label="Entry marker" style={{left:`${anchor.x*100}%`,top:`${anchor.y*100}%`}}/>}
    {Object.entries(projectionLevels||{}).map(([name,y])=><span key={name} className="pj-vision-projection-line"
      style={{top:`${y*100}%`}}><span>{name}</span></span>)}
    {marking&&<button type="button" className="pj-vision-entry-target" aria-label={markingLabel || "Mark entry point (centre with keyboard)"}
      onClick={event=>{
        if (markingLabel && !event.detail) return;
        const bounds=event.currentTarget.getBoundingClientRect();
        onMark(event.detail?{x:(event.clientX-bounds.left)/bounds.width,y:(event.clientY-bounds.top)/bounds.height}:{x:.5,y:.5});
      }}/>}
    {findings.filter(finding => ['confirmation', 'annotation', 'key_level', 'visible_level'].includes(finding.kind) &&
      (finding === highlight || finding.kind === 'confirmation' || finding.kind === 'annotation')).map((finding, index) => {
      const {x, y, width, height} = finding.box;
      const canPick = finding.kind === 'annotation' || finding.kind === 'confirmation';
      const style = {left: `${x*100}%`, top: `${y*100}%`, width: `${width*100}%`, height: `${height*100}%`};
      const active = finding === highlight;
      if (!canPick) return <span key={index} aria-hidden className="pj-vision-box is-highlighted" style={style}/>;
      return <button key={index} type="button" disabled={disabled} className={`pj-vision-box ${active ? 'is-highlighted' : ''}`}
        aria-label={`Add ${finding.text} to confirmations`} title={finding.text} style={style} onClick={()=>onPick(finding)}/>;
    })}
    {highlight && (!findings.includes(highlight) || ['asset', 'entry_timeframe', 'direction', 'level_timeframe'].includes(highlight.kind)) &&
      <span aria-hidden className="pj-vision-box is-highlighted" style={{
        left: `${highlight.box.x*100}%`, top: `${highlight.box.y*100}%`,
        width: `${highlight.box.width*100}%`, height: `${highlight.box.height*100}%`,
      }}/>}
  </div>;
}
