import { describe, expect, it } from 'vitest';
import {
  canInstantUnmute,
  isAppleMobile,
  isTrackUsable,
  shouldBypassAudioProcessing,
} from './utils/bullpenAudio';

describe('bullpenAudio helpers', () => {
  it('detects iPhone, iPad, and iPadOS desktop-mode Safari', () => {
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 })).toBe(false);
  });

  it('bypasses Web Audio GainNode at 100% gain or on iOS', () => {
    expect(shouldBypassAudioProcessing({ inputGain: 1, isIos: false })).toBe(true);
    expect(shouldBypassAudioProcessing({ inputGain: 1.0, isIos: false })).toBe(true);
    expect(shouldBypassAudioProcessing({ inputGain: 1.4, isIos: false })).toBe(false);
    expect(shouldBypassAudioProcessing({ inputGain: 0.6, isIos: false })).toBe(false);
    expect(shouldBypassAudioProcessing({ inputGain: 1.5, isIos: true })).toBe(true);
  });

  it('requires live, unmuted raw and output tracks plus transceiver for instant unmute', () => {
    const live = { readyState: 'live', muted: false };
    const osMuted = { readyState: 'live', muted: true };
    const ended = { readyState: 'ended', muted: false };

    expect(isTrackUsable(live)).toBe(true);
    expect(isTrackUsable(osMuted)).toBe(false);
    expect(isTrackUsable(ended)).toBe(false);

    expect(canInstantUnmute({ rawTrack: live, outTrack: live, hasTransceiver: true })).toBe(true);
    expect(canInstantUnmute({ rawTrack: osMuted, outTrack: live, hasTransceiver: true })).toBe(false);
    expect(canInstantUnmute({ rawTrack: live, outTrack: ended, hasTransceiver: true })).toBe(false);
    expect(canInstantUnmute({ rawTrack: live, outTrack: live, hasTransceiver: false })).toBe(false);
  });
});
