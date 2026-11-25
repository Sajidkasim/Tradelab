const PREFERRED_VOICE_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export function pickVoiceMimeType(recorderCtor = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null) {
  if (!recorderCtor || typeof recorderCtor.isTypeSupported !== 'function') return '';
  for (const mime of PREFERRED_VOICE_MIMES) {
    try {
      if (recorderCtor.isTypeSupported(mime)) return mime;
    } catch {
      // Ignore browser-specific errors from isTypeSupported.
    }
  }
  return '';
}

export function voiceExtensionForMime(mime) {
  const lower = String(mime || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'mp4';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}

export function createVoiceRecorder(stream) {
  const mimeType = pickVoiceMimeType();
  if (mimeType) {
    try {
      return new MediaRecorder(stream, {mimeType});
    } catch {
      // Fall back to browser default container.
    }
  }
  return new MediaRecorder(stream);
}

export function formatVoiceDuration(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}
