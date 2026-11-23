import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function SpotlightTour({
  steps,
  activeTab,
  onSelectTab,
  readyTitle = 'You’re ready',
  readyText = 'Replay this guide anytime.',
  readyCta = 'Done',
  className = '',
  onClose,
}) {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [bounds, setBounds] = useState(null);
  const [position, setPosition] = useState({});
  const dialog = useRef(null);
  const card = useRef(null);
  const returnFocus = useRef(null);
  const id = useId().replaceAll(':', '');
  const current = steps[step];
  const total = steps.length;

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
      const target = returnFocus.current;
      if (target?.getClientRects?.().length) target.focus();
    };
  }, []);

  useEffect(() => {
    if (!ready && current?.tab && onSelectTab && activeTab !== current.tab) {
      onSelectTab(current.tab);
    }
  }, [ready, current?.tab, activeTab, onSelectTab]);

  useLayoutEffect(() => {
    if (ready) {
      setBounds(null);
      card.current?.focus();
      return;
    }
    if (current?.tab && onSelectTab && activeTab !== current.tab) return;

    let frame;
    const target = current?.target ? document.querySelector(current.target) : null;
    const header = document.querySelector('.pt-header, .site-header');

    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const cardWidth = Math.min(328, width - 24);
      const cardHeight = card.current?.offsetHeight || 210;

      if (!target) {
        setBounds(null);
        setPosition({
          width: cardWidth,
          left: Math.max(12, (width - cardWidth) / 2),
          top: Math.max(12, (height - cardHeight) / 2),
        });
        return;
      }

      const r = target.getBoundingClientRect();
      const left = Math.max(6, r.left - 8);
      const top = Math.max(6, r.top - 8);
      const right = Math.min(width - 6, r.right + 8);
      const bottom = Math.min(height - 6, r.bottom + 8);
      const rect = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      setBounds(rect);

      let cardLeft = left;
      let cardTop;
      if (width >= 760 && width - right >= cardWidth + 28) {
        cardLeft = right + 16;
        cardTop = top + (rect.height - cardHeight) / 2;
      } else if (width >= 760 && left >= cardWidth + 28) {
        cardLeft = left - cardWidth - 16;
        cardTop = top + (rect.height - cardHeight) / 2;
      } else if (bottom + 16 + cardHeight <= height - 12) {
        cardLeft = left + (rect.width - cardWidth) / 2;
        cardTop = bottom + 16;
      } else if (top - cardHeight - 16 >= 12) {
        cardLeft = left + (rect.width - cardWidth) / 2;
        cardTop = top - cardHeight - 16;
      } else {
        cardLeft = width - cardWidth - 16;
        cardTop = height - cardHeight - 16;
      }

      setPosition({
        width: cardWidth,
        left: Math.max(12, Math.min(cardLeft, width - cardWidth - 12)),
        top: Math.max(12, Math.min(cardTop, height - cardHeight - 12)),
      });
    };

    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = target.getBoundingClientRect();
      const minTop = (header?.getBoundingClientRect().bottom || 0) + 14;
      if (r.top < minTop) window.scrollBy({ top: r.top - minTop, behavior: 'instant' });
    }

    measure();
    frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    card.current?.focus();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, ready, activeTab, current?.target, current?.tab, onSelectTab]);

  function finish() {
    if (onSelectTab && steps[0]?.tab) onSelectTab(steps[0].tab);
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className={`primus-tour ${className}`.trim()}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <svg className="primus-tour-shade" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id={`${id}-mask`}>
            <rect width="100%" height="100%" fill="white" />
            {bounds && (
              <rect x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} rx="12" fill="black" />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.44)" mask={`url(#${id}-mask)`} />
        {bounds && (
          <rect className="primus-tour-highlight" x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} rx="12" />
        )}
      </svg>

      <section
        ref={card}
        className={`primus-tour-card ${ready ? 'is-ready' : ''}`}
        style={ready ? undefined : position}
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
      >
        {ready ? (
          <>
            <CheckCircle2 className="primus-tour-ready-icon" size={32} aria-hidden="true" />
            <h2 id={`${id}-title`}>{readyTitle}</h2>
            <p id={`${id}-text`}>{readyText}</p>
            <button type="button" className="primus-tour-cta" onClick={finish}>
              {readyCta} <ArrowRight size={15} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <div className="primus-tour-topline">
              <span className="primus-tour-step" aria-label={`Step ${step + 1} of ${total}`}>
                {step + 1} of {total}
              </span>
              <button type="button" className="primus-tour-skip" onClick={onClose}>
                Skip guide
              </button>
            </div>
            <h2 id={`${id}-title`}>{current.title}</h2>
            <p id={`${id}-text`}>{current.text}</p>
            <div className="primus-tour-actions">
              {step > 0 ? (
                <button type="button" className="primus-tour-back" onClick={() => setStep((s) => s - 1)}>
                  <ArrowLeft size={14} aria-hidden="true" /> Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="primus-tour-cta"
                onClick={() => (step === total - 1 ? setReady(true) : setStep((s) => s + 1))}
              >
                {step === total - 1 ? 'Finish' : 'Next'} <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </section>
    </dialog>
  );
}
