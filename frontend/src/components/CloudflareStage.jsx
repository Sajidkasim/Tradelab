import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Minimize2, Mic, MicOff, MonitorUp, MonitorOff,
  ZoomIn, ZoomOut, RotateCcw, Volume2, HeadphoneOff,
  Crop, Camera, Film, PictureInPicture2, Crosshair, Columns2,
  Bell, BellOff, Search, ShieldAlert,
  Settings, Headphones, X,
} from 'lucide-react';
import { api } from '../api';
import { useBullpen } from '../hooks/usePresence';
import { playDeskChime } from '../utils/deskChimes';

const ZOOM_PRESETS = [1, 1.5, 2];
const AUDIO_PREFS_KEY = 'primus_floor_audio_v1';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function loadAudioPrefs() {
  const defaults = {
    inputId: '',
    outputId: '',
    inputGain: 1,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return defaults;
    return {
      inputId: typeof raw.inputId === 'string' ? raw.inputId : '',
      outputId: typeof raw.outputId === 'string' ? raw.outputId : '',
      inputGain: Number.isFinite(Number(raw.inputGain)) ? clamp(Number(raw.inputGain), 0, 2) : 1,
      noiseSuppression: raw.noiseSuppression !== false,
      echoCancellation: raw.echoCancellation !== false,
      autoGainControl: raw.autoGainControl !== false,
    };
  } catch {
    return defaults;
  }
}

