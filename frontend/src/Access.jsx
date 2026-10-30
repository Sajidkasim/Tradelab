import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Modal, Button, Notice } from "./components";

const dateLabel = (value) => value ? new Date(value).toLocaleString([], {
  dateStyle: "medium", timeStyle: "short",
}) : "Not recorded yet";

export default function Access({ onClose }) {
  const [people, setPeople] = useState(null), [error, setError] = useState("");
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [updated, setUpdated] = useState(null);
  const loading = useRef(false), alive = useRef(true);
  async function load() {
    if (loading.current) return;
    loading.current = true;
    setRefreshing(true);
    setError("");
    try {
      const rows = await api("/access", { cache: "no-store" });
      if (alive.current) { setPeople(rows); setUpdated(new Date()); }
    }
    catch (e) { if (alive.current) setError(e.message); }
    finally { loading.current = false; if (alive.current) setRefreshing(false); }
  }
  useEffect(() => {
    alive.current = true;
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  async function change(person) {
    setBusy(true);
    setError("");
    try {
      await api(`/access/${person.id}`, { method: "PATCH", body: { allowed: !person.allowed } });
      setPending(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Manage access" onClose={onClose}>
    <div className="stack access-list">
      <p>See who has joined PrimusLab and control who can enter. Everyone keeps their own private lab.</p>
      <small>Updates every 15 seconds while this page is visible. “Active recently” means the website was seen within two minutes; it does not prove someone is currently at their device. Times use your device clock.</small>
      <div className="access-refresh"><Button onClick={load} disabled={busy || refreshing} busy={refreshing}>Refresh list</Button><small role="status">{refreshing ? "Checking people…" : updated ? `Updated ${updated.toLocaleTimeString()}` : ""}</small></div>
      {error && <Notice error>{error}</Notice>}
      {!people && !error && <p role="status">Loading people…</p>}
      {people?.map(person => <article className="access-person" key={person.id} aria-label={person.email || "Person awaiting email"}>
        <div className="access-person-heading">
          <strong>{person.email || "Email recorded on next sign-in"}</strong>
          <span className="badge">{person.owner ? "Owner · you" : !person.allowed ? "Blocked" : person.signed_in_sessions ? "Signed in" : "Signed out"}</span>
        </div>
        <small>Last sign-in: {dateLabel(person.last_sign_in)}</small>
        <small>Last activity: {dateLabel(person.last_seen)}{person.recently_active ? " · Active recently" : ""}</small>
        <details className="access-details">
          <summary>Sign-in & device details</summary>
          <dl className="access-facts">
            <dt>Joined</dt><dd>{dateLabel(person.joined_at)}</dd>
            <dt>Signed-in sessions</dt><dd>{person.signed_in_sessions}</dd>
            <dt>Last reported device</dt><dd>{person.device || "Not recorded"} · {person.system || "Unknown"} · {person.browser || "Unknown"}</dd>
            <dt>Connection address</dt><dd>{person.client_ip || "Not recorded"}</dd>
            <dt>Location / Wi-Fi</dt><dd>Not collected. The website cannot read the Wi-Fi name or determine an exact location.</dd>
          </dl>
          <small>Device details come from the browser and can be inaccurate. The connection address may belong to a hosting proxy or VPN. Phone model and personal phone number are unavailable.</small>
          {person.sessions?.map((entry, index) => <div className="access-session" key={`${entry.started_at}-${index}`}>
            <strong>Session {index + 1} · {entry.device} · {entry.system} · {entry.browser}</strong>
            <small>Started: {dateLabel(entry.started_at)} · Last seen: {dateLabel(entry.last_seen)}</small>
            <small>Expires: {dateLabel(entry.expires_at)} · Connection: {entry.client_ip || "Not recorded"}</small>
            {entry.user_agent && <details><summary>Browser information</summary><p>{entry.user_agent}</p></details>}
          </div>)}
          {!person.sessions?.length && <small>No current signed-in sessions. Older device details become available when that person next uses the updated website.</small>}
        </details>
        {!person.owner && (pending === person.id ? <div className="stack">
          <p>{person.allowed ? "Block this person? Their signed-in sessions will end and they cannot sign in again until you unblock them. Their lab data stays saved." : "Allow this person to sign in again? They will need to sign in with Google."}</p>
          <div className="access-actions">
            <Button onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
            <Button variant={person.allowed ? "danger" : "primary"} onClick={() => change(person)} busy={busy}>
              {person.allowed ? "Confirm block" : "Confirm unblock"}
            </Button>
          </div>
        </div> : <Button onClick={() => setPending(person.id)} disabled={busy}>{person.allowed ? "Block access" : "Unblock access"}</Button>)}
      </article>)}
    </div>
  </Modal>;
}
