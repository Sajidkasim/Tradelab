import React, { useLayoutEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import { Button, Notice } from './components';

const steps = [
  { target: '[data-tour="explore"]', title: 'Explore a setup', text: 'Filter by strategy, level or confirmation to see the matching results.' },
  { target: '[data-tour="add-trade"]', title: 'Add a trade', text: 'Add a Backtesting or Live result and tag the setup.' },
  { target: '[data-tour="import"]', title: 'Import your trades', text: 'Upload your CSV, check the preview, then save. Duplicates are skipped.' },
  { target: '[data-tour="results"]', title: 'Read your results', text: 'Your graph, win rate and average R follow the filters you choose.' },
  { target: '.workspace-menu .menu-panel', title: 'Make the lab yours', text: 'Edit labels, clocks and import settings here, or download a backup.' },
];

export default function GuidedTour({ refresh, onClose }) {
  const [step, setStep] = useState(0), [ready, setReady] = useState(false);
  const [bounds, setBounds] = useState(null), [position, setPosition] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef(), card = useRef(), returnFocus = useRef();
  const id = useId().replaceAll(':','');
  const current = steps[step];
  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => {
      element.close();
      const menu = document.querySelector('.workspace-menu');
      if (menu) menu.open = false;
      // My lab remains available even if the initiating menu item is hidden.
      const target = returnFocus.current;
      if (target?.getClientRects().length) target.focus();
      else menu?.querySelector('summary')?.focus();
    };
  }, []);
  useLayoutEffect(() => {
    if (ready) { setBounds(null); card.current?.focus(); return; }
    let frame;
    const menu = document.querySelector('.workspace-menu');
    if (menu) menu.open = step === 4;
    const target = document.querySelector(current.target);
    const header = document.querySelector('.site-header');
    const measure = () => {
      if (!target) { setBounds(null); return; }
      const r = target.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight;
      const left = Math.max(6, r.left - 8), top = Math.max(6, r.top - 8);
      const right = Math.min(width - 6, r.right + 8), bottom = Math.min(height - 6, r.bottom + 8);
      const rect = { left, top, width: Math.max(0,right-left), height: Math.max(0,bottom-top) };
      setBounds(rect);
      const cardWidth = Math.min(300,width-24), cardHeight = card.current?.offsetHeight || 200;
      let cardLeft = left, cardTop, placement;
      if (width >= 701 && width-right >= cardWidth+28) {
        placement='right'; cardLeft=right+16; cardTop=top+(rect.height-cardHeight)/2;
      } else if (width >= 701 && left >= cardWidth+28) {
        placement='left'; cardLeft=left-cardWidth-16; cardTop=top+(rect.height-cardHeight)/2;
      } else if (bottom+16+cardHeight <= height-12) {
        placement='below'; cardTop=bottom+16;
      } else {
        placement='above'; cardTop=top-cardHeight-16;
      }
      setPosition({width:cardWidth,left:Math.max(12,Math.min(cardLeft,width-cardWidth-12)),top:Math.max(12,Math.min(cardTop,height-cardHeight-12)), '--tour-placement': placement});
    };
    if (step === 4) window.scrollTo({top:0,behavior:'instant'});
    else if (target) {
      target.scrollIntoView({block:'center',behavior:'instant'});
      const r = target.getBoundingClientRect();
      const minTop = (header?.getBoundingClientRect().bottom || 0) + 12;
      if (r.top < minTop) window.scrollBy({top:r.top-minTop,behavior:'instant'});
    }
    measure();
    frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener('resize',measure);
    window.addEventListener('scroll',measure,true);
    card.current?.focus();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize',measure); window.removeEventListener('scroll',measure,true); };
  }, [step, ready, current.target]);
  async function finish(status) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api('/tour',{method:'PUT',body:{status}});
      await refresh();
      if (status === 'completed') setReady(true);
      else onClose();
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="guided-tour" aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`} onCancel={event=>{event.preventDefault(); if(!busy) finish('skipped');}}>
    <svg className="tour-shade" aria-hidden="true" width="100%" height="100%">
      <defs><mask id={`${id}-mask`}><rect width="100%" height="100%" fill="white" />{bounds && <rect x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} rx="10" fill="black" />}</mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.26)" mask={`url(#${id}-mask)`} />
      {bounds && <rect className="tour-highlight" x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} rx="10" />}
    </svg>
    <section ref={card} className={`tour-card ${ready?'tour-ready':''}`} style={ready?undefined:position} tabIndex={-1} aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`}>
      {ready ? <>
        <CheckCircle2 className="tour-ready-icon" size={32} aria-hidden="true" />
        <h2 id={`${id}-title`}>Ready to test</h2>
        <p id={`${id}-text`}>Add a trade or import your CSV. Replay this any time from My lab → Quick guide.</p>
        <Button variant="primary" onClick={onClose}>Start testing <ArrowRight size={16} /></Button>
      </> : <>
        <div className="tour-topline"><span className="tour-step" aria-label={`Step ${step+1} of 5`}>{step+1} of 5</span><Button className="tour-skip" disabled={busy} onClick={()=>finish('skipped')}>Skip guide</Button></div>
        <h2 id={`${id}-title`}>{current.title}</h2>
        <p id={`${id}-text`}>{current.text}</p>
        {error && <Notice error>{error}</Notice>}
        <div className="tour-actions">
          {step > 0 ? <Button className="tour-back" disabled={busy} onClick={()=>{setError('');setStep(value=>value-1);}}><ArrowLeft size={14} /> Back</Button> : <span /> }
          <Button variant="primary" busy={busy} onClick={()=>step===4?finish('completed'):setStep(value=>value+1)}>{step===4?'Finish':'Next'} <ArrowRight size={15} /></Button>
        </div>
      </>}
    </section>
  </dialog>;
}