function saveAudioPrefs(prefs) {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const TRADER_COLORS = {
  Sajid: '#34d399',
  Safwaan: '#60a5fa',
  Mubeen: '#f59e0b',
  Mustafa: '#c084fc',
  Amir: '#fb7185',
};

function traderColor(name) {
  return TRADER_COLORS[name] || '#74cfbd';
}

function nyTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function getContainedVideoRect(videoEl) {
  if (!videoEl) return null;
  const rect = videoEl.getBoundingClientRect();
  const vw = videoEl.videoWidth || rect.width;
  const vh = videoEl.videoHeight || rect.height;
  if (!rect.width || !rect.height || !vw || !vh) return rect;
  const videoRatio = vw / vh;
  const boxRatio = rect.width / rect.height;
  let width = rect.width;
  let height = rect.height;
  let left = rect.left;
  let top = rect.top;
  if (videoRatio > boxRatio) {
    height = rect.width / videoRatio;
    top = rect.top + (rect.height - height) / 2;
  } else {
    width = rect.height * videoRatio;
    left = rect.left + (rect.width - width) / 2;
  }
  return { left, top, width, height };
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function RemoteAudio({ name, stream, deafened, volume = 1, outputId = '', onSpeakingChange }) {
  const audioRef = useRef(null);
  const gainNodeRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = deafened;
    el.volume = clamp(volume, 0, 1);
    el.play?.().catch(() => {});
  }, [stream, deafened, volume]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || typeof el.setSinkId !== 'function') return;
    el.setSinkId(outputId || '').catch(() => {});
  }, [outputId, stream]);

  // Speaking detector + >100% volume boost via Web Audio when needed
  useEffect(() => {
    if (!stream) return;
    let ctx;
    let raf = 0;
    let lastSpeaking = false;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frames = 0;
      const tick = () => {
        frames += 1;
        if (frames % 4 === 0) {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const avg = sum / data.length;
          const nowSpeaking = !deafened && avg > 14;
          if (nowSpeaking !== lastSpeaking) {
            lastSpeaking = nowSpeaking;
            onSpeakingChange?.(name, nowSpeaking);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
    return () => {
      cancelAnimationFrame(raf);
      if (lastSpeaking) onSpeakingChange?.(name, false);
      ctx?.close?.().catch(() => {});
    };
  }, [stream, name, deafened, onSpeakingChange]);

  // Extra boost for >100% slider (1.01 .. 1.50) using parallel gain if supported
  useEffect(() => {
    if (!stream || deafened || volume <= 1.02) {
      gainNodeRef.current?.ctx?.close?.().catch(() => {});
      gainNodeRef.current = null;
      return;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = clamp(volume - 1, 0, 0.5);
      source.connect(gain);
      gain.connect(ctx.destination);
      gainNodeRef.current = { ctx, gain };
      return () => {
        ctx.close?.().catch(() => {});
        gainNodeRef.current = null;
      };
    } catch {}
  }, [stream, deafened, volume]);

  return <audio ref={audioRef} autoPlay playsInline muted={deafened} />;
}

function DualVideoPane({ screen, onFocus, laserPoints, laserMode, isDisabled, onLaserPoint }) {
  const paneRef = useRef(null);
  const vidRef = useRef(null);
  const pointingRef = useRef(false);

  useEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    el.srcObject = screen.stream || null;
    if (screen.stream) el.play?.().catch(() => {});
  }, [screen.stream]);

  const emitLaser = (event, phase) => {
    const vRect = getContainedVideoRect(vidRef.current);
    if (!vRect || !vRect.width || !vRect.height) return;
    const x = clamp((event.clientX - vRect.left) / vRect.width, 0, 1);
    const y = clamp((event.clientY - vRect.top) / vRect.height, 0, 1);
    onLaserPoint(screen.rawName, x, y, phase);
  };

  const overlayDots = useMemo(() => {
    const el = vidRef.current;
    const pane = paneRef.current;
    if (!el || !pane || !laserPoints.length) return [];
    const pRect = pane.getBoundingClientRect();
    const vRect = getContainedVideoRect(el);
    if (!vRect || !pRect.width || !pRect.height) return [];
    return laserPoints.map((entry) => ({
      ...entry,
      px: vRect.left - pRect.left + entry.x * vRect.width,
      py: vRect.top - pRect.top + entry.y * vRect.height,
      trailPx: entry.trail.map((pt) => ({
        x: vRect.left - pRect.left + pt.x * vRect.width,
        y: vRect.top - pRect.top + pt.y * vRect.height,
      })),
    }));
  }, [laserPoints]);

  return (
    <div className="bullpen-dual-pane">
      <div className="bullpen-dual-head">
        <span>{screen.name}</span>
        <button type="button" onClick={() => onFocus(screen.key)}>Focus</button>
      </div>
      <div
        ref={paneRef}
        className={`bullpen-dual-canvas${laserMode ? ' is-laser' : ''}`}
        onPointerDown={(e) => {
          if (isDisabled || (!laserMode && !e.altKey) || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointingRef.current = true;
          emitLaser(e, 'move');
        }}
        onPointerMove={(e) => {
          if (!pointingRef.current) return;
          emitLaser(e, 'move');
        }}
        onPointerUp={(e) => {
          if (!pointingRef.current) return;
          pointingRef.current = false;
          emitLaser(e, 'end');
        }}
      >
        <video ref={vidRef} autoPlay playsInline muted className="bullpen-screen-video" />
        {overlayDots.length > 0 && (
          <svg className="bullpen-laser-svg" aria-hidden="true">
            {overlayDots.map((dot) => (
              <g key={dot.name}>
                {dot.trailPx.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={dot.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity="0.5"
                    points={dot.trailPx.map((p) => `${p.x},${p.y}`).join(' ')}
                  />
                )}
                <circle cx={dot.px} cy={dot.py} r="12" fill={dot.color} fillOpacity="0.22" />
                <circle cx={dot.px} cy={dot.py} r="5.5" fill={dot.color} stroke="#0b1013" strokeWidth="1.5" />
                <text x={dot.px + 10} y={dot.py - 8} fill="#fff" fontSize="11" fontWeight="700" className="bullpen-laser-tag">
                  {dot.name}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

export default function CloudflareStage({
  meeting,
  onJoined,
  onError,
  minimised,
  theater,
  onToggleTheater,
  ref,
  speakingMap,
  deskOverview,
  peerVolumes = {},
  onSpeakingChange,
  isDisabled = false,
  chimesOn = true,
  onToggleChimes,
}) {
  const { access, peers, laserEvent, moderationEvent, patchPresenceMeta, send } = useBullpen();
  const [status, setStatus] = useState('connecting');
  const [micOn, setMicOn] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [audioPrefs, setAudioPrefs] = useState(loadAudioPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('audio');
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] });
  const [micLevel, setMicLevel] = useState(0); // 0..100 live input meter
  const [testingMic, setTestingMic] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareQuality, setShareQuality] = useState('crisp'); // 'crisp' (4K 15fps) | 'smooth' (1080p 30fps)
  const [speaking, setSpeaking] = useState(false);
  const [localScreen, setLocalScreen] = useState(null);
  const [remoteScreens, setRemoteScreens] = useState([]); // [{key, name, rawName, stream}]
  const [remoteAudios, setRemoteAudios] = useState([]);   // [{key, name, stream}]
  const [activeKey, setActiveKey] = useState(null);
  const [dualMode, setDualMode] = useState(false);

  // 43" 4K Viewing: Zoom, Pan, Crop-to-Chart, Magnifier Loupe, Live Laser Pointer
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState(null); // {x, y, w, h} normalized 0..1
  const [cropDraft, setCropDraft] = useState(null);
  const [laserMode, setLaserMode] = useState(false);
  const [loupeOn, setLoupeOn] = useState(false);
  const [loupePos, setLoupePos] = useState(null); // {x, y} relative to viewport
  const [lasers, setLasers] = useState({}); // { [traderName]: {name, screenName, x, y, color, updatedAt, trail: [{x,y,ts}]} }
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [toast, setToast] = useState(null); // {text, link?}
  const [snapping, setSnapping] = useState(false);
  const [clipReady, setClipReady] = useState(false);

  const pcRef = useRef(null);
  const sessionIdRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const localMetaRef = useRef({ tracks: [] });
  const micStreamRef = useRef(null);       // processed (or raw) stream sent to SFU
  const rawMicStreamRef = useRef(null);    // raw getUserMedia stream for constraints/cleanup
  const micAudioCtxRef = useRef(null);     // Web Audio context for live input GainNode
  const micGainNodeRef = useRef(null);
  const previewStreamRef = useRef(null);   // local-only mic stream while testing/adjusting while muted
  const testAudioElRef = useRef(null);     // local loopback <audio> for "Test Mic"
  const settingsRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const audioPrefsRef = useRef(audioPrefs);
  audioPrefsRef.current = audioPrefs;
  const micTransceiverRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenTransceiverRef = useRef(null);
  const pulledRef = useRef(new Map());
  const midToInfoRef = useRef(new Map());
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const videoRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const dragStartRef = useRef(null);
  const cropStartRef = useRef(null);
  const laserDownRef = useRef(false);
  const lastLaserSentRef = useRef(0);
  const joinedFiredRef = useRef(false);
  const micOnRef = useRef(false);
  const deafenedRef = useRef(false);
  const pttWasMutedRef = useRef(false);
  const prevRemoteScreenCountRef = useRef(0);
  const toastTimerRef = useRef(null);

  // Rolling 15-second clip ring buffer (in-memory only, zero server cost)
  const clipRecorderRef = useRef(null);
  const clipHeaderRef = useRef(null);
  const clipChunksRef = useRef([]);
  const clipMimeRef = useRef('video/webm');

  const canSelectOutput = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';

  micOnRef.current = micOn;
  deafenedRef.current = deafened;

  const showToast = useCallback((text, link = null) => {
    setToast({ text, link });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const enqueue = useCallback((task) => {
    const next = queueRef.current.then(task, task);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  const syncPresence = useCallback((extra = {}) => {
    if (!sessionIdRef.current) return;
    patchPresenceMeta({
      sfuSessionId: sessionIdRef.current,
      tracks: localMetaRef.current.tracks,
      micOn: micOnRef.current,
      deafened: deafenedRef.current,
      sharing: Boolean(screenStreamRef.current),
      ...extra,
    });
  }, [patchPresenceMeta]);

  // Play subtle chime when a teammate starts screen sharing
  useEffect(() => {
    if (remoteScreens.length > prevRemoteScreenCountRef.current && joinedFiredRef.current) {
      playDeskChime('share', chimesOn);
    }
    prevRemoteScreenCountRef.current = remoteScreens.length;
  }, [remoteScreens.length, chimesOn]);

  // Connect RTCPeerConnection to Cloudflare Realtime SFU
  useEffect(() => {
    let cancelled = false;
    const pc = new RTCPeerConnection({
      iceServers: meeting?.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (cancelled) return;
      const mid = event.transceiver?.mid;
      const info = mid ? midToInfoRef.current.get(mid) : null;
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      const kind = info?.kind || (event.track.kind === 'video' ? 'screen' : 'audio');
      const key = info?.key || `${event.track.id}`;
      const name = info?.name || 'Teammate';

      if (kind === 'screen' || event.track.kind === 'video') {
        setRemoteScreens((prev) => {
          const rest = prev.filter((item) => item.key !== key);
          return [...rest, { key, name, rawName: name, stream }];
        });
        event.track.onended = () => {
          setRemoteScreens((prev) => prev.filter((item) => item.key !== key));
        };
      } else {
        setRemoteAudios((prev) => {
          const rest = prev.filter((item) => item.key !== key);
          return [...rest, { key, name, stream }];
        });
        event.track.onended = () => {
          setRemoteAudios((prev) => prev.filter((item) => item.key !== key));
        };
      }
    };

    pc.onconnectionstatechange = () => {
      if (cancelled) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('reconnecting');
      } else if (pc.connectionState === 'connected') {
        setStatus('live');
      }
    };

    enqueue(async () => {
      if (cancelled) return;
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const created = await api('/bullpen/sfu/sessions', {
          method: 'POST',
          body: { sessionDescription: { type: 'offer', sdp: offer.sdp } },
        });
        if (cancelled) return;
        sessionIdRef.current = created.sessionId;
        if (created.sessionDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(created.sessionDescription));
        }
        setStatus('live');
        if (!joinedFiredRef.current) {
          joinedFiredRef.current = true;
          onJoined?.();
        }
        syncPresence();
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          onError?.(err?.message || 'Could not connect to Cloudflare Realtime.');
        }
      }
    });

    return () => {
      cancelled = true;
      patchPresenceMeta({ sfuSessionId: null, tracks: [], micOn: false, sharing: false, deafened: false });
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      micAudioCtxRef.current?.close?.().catch(() => {});
      micAudioCtxRef.current = null;
      micGainNodeRef.current = null;
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      pc.close();
      pcRef.current = null;
      sessionIdRef.current = null;
      pulledRef.current.clear();
      midToInfoRef.current.clear();
    };
  }, [enqueue, meeting, onError, onJoined, patchPresenceMeta, syncPresence]);

  // Pull remote tracks announced by teammates via Supabase Presence
  useEffect(() => {
    const sid = sessionIdRef.current;
    const pc = pcRef.current;
    if (!sid || !pc || status === 'error') return;

    const wanted = new Map();
    for (const peer of peers || []) {
      if (!peer?.sfuSessionId || peer.name === access?.name) continue;
      for (const track of peer.tracks || []) {
        if (!track?.trackName) continue;
        const key = `${peer.sfuSessionId}:${track.trackName}`;
        wanted.set(key, {
          key,
          name: peer.name,
          kind: track.kind || 'audio',
          sessionId: peer.sfuSessionId,
          trackName: track.trackName,
        });
      }
    }

    const toAdd = [...wanted.values()].filter((item) => !pulledRef.current.has(item.key));
    const toRemove = [...pulledRef.current.keys()].filter((key) => !wanted.has(key));
    if (!toAdd.length && !toRemove.length) return;

    enqueue(async () => {
      const currentPc = pcRef.current;
      const currentSid = sessionIdRef.current;
      if (!currentPc || !currentSid) return;

      if (toRemove.length) {
        const mids = [];
        for (const key of toRemove) {
          const entry = pulledRef.current.get(key);
          pulledRef.current.delete(key);
          if (entry?.mid) {
            mids.push({ mid: entry.mid });
            midToInfoRef.current.delete(entry.mid);
          }
          setRemoteScreens((prev) => prev.filter((item) => item.key !== key));
          setRemoteAudios((prev) => prev.filter((item) => item.key !== key));
        }
        if (mids.length) {
          try {
            await api(`/bullpen/sfu/sessions/${currentSid}/tracks/close`, {
              method: 'PUT',
              body: { tracks: mids, force: true },
            });
          } catch {}
        }
      }

      if (toAdd.length) {
        try {
          const res = await api(`/bullpen/sfu/sessions/${currentSid}/tracks`, {
            method: 'POST',
            body: {
              tracks: toAdd.map((item) => ({
                location: 'remote',
                sessionId: item.sessionId,
                trackName: item.trackName,
              })),
            },
          });
          for (let i = 0; i < (res.tracks || []).length; i++) {
            const respTrack = res.tracks[i];
            const item = toAdd[i];
            if (respTrack?.mid && item) {
              pulledRef.current.set(item.key, { mid: respTrack.mid, name: item.name, kind: item.kind });
              midToInfoRef.current.set(respTrack.mid, { key: item.key, name: item.name, kind: item.kind });
            }
          }
          if (res.requiresImmediateRenegotiation && res.sessionDescription) {
            await currentPc.setRemoteDescription(new RTCSessionDescription(res.sessionDescription));
            const answer = await currentPc.createAnswer();
            await currentPc.setLocalDescription(answer);
            await api(`/bullpen/sfu/sessions/${currentSid}/renegotiate`, {
              method: 'PUT',
              body: { sessionDescription: { type: 'answer', sdp: answer.sdp } },
            });
          }
        } catch {}
      }
    });
  }, [access?.name, enqueue, peers, status]);

  const buildAudioConstraints = useCallback((prefs) => ({
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
    ...(prefs.inputId ? { deviceId: { ideal: prefs.inputId } } : {}),
  }), []);

  const acquireRawMic = useCallback(async (prefs) => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(prefs),
        video: false,
      });
    } catch (err) {
      // If a saved deviceId was unplugged, fall back cleanly to system default mic.
      if (prefs.inputId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
        return navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: prefs.echoCancellation,
            noiseSuppression: prefs.noiseSuppression,
            autoGainControl: prefs.autoGainControl,
          },
          video: false,
        });
      }
      throw err;
    }
  }, [buildAudioConstraints]);

  const buildProcessedMicStream = useCallback((rawStream, gainValue) => {
    micAudioCtxRef.current?.close?.().catch(() => {});
    micAudioCtxRef.current = null;
    micGainNodeRef.current = null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(rawStream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = clamp(gainValue, 0, 2);
        const dest = ctx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(dest);
        micAudioCtxRef.current = ctx;
        micGainNodeRef.current = gainNode;
        return dest.stream;
      }
    } catch {}
    return rawStream;
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === 'audioinput' && d.deviceId);
      const outputs = list.filter((d) => d.kind === 'audiooutput' && d.deviceId);
      setAudioDevices({ inputs, outputs });
    } catch {}
  }, []);

  useEffect(() => {
    void refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener('devicechange', refreshAudioDevices);
    return () => md.removeEventListener('devicechange', refreshAudioDevices);
  }, [refreshAudioDevices]);

  const activeSettingsSection = settingsSection === 'chart' && !localScreen && !remoteScreens.length ? 'audio' : settingsSection;
  const audioMenuOpen = settingsOpen && activeSettingsSection === 'audio' && !minimised;

  useEffect(() => {
    if (audioMenuOpen) void refreshAudioDevices();
  }, [audioMenuOpen, refreshAudioDevices]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (minimised) {
      setSettingsOpen(false);
      return;
    }
    const closeOutside = (event) => {
      if (!settingsRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    const closeWithEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [settingsOpen, minimised]);

  const updateAudioPrefs = useCallback((patch) => {
    setAudioPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveAudioPrefs(next);
      return next;
    });
  }, []);

  // Apply live input gain change to active GainNode
  useEffect(() => {
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = clamp(audioPrefs.inputGain, 0, 2);
    }
  }, [audioPrefs.inputGain]);

  const muteLocalMic = useCallback(() => {
    micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    rawMicStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    micOnRef.current = false;
    setMicOn(false);
    setSpeaking(false);
    onSpeakingChange?.(access?.name, false);
    syncPresence({ micOn: false });
  }, [access?.name, onSpeakingChange, syncPresence]);

  // Publish or toggle local microphone
  const setMicEnabled = useCallback(async (desired) => {
    if (isDisabled && desired) {
      showToast('Mic disabled by moderator.');
      return;
    }
    if (!desired) {
      muteLocalMic();
      return;
    }
    if (deafenedRef.current) {
      deafenedRef.current = false;
      setDeafened(false);
    }
    try {
      const existingRaw = rawMicStreamRef.current?.getAudioTracks()[0];
      const existingOut = micStreamRef.current?.getAudioTracks()[0];
      if (existingRaw && existingRaw.readyState === 'live' && existingOut && existingOut.readyState === 'live' && micTransceiverRef.current) {
        existingRaw.enabled = true;
        existingOut.enabled = true;
        if (micAudioCtxRef.current?.state === 'suspended') {
          micAudioCtxRef.current.resume().catch(() => {});
        }
        micOnRef.current = true;
        setMicOn(true);
        syncPresence({ micOn: true, deafened: false });
        return;
      }
      const prefs = audioPrefsRef.current;
      const rawStream = await acquireRawMic(prefs);
      rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current = rawStream;
      const processedStream = buildProcessedMicStream(rawStream, prefs.inputGain);
      const track = processedStream.getAudioTracks()[0];
      micStreamRef.current = processedStream;
      void refreshAudioDevices();

      await enqueue(async () => {
        const pc = pcRef.current;
        const sid = sessionIdRef.current;
        if (!pc || !sid) return;
        if (micTransceiverRef.current?.sender) {
          await micTransceiverRef.current.sender.replaceTrack(track);
          return;
        }
        const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
        micTransceiverRef.current = transceiver;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const trackName = `audio-${crypto.randomUUID().slice(0, 8)}`;
        const res = await api(`/bullpen/sfu/sessions/${sid}/tracks`, {
          method: 'POST',
          body: {
            sessionDescription: { type: 'offer', sdp: offer.sdp },
            tracks: [{ location: 'local', mid: transceiver.mid, trackName }],
          },
        });
        if (res.sessionDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(res.sessionDescription));
        }
        localMetaRef.current = {
          tracks: [
            ...localMetaRef.current.tracks.filter((t) => t.kind !== 'audio'),
            { trackName, kind: 'audio' },
          ],
        };
      });
      micOnRef.current = true;
      setMicOn(true);
      syncPresence({ micOn: true, deafened: false });
    } catch (err) {
      onError?.(err?.message || 'Microphone access was blocked. Allow microphone permission in your browser.');
    }
  }, [acquireRawMic, buildProcessedMicStream, enqueue, isDisabled, muteLocalMic, onError, refreshAudioDevices, showToast, syncPresence]);

  // Live-switch microphone device without dropping the SFU call
  const switchInputDevice = useCallback(async (deviceId) => {
    const nextPrefs = { ...audioPrefsRef.current, inputId: deviceId };
    updateAudioPrefs({ inputId: deviceId });
    if (!micTransceiverRef.current?.sender && !rawMicStreamRef.current) return;
    try {
      const wasEnabled = micOnRef.current;
      const rawStream = await acquireRawMic(nextPrefs);
      rawStream.getAudioTracks().forEach((t) => { t.enabled = wasEnabled; });
      const processedStream = buildProcessedMicStream(rawStream, nextPrefs.inputGain);
      const nextTrack = processedStream.getAudioTracks()[0];
      if (nextTrack) nextTrack.enabled = wasEnabled;
      rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current = rawStream;
      micStreamRef.current = processedStream;
      if (micTransceiverRef.current?.sender && nextTrack) {
        await micTransceiverRef.current.sender.replaceTrack(nextTrack);
      }
      showToast('Switched microphone');
    } catch (err) {
      showToast(err?.message || 'Could not switch microphone');
    }
  }, [acquireRawMic, buildProcessedMicStream, showToast, updateAudioPrefs]);

  const toggleMic = useCallback(() => {
    void setMicEnabled(!micOnRef.current);
  }, [setMicEnabled]);

  const toggleDeafen = useCallback(() => {
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafened(next);
    if (next && micOnRef.current) {
      micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      rawMicStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      micOnRef.current = false;
      setMicOn(false);
      setSpeaking(false);
      onSpeakingChange?.(access?.name, false);
    }
    syncPresence({ deafened: next, micOn: micOnRef.current });
  }, [access?.name, onSpeakingChange, syncPresence]);

  // Apply individual audio processing filters live to the active mic track
  const toggleAudioConstraint = useCallback((field, label) => {
    const prev = audioPrefsRef.current;
    const nextVal = !prev[field];
    const nextPrefs = { ...prev, [field]: nextVal };
    updateAudioPrefs({ [field]: nextVal });
    const rawTrack = rawMicStreamRef.current?.getAudioTracks()[0];
    if (rawTrack?.applyConstraints) {
      rawTrack.applyConstraints({
        noiseSuppression: nextPrefs.noiseSuppression,
        echoCancellation: nextPrefs.echoCancellation,
        autoGainControl: nextPrefs.autoGainControl,
      }).catch(() => {});
    }
    showToast(`${label} ${nextVal ? 'ON' : 'OFF'}`);
  }, [showToast, updateAudioPrefs]);

  // Auto-recover mic if mobile OS muted/ended it while backgrounded
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !micOnRef.current || isDisabled) return;
      const track = rawMicStreamRef.current?.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted) {
        const prefs = audioPrefsRef.current;
        acquireRawMic(prefs).then((fresh) => {
          rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
          rawMicStreamRef.current = fresh;
          const processed = buildProcessedMicStream(fresh, prefs.inputGain);
          const nextTrack = processed.getAudioTracks()[0];
          micStreamRef.current = processed;
          micTransceiverRef.current?.sender?.replaceTrack(nextTrack).catch(() => {});
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acquireRawMic, buildProcessedMicStream, isDisabled]);

  // Speaking level detector for local mic glow + top bar ring
  useEffect(() => {
    if (!micOn || !micStreamRef.current) {
      setSpeaking(false);
      onSpeakingChange?.(access?.name, false);
      return;
    }
    let ctx;
    let raf = 0;
    let last = false;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(micStreamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const tick = () => {
        frame += 1;
        if (frame % 4 === 0) {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const active = sum / data.length > 14;
          if (active !== last) {
            last = active;
            setSpeaking(active);
            onSpeakingChange?.(access?.name, active);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
    return () => {
      cancelAnimationFrame(raf);
      if (last) onSpeakingChange?.(access?.name, false);
      ctx?.close?.().catch(() => {});
    };
  }, [access?.name, micOn, onSpeakingChange]);

  // Live Mic Level Meter + optional "Test Mic" (Hear Yourself) loopback while Audio Settings popover is open
  useEffect(() => {
    if (!audioMenuOpen) {
      setMicLevel(0);
      setTestingMic(false);
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      if (testAudioElRef.current) {
        testAudioElRef.current.srcObject = null;
      }
      return;
    }
    let cancelled = false;
    let ctx;
    let raf = 0;
    let ownedPreview = null;

    const startMeter = async () => {
      let sourceStream = micOn && micStreamRef.current ? micStreamRef.current : null;
      if (!sourceStream && testingMic) {
        try {
          ownedPreview = await acquireRawMic(audioPrefsRef.current);
          if (cancelled) {
            ownedPreview.getTracks().forEach((t) => t.stop());
            return;
          }
          previewStreamRef.current = ownedPreview;
          sourceStream = ownedPreview;
          void refreshAudioDevices();
        } catch (err) {
          if (!cancelled) {
            setTestingMic(false);
            showToast(err?.message || 'Allow mic access to test your microphone');
          }
          return;
        }
      }
      if (!sourceStream) {
        setMicLevel(0);
        return;
      }

      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(sourceStream);
        const gainNode = ctx.createGain();
        // If using ownedPreview (unprocessed), apply current inputGain so Test Mic reflects the slider!
        gainNode.gain.value = ownedPreview ? clamp(audioPrefsRef.current.inputGain, 0, 2) : 1;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(gainNode);
        gainNode.connect(analyser);

        if (testingMic) {
          const loopDest = ctx.createMediaStreamDestination();
          gainNode.connect(loopDest);
          const el = testAudioElRef.current;
          if (el) {
            el.srcObject = loopDest.stream;
            if (typeof el.setSinkId === 'function') {
              el.setSinkId(audioPrefsRef.current.outputId || '').catch(() => {});
            }
            el.play?.().catch(() => {});
          }
        } else if (testAudioElRef.current) {
          testAudioElRef.current.srcObject = null;
        }

        const data = new Uint8Array(analyser.frequencyBinCount);
        let frame = 0;
        const tick = () => {
          if (cancelled) return;
          frame += 1;
          if (frame % 3 === 0) {
            if (ownedPreview) gainNode.gain.value = clamp(audioPrefsRef.current.inputGain, 0, 2);
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) {
              const v = Math.abs(data[i] - 128) / 128;
              if (v > peak) peak = v;
            }
            setMicLevel(Math.min(100, Math.round(peak * 145)));
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    };

    void startMeter();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ctx?.close?.().catch(() => {});
      if (ownedPreview) {
        ownedPreview.getTracks().forEach((t) => t.stop());
        if (previewStreamRef.current === ownedPreview) previewStreamRef.current = null;
      }
      if (testAudioElRef.current) {
        testAudioElRef.current.srcObject = null;
      }
    };
  }, [acquireRawMic, audioMenuOpen, audioPrefs.inputId, micOn, refreshAudioDevices, showToast, testingMic]);

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setLocalScreen(null);
    setSharing(false);
    localMetaRef.current = {
      tracks: localMetaRef.current.tracks.filter((t) => t.kind !== 'screen'),
    };
    syncPresence({ sharing: false });
    const transceiver = screenTransceiverRef.current;
    screenTransceiverRef.current = null;
    if (transceiver?.mid && sessionIdRef.current) {
      await enqueue(async () => {
        try {
          await api(`/bullpen/sfu/sessions/${sessionIdRef.current}/tracks/close`, {
            method: 'PUT',
            body: { tracks: [{ mid: transceiver.mid }], force: true },
          });
        } catch {}
      });
    }
  }, [enqueue, syncPresence]);

  // Enforce moderator actions (disable, force_mute, stop_share)
  useEffect(() => {
    if (!isDisabled) return;
    if (micOnRef.current) muteLocalMic();
    if (screenStreamRef.current) void stopScreenShare();
    setLaserMode(false);
  }, [isDisabled, muteLocalMic, stopScreenShare]);

  useEffect(() => {
    if (!moderationEvent || moderationEvent.target !== access?.name) return;
    if (moderationEvent.action === 'force_mute') {
      if (micOnRef.current) muteLocalMic();
      showToast(`Mic muted by ${moderationEvent.by}`);
    } else if (moderationEvent.action === 'stop_share') {
      if (screenStreamRef.current) void stopScreenShare();
      showToast(`Screen share stopped by ${moderationEvent.by}`);
    } else if (moderationEvent.action === 'disable') {
      if (micOnRef.current) muteLocalMic();
      if (screenStreamRef.current) void stopScreenShare();
      setLaserMode(false);
      showToast(`Disabled by moderator (${moderationEvent.by})`);
    } else if (moderationEvent.action === 'enable') {
      showToast(`Re-enabled by ${moderationEvent.by}`);
    }
  }, [access?.name, moderationEvent, muteLocalMic, showToast, stopScreenShare]);

  const applyShareQualityLive = useCallback((mode) => {
    setShareQuality(mode);
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const isCrisp = mode === 'crisp';
    if ('contentHint' in track) track.contentHint = isCrisp ? 'detail' : 'motion';
    track.applyConstraints?.({
      frameRate: { ideal: isCrisp ? 15 : 30, max: isCrisp ? 15 : 30 },
    }).catch(() => {});
    const sender = screenTransceiverRef.current?.sender;
    if (sender?.getParameters && sender?.setParameters) {
      try {
        const params = sender.getParameters();
        params.degradationPreference = isCrisp ? 'maintain-resolution' : 'balanced';
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = isCrisp ? 8_000_000 : 4_000_000;
          params.encodings[0].maxFramerate = isCrisp ? 15 : 30;
          params.encodings[0].scaleResolutionDownBy = 1;
          sender.setParameters(params).catch(() => {});
        }
      } catch {}
    }
    showToast(isCrisp ? 'Share mode: 4K Crisp Charts (15fps)' : 'Share mode: Smooth Motion (30fps)');
  }, [showToast]);

  const startScreenShare = useCallback(async () => {
    if (sharing) {
      await stopScreenShare();
      return;
    }
    if (isDisabled) {
      showToast('Screen sharing is disabled by moderator.');
      return;
    }
    const isCrisp = shareQuality === 'crisp';
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: isCrisp ? 15 : 30, max: isCrisp ? 15 : 30 },
          width: { ideal: isCrisp ? 3840 : 1920 },
          height: { ideal: isCrisp ? 2160 : 1080 },
        },
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];
      if ('contentHint' in videoTrack) {
        videoTrack.contentHint = isCrisp ? 'detail' : 'motion';
      }
      videoTrack.onended = () => { void stopScreenShare(); };
      screenStreamRef.current = stream;
      setLocalScreen(stream);
      setSharing(true);

      await enqueue(async () => {
        const pc = pcRef.current;
        const sid = sessionIdRef.current;
        if (!pc || !sid) return;
        const transceiver = pc.addTransceiver(videoTrack, {
          direction: 'sendonly',
          sendEncodings: [{
            maxBitrate: isCrisp ? 8_000_000 : 4_000_000,
            maxFramerate: isCrisp ? 15 : 30,
            scaleResolutionDownBy: 1,
          }],
        });
        // Prefer sharp screen-text codecs (VP9 / H.264) over muddy VP8 when supported.
        if (typeof transceiver.setCodecPreferences === 'function' && typeof RTCRtpSender?.getCapabilities === 'function') {
          try {
            const caps = RTCRtpSender.getCapabilities('video')?.codecs || [];
            const preferred = [
              ...caps.filter((c) => /video\/vp9/i.test(c.mimeType)),
              ...caps.filter((c) => /video\/h264/i.test(c.mimeType)),
              ...caps.filter((c) => !/video\/(vp9|h264)/i.test(c.mimeType)),
            ];
            if (preferred.length) transceiver.setCodecPreferences(preferred);
          } catch {}
        }
        // Tell WebRTC to keep full resolution crisp instead of downscaling 4K to 720p.
        if (transceiver.sender?.getParameters && transceiver.sender?.setParameters) {
          try {
            const params = transceiver.sender.getParameters();
            params.degradationPreference = isCrisp ? 'maintain-resolution' : 'balanced';
            await transceiver.sender.setParameters(params);
          } catch {}
        }
        screenTransceiverRef.current = transceiver;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const trackName = `screen-${crypto.randomUUID().slice(0, 8)}`;
        const res = await api(`/bullpen/sfu/sessions/${sid}/tracks`, {
          method: 'POST',
          body: {
            sessionDescription: { type: 'offer', sdp: offer.sdp },
            tracks: [{ location: 'local', mid: transceiver.mid, trackName }],
          },
        });
        if (res.sessionDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(res.sessionDescription));
        }
        localMetaRef.current = {
          tracks: [
            ...localMetaRef.current.tracks.filter((t) => t.kind !== 'screen'),
            { trackName, kind: 'screen' },
          ],
        };
        syncPresence({ sharing: true });
      });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        onError?.(err?.message || 'Could not start screen sharing. Check browser permissions.');
      }
    }
  }, [enqueue, isDisabled, onError, shareQuality, sharing, showToast, stopScreenShare, syncPresence]);

  // Combine remote + local screen shares for the stage
  const allScreens = useMemo(() => [
    ...remoteScreens,
    ...(localScreen ? [{
      key: 'local',
      name: `${access?.name || 'You'} (Your screen)`,
      rawName: access?.name || 'You',
      stream: localScreen,
      isLocal: true,
    }] : []),
  ], [access?.name, localScreen, remoteScreens]);

  const currentScreen = allScreens.find((s) => s.key === activeKey) || allScreens[0] || null;
  const isDual = dualMode && allScreens.length >= 2 && !minimised;

  useEffect(() => {
    if (allScreens.length < 2 && dualMode) setDualMode(false);
  }, [allScreens.length, dualMode]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = currentScreen?.stream || null;
    if (currentScreen?.stream) el.play?.().catch(() => {});
  }, [currentScreen?.stream, isDual]);

  // Reset zoom & crop when switching shared screen
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCropBox(null);
    setCropMode(false);
    setCropDraft(null);
  }, [currentScreen?.key]);

  // Rolling 15-second clip recorder (local browser memory only)
  useEffect(() => {
    clipHeaderRef.current = null;
    clipChunksRef.current = [];
    setClipReady(false);
    if (!currentScreen?.stream || typeof MediaRecorder === 'undefined') return;
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    let recorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(currentScreen.stream, { mimeType, videoBitsPerSecond: 2_500_000 })
        : new MediaRecorder(currentScreen.stream);
      clipMimeRef.current = mimeType || 'video/webm';
      recorder.ondataavailable = (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        if (!clipHeaderRef.current) {
          clipHeaderRef.current = ev.data;
        } else {
          clipChunksRef.current.push(ev.data);
          if (clipChunksRef.current.length > 15) clipChunksRef.current.shift();
        }
        setClipReady(true);
      };
      recorder.start(1000);
      clipRecorderRef.current = recorder;
    } catch {
      clipRecorderRef.current = null;
    }
    return () => {
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {}
      clipRecorderRef.current = null;
    };
  }, [currentScreen?.stream]);

  // Receive live laser pointer events & auto-fade after 2.5s
  useEffect(() => {
    if (!laserEvent) return;
    setLasers((prev) => {
      const existing = prev[laserEvent.name];
      const now = Date.now();
      const prevTrail = existing && existing.screenName === laserEvent.screenName
        ? existing.trail.filter((p) => now - p.ts < 1400)
        : [];
      const nextTrail = laserEvent.phase === 'end'
        ? prevTrail
        : [...prevTrail.slice(-24), { x: laserEvent.x, y: laserEvent.y, ts: now }];
      return {
        ...prev,
        [laserEvent.name]: {
          name: laserEvent.name,
          screenName: laserEvent.screenName,
          x: laserEvent.x,
          y: laserEvent.y,
          color: traderColor(laserEvent.name),
          updatedAt: now,
          trail: nextTrail,
        },
      };
    });
  }, [laserEvent]);

  useEffect(() => {
    if (!Object.keys(lasers).length) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setLasers((prev) => {
        let changed = false;
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.updatedAt < 2500) {
            next[k] = v;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 350);
    return () => clearInterval(timer);
  }, [lasers]);

  useEffect(() => {
    const onFs = () => {
      const element = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(Boolean(element && element === stageRef.current));
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  // Smart Magnifier Loupe render loop (60fps crisp 4K slice directly from <video>)
  useEffect(() => {
    if (!loupeOn || !loupePos || !currentScreen || isDual) return;
    let raf = 0;
    const renderLoupe = () => {
      const canvas = loupeCanvasRef.current;
      const vid = videoRef.current;
      const vp = viewportRef.current;
      if (canvas && vid && vp && vid.videoWidth > 0) {
        const ctx = canvas.getContext('2d');
        const vRect = getContainedVideoRect(vid);
        const vpRect = vp.getBoundingClientRect();
        if (ctx && vRect && vRect.width > 0) {
          const clientX = vpRect.left + loupePos.x;
          const clientY = vpRect.top + loupePos.y;
          const nx = clamp((clientX - vRect.left) / vRect.width, 0, 1);
          const ny = clamp((clientY - vRect.top) / vRect.height, 0, 1);
          const size = canvas.width;
          const mag = 2.6;
          const srcW = (size / mag) * (vid.videoWidth / vRect.width);
          const srcH = (size / mag) * (vid.videoHeight / vRect.height);
          const sx = clamp(nx * vid.videoWidth - srcW / 2, 0, Math.max(0, vid.videoWidth - srcW));
          const sy = clamp(ny * vid.videoHeight - srcH / 2, 0, Math.max(0, vid.videoHeight - srcH));
          ctx.clearRect(0, 0, size, size);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(vid, sx, sy, srcW, srcH, 0, 0, size, size);
        }
      }
      raf = requestAnimationFrame(renderLoupe);
    };
    renderLoupe();
    return () => cancelAnimationFrame(raf);
  }, [loupeOn, loupePos, currentScreen, isDual]);

  const applyZoom = useCallback((next) => {
    const clamped = clamp(Number(next.toFixed(2)), 1, 3.5);
    setZoom(clamped);
    if (clamped <= 1) setPan({ x: 0, y: 0 });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCropBox(null);
    setCropMode(false);
    setCropDraft(null);
  }, []);

  // Prop-Desk Hotkeys + Push-to-Talk (Space) + Magnifier Loupe (Hold Z)
  useEffect(() => {
    if (minimised) return;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || settingsOpen || isTypingTarget(event.target) || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space' && !event.repeat && status === 'live' && !isDisabled) {
        event.preventDefault();
        if (!micOnRef.current) {
          pttWasMutedRef.current = true;
          setPttActive(true);
          void setMicEnabled(true);
        }
        return;
      }
      if (key === 'z' && !event.repeat && currentScreen && !isDual) {
        setLoupeOn(true);
        return;
      }
      if (event.repeat) return;
      if (key === 'm' && status === 'live') {
        event.preventDefault();
        toggleMic();
      } else if (key === 'd') {
        event.preventDefault();
        toggleDeafen();
      } else if (key === 'f') {
        event.preventDefault();
        onToggleTheater?.();
      } else if (key === 'l' && currentScreen && !isDisabled) {
        event.preventDefault();
        setCropMode(false);
        setLaserMode((v) => !v);
      } else if (key === '1' && currentScreen) {
        applyZoom(1);
      } else if (key === '2' && currentScreen) {
        applyZoom(1.5);
      } else if (key === '3' && currentScreen) {
        applyZoom(2);
      } else if ((key === '0' || key === 'escape') && (zoom > 1 || cropBox || cropMode || laserMode || theater)) {
        if (cropMode) {
          setCropMode(false);
          setCropDraft(null);
        } else if (zoom > 1 || cropBox) {
          resetView();
        } else if (laserMode) {
          setLaserMode(false);
        } else if (key === 'escape' && theater) {
          onToggleTheater?.();
        }
      }
    };
    const onKeyUp = (event) => {
      if (event.code === 'Space' && pttWasMutedRef.current) {
        pttWasMutedRef.current = false;
        setPttActive(false);
        muteLocalMic();
      }
      if (event.key.toLowerCase() === 'z') {
        setLoupeOn(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    applyZoom, cropBox, cropMode, currentScreen, isDisabled, isDual, laserMode,
    minimised, muteLocalMic, onToggleTheater, resetView, setMicEnabled, settingsOpen, status,
    theater, toggleDeafen, toggleMic, zoom,
  ]);

  const sendLaserPoint = useCallback((screenName, x, y, phase = 'move') => {
    if (isDisabled) return;
    const now = performance.now();
    if (phase !== 'end' && now - lastLaserSentRef.current < 36) return;
    lastLaserSentRef.current = now;
    void send('laser', { screenName, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), phase });
  }, [isDisabled, send]);

  // Cursor-targeted scroll-wheel zoom
  const onWheel = useCallback((event) => {
    if (!currentScreen || !viewportRef.current) return;
    event.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const step = event.deltaY < 0 ? 0.25 : -0.25;
    setZoom((prevZoom) => {
      const nextZoom = clamp(Number((prevZoom + step).toFixed(2)), 1, 3.5);
      if (nextZoom <= 1) {
        setPan({ x: 0, y: 0 });
      } else {
        const ratio = nextZoom / prevZoom;
        const maxX = ((nextZoom - 1) * rect.width) / 2;
        const maxY = ((nextZoom - 1) * rect.height) / 2;
        setPan((prevPan) => ({
          x: clamp(dx - (dx - prevPan.x) * ratio, -maxX, maxX),
          y: clamp(dy - (dy - prevPan.y) * ratio, -maxY, maxY),
        }));
      }
      return nextZoom;
    });
  }, [currentScreen]);

  const emitSingleLaser = (event, phase) => {
    if (!currentScreen || !videoRef.current) return;
    const vRect = getContainedVideoRect(videoRef.current);
    if (!vRect || !vRect.width || !vRect.height) return;
    const nx = clamp((event.clientX - vRect.left) / vRect.width, 0, 1);
    const ny = clamp((event.clientY - vRect.top) / vRect.height, 0, 1);
    sendLaserPoint(currentScreen.rawName, nx, ny, phase);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();

    // Crop-to-Chart drag
    if (cropMode) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const sx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const sy = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      cropStartRef.current = { x: sx, y: sy };
      setCropDraft({ x: sx, y: sy, w: 0, h: 0 });
      return;
    }

    // Live Laser Pointer (active toggle OR Alt+drag)
    if (!isDisabled && (laserMode || event.altKey)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      laserDownRef.current = true;
      emitSingleLaser(event, 'move');
      return;
    }

    // Zoom Pan drag
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
  };

  const onPointerMove = (event) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      setLoupePos({
        x: clamp(event.clientX - rect.left, 0, rect.width),
        y: clamp(event.clientY - rect.top, 0, rect.height),
      });
    }

    if (cropStartRef.current && rect) {
      const cx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const cy = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const s = cropStartRef.current;
      setCropDraft({
        x: Math.min(s.x, cx),
        y: Math.min(s.y, cy),
        w: Math.abs(cx - s.x),
        h: Math.abs(cy - s.y),
      });
      return;
    }

    if (laserDownRef.current) {
      emitSingleLaser(event, 'move');
      return;
    }

    if (!dragging || !dragStartRef.current || !rect) return;
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    setPan({
      x: clamp(event.clientX - dragStartRef.current.x, -maxX, maxX),
      y: clamp(event.clientY - dragStartRef.current.y, -maxY, maxY),
    });
  };

  const onPointerUp = (event) => {
    if (cropStartRef.current) {
      cropStartRef.current = null;
      if (cropDraft && cropDraft.w >= 0.08 && cropDraft.h >= 0.08) {
        setCropBox(cropDraft);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setCropMode(false);
        showToast('Cropped to chart — press 0 or Reset to restore');
      }
      setCropDraft(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (laserDownRef.current) {
      laserDownRef.current = false;
      emitSingleLaser(event, 'end');
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (!dragging) return;
    setDragging(false);
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // 1-Click Snap to Daily Journal (WebP capture respecting crop)
  const snapToJournal = async () => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth || !vid.videoHeight || snapping) return;
    setSnapping(true);
    try {
      let sx = 0;
      let sy = 0;
      let sw = vid.videoWidth;
      let sh = vid.videoHeight;
      if (cropBox) {
        sx = Math.round(cropBox.x * vid.videoWidth);
        sy = Math.round(cropBox.y * vid.videoHeight);
        sw = Math.max(64, Math.round(cropBox.w * vid.videoWidth));
        sh = Math.max(64, Math.round(cropBox.h * vid.videoHeight));
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(sw, 2560);
      canvas.height = Math.round((canvas.width / sw) * sh);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (!blob) throw new Error('Could not encode snapshot.');
      const form = new FormData();
      form.append('file', blob, `trading-floor-${Date.now()}.webp`);
      try {
        await api(`/journal/${nyTodayIso()}/images`, { method: 'POST', body: form });
        showToast('Saved frame to today’s Journal', '/journal');
      } catch {
        // Fallback if R2 image storage is disabled in local/dev preview
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trading-floor-${nyTodayIso()}.webp`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Downloaded chart snapshot (.webp)');
      }
    } catch (err) {
      showToast(err?.message || 'Could not capture frame.');
    } finally {
      setSnapping(false);
    }
  };

  // Instant 15-Second Clip download from local rolling ring buffer
  const downloadClip15s = () => {
    const parts = [clipHeaderRef.current, ...clipChunksRef.current].filter(Boolean);
    if (!parts.length) {
      showToast('Buffering screen video — try again in 2 seconds');
      return;
    }
    const blob = new Blob(parts, { type: clipMimeRef.current || 'video/webm' });
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-floor-clip-${stamp}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Saved last 15s clip (.webm)');
  };

  // Picture-in-Picture Pop-Out Window
  const togglePiP = async () => {
    const vid = videoRef.current;
    if (!vid || !document.pictureInPictureEnabled) {
      showToast('Picture-in-Picture is not supported in this browser.');
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await vid.requestPictureInPicture();
      }
    } catch {
      showToast('Could not open pop-out window.');
    }
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
      return;
    }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    const vid = videoRef.current;
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (typeof req === 'function') {
      Promise.resolve(req.call(stage)).catch(() => {
        if (vid && typeof vid.webkitEnterFullscreen === 'function') {
          try { vid.webkitEnterFullscreen(); return; } catch {}
        }
        setPseudoFullscreen(true);
      });
      return;
    }
    // iPhone Safari does not support div.requestFullscreen — use native iOS video fullscreen or full-viewport overlay.
    if (vid && typeof vid.webkitEnterFullscreen === 'function') {
      try {
        vid.webkitEnterFullscreen();
        return;
      } catch {}
    }
    setPseudoFullscreen(true);
  };

  useImperativeHandle(ref, () => ({ toggleFullscreen }));

  // Compute CSS transform for single-screen video (Crop-to-Chart + Zoom + Pan)
  const cropScale = cropBox ? Math.min(6, Math.min(1 / cropBox.w, 1 / cropBox.h)) : 1;
  const cropOffsetX = cropBox ? (0.5 - (cropBox.x + cropBox.w / 2)) * 100 : 0;
  const cropOffsetY = cropBox ? (0.5 - (cropBox.y + cropBox.h / 2)) * 100 : 0;
  const totalScale = Number((zoom * cropScale).toFixed(3));
  const videoTransform = cropBox
    ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${totalScale}) translate(${cropOffsetX}%, ${cropOffsetY}%)`
    : `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  // Map active laser pointers onto current single video screen
  const activeLasersFor = (screenRawName) =>
    Object.values(lasers).filter((l) => !l.screenName || l.screenName === screenRawName);

  const singleLaserDots = useMemo(() => {
    if (!currentScreen || isDual || !videoRef.current || !viewportRef.current) return [];
    const list = Object.values(lasers).filter((l) => !l.screenName || l.screenName === currentScreen.rawName);
    if (!list.length) return [];
    const vpRect = viewportRef.current.getBoundingClientRect();
    const vRect = getContainedVideoRect(videoRef.current);
    if (!vRect || !vpRect.width || !vpRect.height) return [];
    return list.map((entry) => ({
      ...entry,
      px: vRect.left - vpRect.left + entry.x * vRect.width,
      py: vRect.top - vpRect.top + entry.y * vRect.height,
      trailPx: entry.trail.map((pt) => ({
        x: vRect.left - vpRect.left + pt.x * vRect.width,
        y: vRect.top - vpRect.top + pt.y * vRect.height,
      })),
    }));
  }, [currentScreen, isDual, lasers, zoom, pan, cropBox]);

  const loupeStyle = useMemo(() => {
    if (!loupeOn || !loupePos || !viewportRef.current) return null;
    const rect = viewportRef.current.getBoundingClientRect();
    const size = 240;
    const left = loupePos.x + 24 + size > rect.width ? Math.max(8, loupePos.x - size - 24) : loupePos.x + 24;
    const top = loupePos.y - size / 2 < 8 ? 8 : Math.min(rect.height - size - 8, loupePos.y - size / 2);
    return { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` };
  }, [loupeOn, loupePos]);

  const shareControls = (primary = false) => (
    <div className="bullpen-share-group" role="group" aria-label="Screen sharing">
      <button type="button"
        className={primary ? 'button primary' : `bullpen-bar-btn${sharing ? ' is-sharing' : ''}`}
        onClick={startScreenShare} disabled={status !== 'live' || isDisabled} aria-pressed={sharing}>
        {sharing ? <MonitorOff size={14} /> : <MonitorUp size={14} />}
        <span>{sharing ? 'Stop sharing' : 'Share screen'}</span>
      </button>
      {!minimised && <select aria-label="Screen share quality" value={shareQuality}
        onChange={(event) => applyShareQualityLive(event.target.value)}>
        <option value="crisp">4K · 15 fps</option>
        <option value="smooth">1080p · 30 fps</option>
      </select>}
    </div>
  );

  return (
    <div className={`bullpen-cf-stage${pseudoFullscreen ? ' is-pseudo-fs' : ''}`} ref={stageRef}>
      {remoteAudios.map((a) => (
        <RemoteAudio
          key={a.key}
          name={a.name}
          stream={a.stream}
          deafened={deafened}
          volume={peerVolumes[a.name] ?? 1}
          outputId={audioPrefs.outputId}
          onSpeakingChange={onSpeakingChange}
        />
      ))}
      <audio ref={testAudioElRef} autoPlay playsInline style={{ display: 'none' }} />

      {isDisabled && !minimised && (
        <div className="bullpen-mod-banner" role="alert">
          <ShieldAlert size={14} /> Moderator has disabled your mic, screen share, laser pointer, and chat.
        </div>
      )}

      {/* Slim top screen-switcher strip (outside the chart — never overlaps candles!) */}
      {!minimised && currentScreen && (
        <div className="bullpen-stage-topbar">
          <div className="bullpen-screen-strip" role="tablist" aria-label="Shared screens">
            {allScreens.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={!isDual && s.key === currentScreen.key}
                onClick={() => { setDualMode(false); setActiveKey(s.key); }}
              >
                <MonitorUp size={13} /> {s.name}
              </button>
            ))}
            {allScreens.length >= 2 && (
              <button
                type="button"
                className={isDual ? 'is-dual-active' : ''}
                onClick={() => setDualMode((v) => !v)}
                title="Show two screens side-by-side (50/50)"
              >
                <Columns2 size={13} /> 50/50 Dual
              </button>
            )}
          </div>
          <div className="bullpen-stage-hints">
            {pttActive && <span className="bullpen-hint-pill is-live">PTT LIVE</span>}
            {cropBox && <span className="bullpen-hint-pill">Cropped</span>}
            {zoom > 1 && <span className="bullpen-hint-pill">{Math.round(zoom * 100)}%</span>}
            {laserMode && <span className="bullpen-hint-pill is-accent">Laser ON</span>}
            {loupeOn && <span className="bullpen-hint-pill is-accent">2.6× Loupe</span>}
          </div>
        </div>
      )}

      {/* Main pure unobstructed stage */}
      {currentScreen ? (
        isDual ? (
          <div className="bullpen-dual-grid">
            {allScreens.slice(0, 2).map((scr) => (
              <DualVideoPane
                key={scr.key}
                screen={scr}
                laserMode={laserMode}
                isDisabled={isDisabled}
                laserPoints={activeLasersFor(scr.rawName)}
                onLaserPoint={sendLaserPoint}
                onFocus={(key) => { setActiveKey(key); setDualMode(false); }}
              />
            ))}
          </div>
        ) : (
          <div
            ref={viewportRef}
            className={`bullpen-zoom-viewport${zoom > 1 && !cropMode && !laserMode ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}${cropMode ? ' is-cropping' : ''}${laserMode ? ' is-laser' : ''}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setLoupePos(null)}
            onDoubleClick={() => {
              if (cropMode || laserMode) return;
              applyZoom(zoom > 1 ? 1 : 2);
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="bullpen-screen-video"
              style={{ transform: videoTransform }}
            />

            {/* Crop selection box while dragging */}
            {cropDraft && (
              <div
                className="bullpen-crop-rect"
                style={{
                  left: `${cropDraft.x * 100}%`,
                  top: `${cropDraft.y * 100}%`,
                  width: `${cropDraft.w * 100}%`,
                  height: `${cropDraft.h * 100}%`,
                }}
              />
            )}

            {/* Live Laser Pointer SVG overlay */}
            {singleLaserDots.length > 0 && (
              <svg className="bullpen-laser-svg" aria-hidden="true">
                {singleLaserDots.map((dot) => (
                  <g key={dot.name}>
                    {dot.trailPx.length > 1 && (
                      <polyline
                        fill="none"
                        stroke={dot.color}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeOpacity="0.55"
                        points={dot.trailPx.map((p) => `${p.x},${p.y}`).join(' ')}
                      />
                    )}
                    <circle cx={dot.px} cy={dot.py} r="14" fill={dot.color} fillOpacity="0.22" />
                    <circle cx={dot.px} cy={dot.py} r="6" fill={dot.color} stroke="#0b1013" strokeWidth="1.5" />
                    <text x={dot.px + 12} y={dot.py - 8} fill="#fff" fontSize="12" fontWeight="700" className="bullpen-laser-tag">
                      {dot.name}
                    </text>
                  </g>
                ))}
              </svg>
            )}

            {/* Smart Magnifier Loupe (Hold Z) */}
            {loupeStyle && (
              <div className="bullpen-loupe" style={loupeStyle} aria-hidden="true">
                <canvas ref={loupeCanvasRef} width={240} height={240} />
                <div className="bullpen-loupe-crosshair" />
                <span className="bullpen-loupe-badge">2.6×</span>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="bullpen-voice-floor">
          <div className="bullpen-voice-avatars">
            {(peers?.length ? peers : [{ name: access?.name || 'You' }]).map((peer) => {
              const isMe = peer.name === access?.name;
              const activeSpeak = isMe ? speaking : Boolean(speakingMap?.[peer.name]);
              return (
                <div key={peer.name} className={`bullpen-avatar-card${activeSpeak ? ' is-speaking' : ''}`}>
                  <div className="bullpen-avatar-circle">{peer.name.slice(0, 2).toUpperCase()}</div>
                  <strong>{peer.name}</strong>
                  <span>{activeSpeak ? 'Speaking' : (isMe ? deafened : peer.deafened) ? 'Deafened' : (isMe ? micOn : peer.micOn) ? 'Mic on' : 'Muted'}</span>
                </div>
              );
            })}
          </div>
          {!minimised && (
            <>
              <div className="bullpen-voice-prompt">
                {status === 'live' ? shareControls(true) : (status === 'connecting' || status === 'reconnecting') && (
                  <p role="status">{status === 'connecting' ? 'Connecting to voice…' : 'Reconnecting to voice…'}</p>
                )}
              </div>
              {deskOverview}
            </>
          )}
        </div>
      )}

      <div className="bullpen-control-bar" role="group" aria-label="Trading Floor stage controls">
        <div className="bullpen-bar-group">
          <button
            type="button"
            className={`bullpen-bar-btn${micOn ? ' is-live' : ''}`}
            onClick={toggleMic}
            disabled={status !== 'live' || isDisabled}
            aria-pressed={micOn}
            title="Toggle microphone (M) · Hold Space for push-to-talk"
          >
            {micOn ? <Mic size={14} /> : <MicOff size={14} />}
            <span>{pttActive ? 'PTT' : micOn ? 'Mute' : 'Unmute'}</span>
          </button>
          {(minimised || currentScreen || sharing) && shareControls()}
          {deafened && <button type="button" className="bullpen-bar-btn is-warn" onClick={toggleDeafen}>
            <HeadphoneOff size={14} /> Restore audio
          </button>}
        </div>
        <div className="bullpen-bar-group">
          {!minimised && toast && <span className="bullpen-bar-toast" role="status">
            {toast.text}{toast.link && <a href={toast.link}> Open ↗</a>}
          </span>}
          {(isFullscreen || pseudoFullscreen) && <button type="button" className="bullpen-bar-btn" onClick={toggleFullscreen}>
            <Minimize2 size={14} /> Exit fullscreen
          </button>}
          {!minimised && (
            <div className="bullpen-settings-anchor" ref={settingsRef}>
              <button
                type="button" ref={settingsButtonRef}
                className={`bullpen-bar-btn${settingsOpen ? ' is-accent' : ''}`}
                onClick={() => setSettingsOpen((value) => !value)}
                aria-expanded={settingsOpen}
              >
                <Settings size={14} /> Settings
              </button>
              {settingsOpen && (
                <div className="bullpen-settings-popover" role="dialog" aria-label="Trading Floor settings">
                  <div className="bullpen-audio-pop-head">
                    <strong>Trading Floor settings</strong>
                    <button type="button" className="bullpen-audio-close" aria-label="Close settings"
                      onClick={() => { setSettingsOpen(false); settingsButtonRef.current?.focus(); }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="bullpen-settings-sections" role="group" aria-label="Settings sections">
                    {[
                      ['audio', 'Audio'],
                      ...(currentScreen ? [['chart', 'Chart tools']] : []),
                      ['shortcuts', 'Shortcuts'],
                    ].map(([id, label]) => (
                      <button type="button" key={id} className="bullpen-bar-btn"
                        aria-pressed={activeSettingsSection === id}
                        onClick={() => setSettingsSection(id)}>{label}</button>
                    ))}
                  </div>
                  {activeSettingsSection === 'audio' && <>
                    <div className="bullpen-settings-tools">
                      <button type="button" className={`bullpen-bar-btn${deafened ? ' is-warn' : ''}`}
                        onClick={toggleDeafen} aria-pressed={deafened}>
                        {deafened ? <HeadphoneOff size={14} /> : <Volume2 size={14} />} Deafen
                      </button>
                      <button type="button" className="bullpen-bar-btn" onClick={onToggleChimes} aria-pressed={chimesOn}>
                        {chimesOn ? <Bell size={14} /> : <BellOff size={14} />} Desk chimes
                      </button>
                    </div>
                    <label className="bullpen-audio-field">
                      <span>Microphone</span>
                      <select
                        aria-label="Input microphone"
                        value={audioPrefs.inputId}
                        onChange={(e) => void switchInputDevice(e.target.value)}
                      >
                        <option value="">System Default</option>
                        {audioDevices.inputs.map((dev, idx) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Microphone ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>

                    {canSelectOutput && (
                      <label className="bullpen-audio-field">
                        <span><Headphones size={12} /> Speaker or headset</span>
                        <select
                          aria-label="Output speaker"
                          value={audioPrefs.outputId}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            updateAudioPrefs({ outputId: nextId });
                            if (testAudioElRef.current?.setSinkId) {
                              testAudioElRef.current.setSinkId(nextId || '').catch(() => {});
                            }
                            showToast('Switched output speaker');
                          }}
                        >
                          <option value="">System Default</option>
                          {audioDevices.outputs.map((dev, idx) => (
                            <option key={dev.deviceId} value={dev.deviceId}>
                              {dev.label || `Speaker ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div className="bullpen-audio-gain">
                      <div className="bullpen-audio-gain-head">
                        <span>Input Volume</span>
                        <strong>{Math.round(audioPrefs.inputGain * 100)}%</strong>
                      </div>
                      <input
                        type="range"
                        aria-label="Microphone input volume"
                        min="0"
                        max="200"
                        step="5"
                        value={Math.round(audioPrefs.inputGain * 100)}
                        onChange={(e) => updateAudioPrefs({ inputGain: Number(e.target.value) / 100 })}
                      />
                      <div className="bullpen-meter-wrap" aria-label="Live microphone input level">
                        <div
                          className={`bullpen-meter-fill${micLevel > 85 ? ' is-clip' : micLevel > 60 ? ' is-hot' : ''}`}
                          style={{ width: `${micLevel}%` }}
                        />
                      </div>
                      <div className="bullpen-audio-test-row">
                        <small>{micOn ? 'Live mic active' : testingMic ? 'Testing locally (muted in room)' : 'Unmute or tap Test Mic to check level'}</small>
                        <button
                          type="button"
                          className={`bullpen-bar-btn is-subtle${testingMic ? ' is-live' : ''}`}
                          onClick={() => setTestingMic((v) => !v)}
                        >
                          {testingMic ? 'Stop Test' : 'Test Mic'}
                        </button>
                      </div>
                    </div>

                    <div className="bullpen-audio-toggles" role="group" aria-label="Microphone processing">
                      <button
                        type="button"
                        className={audioPrefs.noiseSuppression ? 'is-on' : ''}
                        aria-pressed={audioPrefs.noiseSuppression}
                        onClick={() => toggleAudioConstraint('noiseSuppression', 'Noise suppression')}
                      >
                        Noise Supp.
                      </button>
                      <button
                        type="button"
                        className={audioPrefs.echoCancellation ? 'is-on' : ''}
                        aria-pressed={audioPrefs.echoCancellation}
                        onClick={() => toggleAudioConstraint('echoCancellation', 'Echo cancellation')}
                      >
                        Echo Cancel
                      </button>
                      <button
                        type="button"
                        className={audioPrefs.autoGainControl ? 'is-on' : ''}
                        aria-pressed={audioPrefs.autoGainControl}
                        onClick={() => toggleAudioConstraint('autoGainControl', 'Auto gain')}
                      >
                        Auto Gain
                      </button>
                    </div>
                  </>}
                  {settingsSection === 'chart' && currentScreen && <div className="bullpen-settings-tools">
                    <button
                      type="button"
                      className={`bullpen-bar-btn${laserMode ? ' is-accent' : ''}`}
                      onClick={() => { setCropMode(false); setLaserMode((v) => !v); setSettingsOpen(false); }}
                      disabled={isDisabled}
                      aria-pressed={laserMode}
                      title="Live Laser Pointer (L) — or hold Alt + drag anytime"
                    >
                      <Crosshair size={14} />
                      <span>Laser</span>
                    </button>

                    {!isDual && (
                      <>
                        <div className="bullpen-bar-zoom" aria-label="Zoom controls">
                          <button type="button" onClick={() => applyZoom(zoom - 0.25)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out">
                            <ZoomOut size={13} />
                          </button>
                          {ZOOM_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={Math.abs(zoom - preset) < 0.05 ? 'is-active' : ''}
                              onClick={() => applyZoom(preset)}
                            >
                              {preset}×
                            </button>
                          ))}
                          <button type="button" onClick={() => applyZoom(zoom + 0.25)} disabled={zoom >= 3.5} aria-label="Zoom in" title="Zoom in">
                            <ZoomIn size={13} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className={`bullpen-bar-btn${cropMode || cropBox ? ' is-accent' : ''}`}
                          onClick={() => {
                            setLaserMode(false);
                            setSettingsOpen(false);
                            if (cropBox && !cropMode) {
                              setCropBox(null);
                            } else {
                              setCropMode((v) => !v);
                            }
                          }}
                          aria-pressed={cropMode || Boolean(cropBox)}
                          title={cropBox ? 'Clear chart crop' : 'Crop to Chart — drag a box around just the chart'}
                        >
                          <Crop size={14} />
                          <span>{cropBox ? 'Uncrop' : cropMode ? 'Drag box…' : 'Crop'}</span>
                        </button>

                        <button
                          type="button"
                          className={`bullpen-bar-btn is-subtle${loupeOn ? ' is-accent' : ''}`}
                          onClick={() => { setLoupeOn((v) => !v); setSettingsOpen(false); }}
                          aria-pressed={loupeOn}
                          title="Smart Magnifier Loupe (or hold Z while hovering chart)"
                        >
                          <Search size={13} />
                          <span>Loupe</span>
                        </button>

                        {(zoom > 1 || cropBox) && (
                          <button type="button" className="bullpen-bar-btn is-subtle" onClick={resetView} title="Reset zoom & crop (0)">
                            <RotateCcw size={13} /> Reset view
                          </button>
                        )}
                        <button
                          type="button"
                          className="bullpen-bar-btn is-subtle"
                          onClick={snapToJournal}
                          disabled={snapping}
                          title="Snap frame straight into today’s Daily Journal"
                        >
                          <Camera size={14} />
                          <span>{snapping ? 'Saving…' : 'Snap'}</span>
                        </button>

                        <button
                          type="button"
                          className="bullpen-bar-btn is-subtle"
                          onClick={downloadClip15s}
                          disabled={!clipReady}
                          title="Download rolling last 15 seconds of shared screen (.webm)"
                        >
                          <Film size={14} />
                          <span>Clip 15s</span>
                        </button>

                        <button
                          type="button"
                          className="bullpen-bar-btn is-subtle"
                          onClick={() => { setSettingsOpen(false); togglePiP(); }}
                          title="Pop out stage into floating Picture-in-Picture window"
                        >
                          <PictureInPicture2 size={14} /> Pop out
                        </button>
                      </>
                    )}
                  </div>}
                  {settingsSection === 'shortcuts' && <dl className="bullpen-shortcut-list">
                    <dt><kbd>M</kbd></dt><dd>Toggle microphone</dd>
                    <dt><kbd>Hold Space</kbd></dt><dd>Push to talk</dd>
                    <dt><kbd>D</kbd></dt><dd>Deafen</dd>
                    <dt><kbd>F</kbd></dt><dd>Theater mode</dd>
                    <dt><kbd>L</kbd></dt><dd>Laser pointer</dd>
                    <dt><kbd>Hold Z</kbd></dt><dd>Magnifier</dd>
                    <dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>Zoom presets</dd>
                    <dt><kbd>0</kbd></dt><dd>Reset chart view</dd>
                  </dl>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
