/**
 * Pure Web Audio API helper for Mindset breathwork chimes and focus soundscapes.
 * Zero downloads, works offline, fails silently if audio is unavailable.
 */

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

function playTone(ctx, freq, startOffset, duration, peakGain = 0.06, type = 'sine') {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.04);
}

export function playBreathCue(phase) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (phase === 'Inhale') {
      playTone(ctx, 261.63, 0, 0.75, 0.045, 'sine');
      playTone(ctx, 329.63, 0.14, 0.85, 0.038, 'sine');
    } else if (phase === 'Hold') {
      playTone(ctx, 392.0, 0, 0.65, 0.025, 'triangle');
    } else if (phase === 'Exhale') {
      playTone(ctx, 329.63, 0, 0.75, 0.04, 'sine');
      playTone(ctx, 220.0, 0.16, 1.05, 0.042, 'sine');
    } else if (phase === 'Complete') {
      playTone(ctx, 261.63, 0, 1.4, 0.04, 'sine');
      playTone(ctx, 329.63, 0.12, 1.4, 0.035, 'sine');
      playTone(ctx, 392.0, 0.24, 1.5, 0.035, 'sine');
    }
  } catch {
    // Audio playback is best-effort only.
  }
}

export class FocusSoundscape {
  constructor() {
    this.ctx = null;
    this.nodes = [];
    this.mode = 'off';
  }

  start(mode) {
    this.stop();
    if (!mode || mode === 'off') return false;
    try {
      const Ctor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!Ctor) return false;
      const ctx = new Ctor();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(mode === 'brown' ? 0.11 : 0.045, ctx.currentTime + 0.8);
      master.connect(ctx.destination);

      if (mode === 'brown') {
        const bufferSize = ctx.sampleRate * 3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + 0.02 * white) / 1.02;
          lastOut = data[i];
          data[i] *= 3.0;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 340;

        source.connect(filter);
        filter.connect(master);
        source.start();
        this.nodes = [source, filter, master];
      } else if (mode === 'binaural') {
        // Gentle 10Hz Alpha binaural focus hum (200Hz L / 210Hz R)
        const merger = ctx.createChannelMerger(2);
        const left = ctx.createOscillator();
        const right = ctx.createOscillator();
        left.type = 'sine';
        right.type = 'sine';
        left.frequency.value = 200;
        right.frequency.value = 210;
        left.connect(merger, 0, 0);
        right.connect(merger, 0, 1);
        merger.connect(master);
        left.start();
        right.start();
        this.nodes = [left, right, merger, master];
      }
      this.mode = mode;
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop() {
    this.mode = 'off';
    for (const node of this.nodes) {
      try { node.stop?.(); } catch {}
      try { node.disconnect?.(); } catch {}
    }
    this.nodes = [];
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
    }
  }
}
