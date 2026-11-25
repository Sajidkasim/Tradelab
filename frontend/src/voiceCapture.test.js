import {describe, expect, it} from 'vitest';
import {formatVoiceDuration, pickVoiceMimeType, voiceExtensionForMime} from './voiceCapture';

describe('voiceCapture helpers', () => {
  it('picks opus webm on desktop browsers and falls back to audio/mp4 on iPhone Safari', () => {
    const chromeMock = {isTypeSupported: (mime) => mime === 'audio/webm;codecs=opus'};
    expect(pickVoiceMimeType(chromeMock)).toBe('audio/webm;codecs=opus');

    const safariMock = {isTypeSupported: (mime) => mime === 'audio/mp4'};
    expect(pickVoiceMimeType(safariMock)).toBe('audio/mp4');

    const unsupportedMock = {isTypeSupported: () => false};
    expect(pickVoiceMimeType(unsupportedMock)).toBe('');
  });

  it('maps MIME types to matching file extensions', () => {
    expect(voiceExtensionForMime('audio/mp4')).toBe('mp4');
    expect(voiceExtensionForMime('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(voiceExtensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(voiceExtensionForMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(voiceExtensionForMime('')).toBe('webm');
  });

  it('formats elapsed recording durations cleanly', () => {
    expect(formatVoiceDuration(0)).toBe('0:00');
    expect(formatVoiceDuration(4)).toBe('0:04');
    expect(formatVoiceDuration(65)).toBe('1:05');
    expect(formatVoiceDuration(-3)).toBe('0:00');
  });
});
