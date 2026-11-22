import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, Mic, MicOff, MonitorUp, MonitorOff,
  ZoomIn, ZoomOut, RotateCcw, Volume2, VolumeX, Radio,
} from 'lucide-react';
import { api } from '../api';
import { useBullpen } from '../hooks/usePresence';

const ZOOM_PRESETS = [1, 1.5, 2, 3];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function RemoteAudio({ stream, deafened }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = deafened;
    el.play?.().catch(() => {});
  }, [stream, deafened]);
  return <audio ref={ref} autoPlay playsInline muted={deafened} />;
}

export default function CloudflareStage({ meeting, onJoined, onError, minimised }) {
  const { access, peers, updatePresenceMeta } = useBullpen();
  const [status, setStatus] = useState('connecting');
  const [micOn, setMicOn] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [localScreen, setLocalScreen] = useState(null);
  const [remoteScreens, setRemoteScreens] = useState([]); // [{key, name, stream}]
  const [remoteAudios, setRemoteAudios] = useState([]);   // [{key, name, stream}]
  const [activeKey, setActiveKey] = useState(null);

  // Interactive Zoom & Pan state for 32" / large monitors
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const pcRef = useRef(null);
  const sessionIdRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const localMetaRef = useRef({ tracks: [] });
  const micStreamRef = useRef(null);
  const micTransceiverRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenTransceiverRef = useRef(null);
  const pulledRef = useRef(new Map()); // trackKey -> {mid, name, kind}
  const midToInfoRef = useRef(new Map()); // mid -> {key, name, kind}
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const dragStartRef = useRef(null);
  const joinedFiredRef = useRef(false);
  const micOnRef = useRef(false);

  micOnRef.current = micOn;

  const enqueue = useCallback((task) => {
    const next = queueRef.current.then(task, task);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  const syncPresence = useCallback(() => {
    if (!sessionIdRef.current) return;
    updatePresenceMeta({
      sfuSessionId: sessionIdRef.current,
      tracks: localMetaRef.current.tracks,
    });
  }, [updatePresenceMeta]);

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
          return [...rest, { key, name, stream }];
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
        // Create initial SFU session with a recvonly audio transceiver so ICE/DTLS boots cleanly
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
      updatePresenceMeta({});
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      pc.close();
      pcRef.current = null;
      sessionIdRef.current = null;
      pulledRef.current.clear();
      midToInfoRef.current.clear();
    };
  }, [enqueue, meeting, onError, onJoined, syncPresence, updatePresenceMeta]);

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

  // Publish or toggle local microphone
  const toggleMic = useCallback(async () => {
    if (micOn) {
      micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMicOn(false);
      setSpeaking(false);
      return;
    }
    try {
      const existing = micStreamRef.current?.getAudioTracks()[0];
      if (existing && existing.readyState === 'live' && micTransceiverRef.current) {
        existing.enabled = true;
        setMicOn(true);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      micStreamRef.current = stream;

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
        syncPresence();
      });
      setMicOn(true);
    } catch (err) {
      onError?.('Microphone access was blocked. Allow microphone permission in your browser.');
    }
  }, [enqueue, micOn, onError, syncPresence]);

  // Auto-recover mic if mobile OS muted/ended it while backgrounded
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !micOnRef.current) return;
      const track = micStreamRef.current?.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted) {
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        }).then((fresh) => {
          const nextTrack = fresh.getAudioTracks()[0];
          micStreamRef.current?.getTracks().forEach((t) => t.stop());
          micStreamRef.current = fresh;
          micTransceiverRef.current?.sender?.replaceTrack(nextTrack).catch(() => {});
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Speaking level detector for local mic glow
  useEffect(() => {
    if (!micOn || !micStreamRef.current) {
      setSpeaking(false);
      return;
    }
    let ctx;
    let raf = 0;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(micStreamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setSpeaking(avg > 14);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
    return () => {
      cancelAnimationFrame(raf);
      ctx?.close?.().catch(() => {});
    };
  }, [micOn]);

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setLocalScreen(null);
    setSharing(false);
    localMetaRef.current = {
      tracks: localMetaRef.current.tracks.filter((t) => t.kind !== 'screen'),
    };
    syncPresence();
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

  const startScreenShare = useCallback(async () => {
    if (sharing) {
      await stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];
      // Prioritize razor-sharp TradingView text/candles over motion smoothing
      if ('contentHint' in videoTrack) {
        videoTrack.contentHint = 'detail';
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
          sendEncodings: [{ maxBitrate: 3_500_000, maxFramerate: 30 }],
        });
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
        syncPresence();
      });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        onError?.('Could not start screen sharing. Check browser permissions.');
      }
    }
  }, [enqueue, onError, sharing, stopScreenShare, syncPresence]);

  // Combine remote + local screen shares for the stage
  const allScreens = [
    ...remoteScreens,
    ...(localScreen ? [{ key: 'local', name: `${access?.name || 'You'} (Your screen)`, stream: localScreen, isLocal: true }] : []),
  ];
  const currentScreen = allScreens.find((s) => s.key === activeKey) || allScreens[0] || null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = currentScreen?.stream || null;
    if (currentScreen?.stream) el.play?.().catch(() => {});
  }, [currentScreen?.stream]);

  // Reset zoom when switching shared screen
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [currentScreen?.key]);

  // Fullscreen listener
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const applyZoom = useCallback((next) => {
    const clamped = clamp(Number(next.toFixed(2)), 1, 3.5);
    setZoom(clamped);
    if (clamped <= 1) setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback((event) => {
    if (!currentScreen) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.25 : -0.25;
    setZoom((z) => {
      const next = clamp(Number((z + delta).toFixed(2)), 1, 3.5);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, [currentScreen]);

  const onPointerDown = (event) => {
    if (zoom <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
  };

  const onPointerMove = (event) => {
    if (!dragging || !dragStartRef.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    setPan({
      x: clamp(event.clientX - dragStartRef.current.x, -maxX, maxX),
      y: clamp(event.clientY - dragStartRef.current.y, -maxY, maxY),
    });
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    setDragging(false);
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else stageRef.current.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="bullpen-cf-stage" ref={stageRef}>
      {remoteAudios.map((a) => (
        <RemoteAudio key={a.key} stream={a.stream} deafened={deafened} />
      ))}

      {currentScreen ? (
        <>
          {!minimised && allScreens.length > 1 && (
            <div className="bullpen-screen-tabs" role="tablist" aria-label="Shared screens">
              {allScreens.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={s.key === currentScreen.key}
                  onClick={() => setActiveKey(s.key)}
                >
                  <MonitorUp size={13} /> {s.name}
                </button>
              ))}
            </div>
          )}

          <div
            className={`bullpen-zoom-viewport${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={() => applyZoom(zoom > 1 ? 1 : 2)}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="bullpen-screen-video"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
            />
            {!minimised && (
              <div className="bullpen-screen-badge">
                <Radio size={12} /> {currentScreen.name}
                {zoom > 1 && <span> · {Math.round(zoom * 100)}% (drag to pan)</span>}
              </div>
            )}
          </div>

          {!minimised && (
            <div className="bullpen-zoom-bar" role="toolbar" aria-label="Screen zoom controls">
              <button type="button" onClick={() => applyZoom(zoom - 0.25)} disabled={zoom <= 1} aria-label="Zoom out">
                <ZoomOut size={15} />
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
              <button type="button" onClick={() => applyZoom(zoom + 0.25)} disabled={zoom >= 3.5} aria-label="Zoom in">
                <ZoomIn size={15} />
              </button>
              {zoom > 1 && (
                <button type="button" onClick={() => applyZoom(1)} aria-label="Reset zoom">
                  <RotateCcw size={14} /> Reset
                </button>
              )}
              <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="bullpen-voice-floor">
          <div className="bullpen-voice-avatars">
            {(peers?.length ? peers : [{ name: access?.name || 'You' }]).map((peer) => {
              const isMe = peer.name === access?.name;
              const activeSpeak = isMe && speaking;
              return (
                <div key={peer.name} className={`bullpen-avatar-card${activeSpeak ? ' is-speaking' : ''}`}>
                  <div className="bullpen-avatar-circle">{peer.name.slice(0, 2).toUpperCase()}</div>
                  <strong>{peer.name}</strong>
                  <span>{isMe ? (micOn ? 'Mic live' : 'Muted') : 'In room'}</span>
                </div>
              );
            })}
          </div>
          {!minimised && (
            <div className="bullpen-voice-prompt">
              <p>{status === 'connecting' ? 'Connecting to Cloudflare Realtime…' : 'Voice channel is live. Share a TradingView screen to open the chart stage.'}</p>
              <button type="button" className="button primary" onClick={startScreenShare} disabled={status !== 'live'}>
                <MonitorUp size={16} /> Share Screen
              </button>
            </div>
          )}
        </div>
      )}

      <div className="bullpen-dock" role="toolbar" aria-label="Call controls">
        <button
          type="button"
          className={`bullpen-dock-btn${micOn ? ' is-live' : ''}`}
          onClick={toggleMic}
          disabled={status !== 'live'}
          aria-pressed={micOn}
        >
          {micOn ? <Mic size={16} /> : <MicOff size={16} />}
          <span>{micOn ? 'Mute' : 'Unmute'}</span>
        </button>
        <button
          type="button"
          className={`bullpen-dock-btn${sharing ? ' is-sharing' : ''}`}
          onClick={startScreenShare}
          disabled={status !== 'live'}
          aria-pressed={sharing}
        >
          {sharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />}
          <span>{sharing ? 'Stop Share' : 'Share Screen'}</span>
        </button>
        <button
          type="button"
          className={`bullpen-dock-btn${deafened ? ' is-warn' : ''}`}
          onClick={() => setDeafened((v) => !v)}
          aria-pressed={deafened}
        >
          {deafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
          <span>{deafened ? 'Deafened' : 'Audio On'}</span>
        </button>
      </div>
    </div>
  );
}
