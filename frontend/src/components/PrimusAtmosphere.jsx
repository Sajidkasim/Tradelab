import React from 'react';

/**
 * PrimusTopoField — Etched architectural glass topographic contours.
 * Layers ultra-fine contour elevations that illuminate under a pointer-tracked
 * caustic spotlight (`--hero-mx`, `--hero-my`) without adding layout weight.
 */
export function PrimusTopoField({ className = '', variant = 'hero' }) {
  return (
    <div className={`primus-topo-field is-${variant} ${className}`.trim()} aria-hidden="true">
      <svg
        viewBox="0 0 1200 680"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="primus-topo-lines" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {/* Primary ridge cluster — upper right (behind desk preview) */}
          <path d="M540 -40 C650 60 710 110 860 95 C1010 80 1130 140 1240 230" />
          <path d="M470 -30 C595 95 690 155 865 142 C1025 130 1125 190 1250 295" />
          <path d="M410 -20 C540 135 660 205 860 192 C1040 180 1135 255 1255 370" />
          <path d="M350 -10 C495 170 635 260 850 248 C1050 236 1150 325 1260 445" />
          <path d="M720 125 C805 90 935 112 975 182 C1015 252 940 318 835 304 C730 290 660 225 685 165 C696 140 706 131 720 125 Z" />
          <path d="M758 158 C820 134 906 150 932 198 C958 245 906 286 832 274 C760 262 715 216 734 176 C741 164 748 162 758 158 Z" />
          <path d="M792 186 C830 172 882 183 896 212 C910 240 878 260 834 252 C790 244 766 215 778 195 C782 189 786 188 792 186 Z" />

          {/* Secondary topographic basin — lower left (behind editorial headline) */}
          <path d="M-60 290 C85 245 205 268 310 345 C420 426 485 520 620 560 C745 596 905 560 1055 695" />
          <path d="M-70 355 C70 308 182 332 280 405 C382 480 448 565 585 612 C715 656 850 630 960 715" />
          <path d="M-75 425 C55 376 155 402 245 468 C335 535 400 612 525 660 C635 702 740 695 840 730" />
          <path d="M85 452 C152 422 238 446 276 502 C314 558 265 628 184 624 C104 620 42 562 56 502 C62 475 72 458 85 452 Z" />
          <path d="M118 486 C164 466 220 482 244 520 C268 558 232 598 180 594 C128 590 88 552 98 514 C103 496 110 490 118 486 Z" />

          {/* Cross-contour elevation sweeps */}
          <path d="M-40 165 C155 120 315 170 465 265 C625 366 775 435 975 420 C1085 412 1175 455 1245 515" />
          <path d="M-30 95 C175 62 340 115 495 210 C660 312 820 375 1020 355 C1115 346 1190 385 1255 435" />
        </g>
      </svg>
      <div className="primus-topo-sheen" />
    </div>
  );
}

/**
 * PrimusLightSeam — Razor-sharp obsidian light fissure inspired by architectural slit lighting.
 * A subtle luminous acid-lime photon sweeps gently across the split plane.
 */
export function PrimusLightSeam({ className = '' }) {
  return (
    <div className={`primus-light-seam ${className}`.trim()} aria-hidden="true">
      <span className="primus-light-seam-beam" />
      <span className="primus-light-seam-flare" />
    </div>
  );
}

/**
 * PrimusSunbeams — Volumetric diagonal daylight shafts descending across warm alabaster mist
 * (shifting to cool emerald nocturnal rays in dark mode).
 */
export function PrimusSunbeams({ className = '' }) {
  return (
    <div className={`primus-sunbeams ${className}`.trim()} aria-hidden="true">
      <span className="primus-beam primus-beam-1" />
      <span className="primus-beam primus-beam-2" />
      <span className="primus-beam primus-beam-3" />
      <span className="primus-mist-horizon" />
    </div>
  );
}

/**
 * PrimusMonolith — Sculptural matte-obsidian stone resting in subtle mist,
 * echoing the tactile monolith forms in the Primus moodboard.
 */
export function PrimusMonolith({ shape = 'ovoid', initials }) {
  return (
    <div className={`pt-monolith-stage is-${shape}`}>
      <span className="pt-monolith-ray" aria-hidden="true" />
      <div className="pt-monolith-stone" aria-hidden="true">
        <span className="pt-monolith-specular" />
      </div>
      <span className="pt-monolith-mist" aria-hidden="true" />
      <div className="pt-monogram">
        {initials}
        <span>↗</span>
      </div>
    </div>
  );
}
