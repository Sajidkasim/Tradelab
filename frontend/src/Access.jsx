import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Modal, Button, Notice } from "./components";

const dateLabel = (value) => value ? new Date(value).toLocaleString([], {
  dateStyle: "medium", timeStyle: "short",
}) : "Not recorded yet";

export default function Access({ onClose }) {
  const [people, setPeople] = useState(null), [error, setError] = useState("");
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { setPeople(await api("/access")); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);
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
      <p>See who has joined PrimusLab and control who can enter. Everyone keeps their own private journal.</p>
      <small>Signed-in sessions can last up to seven days. This is not a live online-status tracker. Times use your device clock.</small>
      <Button onClick={load} disabled={busy}>Refresh list</Button>
      {error && <Notice error>{error}</Notice>}
      {!people && !error && <p role="status">Loading accounts…</p>}
      {people?.map(person => <article className="access-person" key={person.id} aria-label={person.email || "Account awaiting email"}>
        <div className="access-person-heading">
          <strong>{person.email || "Email recorded on next sign-in"}</strong>
          <span className="badge">{person.owner ? "Owner · you" : !person.allowed ? "Blocked" : person.signed_in_sessions ? "Signed in" : "Signed out"}</span>
        </div>
        <small>Last sign-in: {dateLabel(person.last_sign_in)}</small>
        {!person.owner && (pending === person.id ? <div className="stack">
          <p>{person.allowed ? "Block this account? Their signed-in sessions will end and they cannot sign in again until you unblock them. Their journal stays saved." : "Allow this account to sign in again? They will need to sign in with Google."}</p>
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
