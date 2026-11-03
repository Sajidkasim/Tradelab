import React,{useEffect,useState} from 'react';
import {Button} from './components';
export function breathingPhase(seconds){const at=seconds%10;return {label:at<4?'Breathe in gently':'Breathe out gently',remaining:at<4?4-at:10-at,inhale:at<4}}
export default function BreathingExercise(){
 const [seconds,setSeconds]=useState(0),[state,setState]=useState('stopped');const phase=breathingPhase(seconds);
 useEffect(()=>{if(state!=='running')return;const timer=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(timer)},[state]);
 return <section className="wp-panel wp-breathing" aria-label="Breathing exercise"><div><span className="pt-overline">A MOMENT AWAY FROM THE CHART</span><h2>Take a steady breath.</h2><p>An optional, silent exercise: four seconds in, six seconds out. Breathe comfortably and stop whenever you wish.</p><div className="settings-actions"><Button onClick={()=>setState('running')} disabled={state==='running'}>{state==='paused'?'Resume':'Start'}</Button><Button onClick={()=>setState('paused')} disabled={state!=='running'}>Pause</Button><Button onClick={()=>{setState('stopped');setSeconds(0)}} disabled={state==='stopped'}>Stop</Button></div><p className="wp-breath-status" role="status">{state==='stopped'?'Ready when you are':state==='paused'?'Paused':phase.label}</p></div><div className={`wp-breath-orb ${state==='running'&&phase.inhale?'inhale':''}`} aria-hidden="true"><strong>{state==='running'?phase.remaining:state==='paused'?'Ⅱ':'○'}</strong><span>{state==='running'?'seconds':'at your pace'}</span></div></section>;
}
