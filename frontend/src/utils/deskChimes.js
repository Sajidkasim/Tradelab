const STORAGE_KEY = 'primus:floor:chimes';

let sharedCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

export function getChimesEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setChimesEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {}
}

function tone(ctx, freq, startOffset, duration, gainPeak = 0.06, type = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + startOffset;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playDeskChime(kind, enabledOverride) {
  const enabled = enabledOverride !== undefined ? enabledOverride : getChimesEnabled();
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (kind === 'join') {
      tone(ctx, 523.25, 0, 0.14, 0.045, 'sine');
      tone(ctx, 659.25, 0.11, 0.2, 0.05, 'sine');
    } else if (kind === 'share') {
      tone(ctx, 587.33, 0, 0.12, 0.045, 'triangle');
      tone(ctx, 880, 0.09, 0.18, 0.04, 'sine');
    } else if (kind === 'level') {
      tone(ctx, 740, 0, 0.11, 0.04, 'sine');
    } else if (kind === 'alert') {
      tone(ctx, 880, 0, 0.16, 0.075, 'triangle');
      tone(ctx, 659.25, 0.19, 0.16, 0.07, 'triangle');
      tone(ctx, 880, 0.38, 0.24, 0.075, 'triangle');
    }
  } catch {}
}
