import React, { useEffect, useRef } from 'react';

/**
 * PrimusCompass — Precision reticle compass mark.
 * Inspired by the Primus optical identity: segmented alabaster ring,
 * hairline cardinal crosshairs, and an electric acid-lime bearing needle
 * that can subtly orient toward the pointer when interactive.
 */
export default function PrimusCompass({
  size = 26,
  interactive = false,
  className = '',
  ringColor = 'currentColor',
  accentColor = '#c8f169',
  ...rest
}) {
  const svgRef = useRef(null);
  const needleRef = useRef(null);

  useEffect(() => {
    if (!interactive) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    let rafId = 0;
    let targetDeg = 45;
    let currentDeg = 45;

    const animate = () => {
      // Shortest angular distance so needle never whips across 360->0
      let delta = ((targetDeg - currentDeg + 540) % 360) - 180;
      if (Math.abs(delta) < 0.08) {
        currentDeg = targetDeg;
        if (needleRef.current) {
          needleRef.current.style.transform = `rotate(${currentDeg.toFixed(2)}deg)`;
        }
        rafId = 0;
        return;
      }
      currentDeg += delta * 0.11;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${currentDeg.toFixed(2)}deg)`;
      }
      rafId = requestAnimationFrame(animate);
    };

    const onMove = (event) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Skip expensive updates if completely offscreen
      if (rect.bottom < -120 || rect.top > window.innerHeight + 120) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const rad = Math.atan2(event.clientY - cy, event.clientX - cx);
      // 0 deg points straight up (12 o'clock), matching our vertical needle path
      targetDeg = (rad * 180) / Math.PI + 90;
      if (!rafId) rafId = requestAnimationFrame(animate);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [interactive]);

  return (
    <svg
      ref={svgRef}
      className={`pt-reticle-mark ${interactive ? 'is-interactive' : ''} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      {...rest}
    >
      {/* Hairline cardinal crosshairs extending cleanly through segmented apertures */}
      <g stroke={ringColor} strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round">
        <line x1="32" y1="3" x2="32" y2="17" />
        <line x1="32" y1="47" x2="32" y2="61" />
        <line x1="3" y1="32" x2="17" y2="32" />
        <line x1="47" y1="32" x2="61" y2="32" />
      </g>

      {/* Four crisp architectural quadrant arcs */}
      <g
        stroke={ringColor}
        strokeWidth="5.2"
        strokeLinecap="butt"
        fill="none"
      >
        {/* Top-right arc */}
        <path d="M 37.5 11.7 A 21 21 0 0 1 52.3 26.5" />
        {/* Bottom-right arc */}
        <path d="M 52.3 37.5 A 21 21 0 0 1 37.5 52.3" />
        {/* Bottom-left arc */}
        <path d="M 26.5 52.3 A 21 21 0 0 1 11.7 37.5" />
        {/* Top-left arc */}
        <path d="M 11.7 26.5 A 21 21 0 0 1 26.5 11.7" />
      </g>

      {/* Precision rotating acid-lime needle & luminous pivot dot */}
      <g
        ref={needleRef}
        className="pt-reticle-needle"
        style={{
          transformOrigin: '32px 32px',
          transform: 'rotate(45deg)',
        }}
      >
        <polygon
          points="32,12 36.2,24.8 32,22.4 27.8,24.8"
          fill={accentColor}
        />
        <circle cx="32" cy="32" r="3.4" fill={accentColor} />
      </g>
    </svg>
  );
}
