import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { api } from '../api';
import { isAppleMobile } from '../utils/bullpenAudio';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushAlertToggle() {
  const [config, setConfig] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const isIos = useMemo(() => isAppleMobile(), []);
  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone);
  }, []);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    let alive = true;
    api('/push/config')
      .then(async (res) => {
        if (!alive) return;
        setConfig(res);
        if (!res?.enabled || !supported) return;
        try {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js');
          const existing = await reg?.pushManager?.getSubscription();
          if (alive) setSubscribed(Boolean(existing));
        } catch {}
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [supported]);

  if (!config?.enabled) return null;

  if (isIos && !isStandalone) {
    return (
      <span className="bullpen-push-hint" role="status">
        <Bell size={13} aria-hidden="true" />
        Add Primus to Home Screen in Safari to enable iPhone lock-screen alerts.
      </span>
    );
  }

  if (!supported) return null;

  async function togglePush() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      if (subscribed) {
        const existing = await reg.pushManager.getSubscription();
        const endpoint = existing?.endpoint || '';
        if (existing) await existing.unsubscribe();
        await api('/push/subscribe', { method: 'DELETE', body: { endpoint } });
        setSubscribed(false);
        setNote('Lock-screen alerts turned off.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNote('Notifications were blocked in browser settings.');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.public_key),
      });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      setSubscribed(true);
      setNote('Lock-screen alerts enabled on this device.');
    } catch (err) {
      setNote(err?.message || 'Could not update push notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const res = await api('/push/test', { method: 'POST' });
      setNote(res?.delivered ? 'Test alert sent.' : 'No active device accepted the test alert.');
    } catch (err) {
      setNote(err?.message || 'Could not send test alert.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bullpen-push-controls">
      <button
        type="button"
        className={`bullpen-push-btn${subscribed ? ' is-on' : ''}`}
        onClick={togglePush}
        disabled={busy}
        aria-pressed={subscribed}
      >
        {subscribed ? <BellRing size={14} aria-hidden="true" /> : <BellOff size={14} aria-hidden="true" />}
        <span>{busy ? 'Updating…' : subscribed ? 'Alerts ON' : 'Enable lock-screen alerts'}</span>
      </button>
      {subscribed && (
        <button type="button" className="bullpen-push-test" onClick={sendTest} disabled={busy}>
          Test
        </button>
      )}
      {note && <span className="bullpen-push-note" role="status">{note}</span>}
    </div>
  );
}
