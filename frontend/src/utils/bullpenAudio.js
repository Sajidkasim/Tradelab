export function isAppleMobile(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS desktop-class Safari reports Macintosh with touch points
  return /Macintosh/i.test(ua) && Number(nav.maxTouchPoints || 0) > 1;
}

/**
 * Skip Web Audio AudioContext + GainNode processing when on iOS (where Safari
 * aggressively suspends AudioContext on backgrounding/overlays) or whenever the
 * user has not changed the input gain from 100% (1.0). Passing the raw
 * getUserMedia track directly to WebRTC eliminates extra latency and preserves
 * native hardware echo cancellation.
 */
export function shouldBypassAudioProcessing({ inputGain = 1, isIos = false } = {}) {
  if (isIos) return true;
  const numeric = Number(inputGain);
  if (!Number.isFinite(numeric)) return true;
  return Math.abs(numeric - 1) < 0.005;
}

export function isTrackUsable(track) {
  return Boolean(track && track.readyState === 'live' && !track.muted);
}

export function canInstantUnmute({ rawTrack, outTrack, hasTransceiver } = {}) {
  return Boolean(hasTransceiver && isTrackUsable(rawTrack) && isTrackUsable(outTrack));
}

export function supportsVideoPiP(videoEl = null, doc = typeof document !== 'undefined' ? document : null) {
  if (doc?.pictureInPictureEnabled) return true;
  if (videoEl && typeof videoEl.webkitSupportsPresentationMode === 'function') {
    try {
      return Boolean(videoEl.webkitSupportsPresentationMode('picture-in-picture'));
    } catch {
      return false;
    }
  }
  return false;
}

export function drawBullpenPiPCard(canvas, { count = 1, micOn = false, deafened = false, micNeedsReconnect = false } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const w = canvas.width || 320;
  const h = canvas.height || 180;

  // Deep obsidian-emerald Primus surface
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#13201b');
  bg.addColorStop(1, '#090e0c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle top acid-lime hairline
  const seam = ctx.createLinearGradient(0, 0, w, 0);
  seam.addColorStop(0, 'rgba(200,241,105,0)');
  seam.addColorStop(0.5, 'rgba(200,241,105,0.85)');
  seam.addColorStop(1, 'rgba(52,211,153,0)');
  ctx.fillStyle = seam;
  ctx.fillRect(0, 0, w, 2);

  // Live indicator dot + overline
  const dotColor = micNeedsReconnect ? '#f59e0b' : deafened ? '#fb7185' : micOn ? '#c8f169' : '#34d399';
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(28, 36, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#9bb3a5';
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('PRIMUS BULLPEN · LIVE', 42, 40);

  // Main title
  ctx.fillStyle = '#f2f5ee';
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  ctx.fillText('Trading Floor', 24, 88);

  // Status line
  const statusText = micNeedsReconnect
    ? 'Mic paused by iOS · Tap app to reconnect'
    : deafened
      ? 'Audio deafened'
      : micOn
        ? 'Mic LIVE · Audio active'
        : 'Listening (Muted)';
  ctx.fillStyle = dotColor;
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  ctx.fillText(statusText, 24, 118);

  // Roster count footer
  ctx.fillStyle = '#7f9789';
  ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${count} ${count === 1 ? 'trader' : 'traders'} on the floor`, 24, 152);
}
