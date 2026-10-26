import React, { useEffect, useState } from "react";
import { UserPlus, LockKeyhole } from "lucide-react";
import { api } from "./api";
import { Button, Heading, Field, Modal, Notice, Stat } from "./components";
import { percent, rvalue, number } from "./format";

export default function Team({ session, toast }) {
  const [members, setMembers] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(false),
    [changeAccess, setChangeAccess] = useState(null);
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [shared, setShared] = useState(session.shared),
    [results, setResults] = useState(null);
  async function load() {
    try {
      const [roster, identity] = await Promise.all([
        api("/team"),
        api("/session"),
      ]);
      setMembers(roster);
      setShared(identity.shared);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/team", { method: "POST", body: { email, name } });
      await load();
      setInvite(false);
      setEmail("");
      setName("");
      toast("Invitation saved. Share the website address with your teammate.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sharing(enabled) {
    const before = shared;
    setShared(enabled);
    setBusy(true);
    setError("");
    try {
      await api("/sharing", { method: "PUT", body: { enabled } });
      setShared(enabled);
      await load();
      toast(
        enabled
          ? "Your summary results are shared with the team."
          : "Your results are private.",
      );
    } catch (e) {
      setShared(before);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function access() {
    setBusy(true);
    setError("");
    try {
      await api(`/team/${changeAccess.key}/active`, {
        method: "PATCH",
        body: { enabled: !changeAccess.active },
      });
      await load();
      setChangeAccess(null);
      toast("Team access updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function view(member) {
    setBusy(true);
    setError("");
    try {
      setResults({
        name: member.name,
        samples: await api(`/team/${member.key}/results`),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Team"
        action={
          session.owner && (
            <Button
              variant="primary"
              onClick={() => setInvite(true)}
              disabled={members.length >= 5}
            >
              <UserPlus size={17} /> Invite teammate
            </Button>
          )
        }
      >
        Each trader has a private workspace. Share results when you choose.
      </Heading>
      {error && <Notice error>{error}</Notice>}
      <div className="card sharing-card">
        <LockKeyhole size={22} />
        <div>
          <h2>
            {shared ? "Your summary is shared" : "Your journal is private"}
          </h2>
          <p>
            Sharing includes separate backtesting and forward results. Trade
            notes and screenshots remain private.
          </p>
        </div>
        <label className="switch-label">
          <input
            type="checkbox"
            aria-label="Share my summary results"
            checked={shared}
            disabled={busy}
            onChange={(e) => sharing(e.target.checked)}
          />
          <span>Share my results</span>
        </label>
      </div>
      <div className="team-grid">
        {members.map((member, i) => (
          <article className="card member-card" key={member.key}>
            <div className="member-top">
              <span className="avatar">
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <span className={`badge ${!member.active ? "pending" : ""}`}>
                {!member.active
                  ? "Access paused"
                  : member.joined
                    ? "Active"
                    : "Invited"}
              </span>
            </div>
            <h2>{member.name}</h2>
            <p>
              {member.email ||
                (member.shared ? "Shared results" : "Private workspace")}
            </p>
            <div className="member-footer">
              <span>{member.key === "owner" ? "Owner" : "Teammate"}</span>
              <div>
                {member.active && member.shared && (
                  <Button busy={busy} onClick={() => view(member)}>
                    View results
                  </Button>
                )}
                {session.owner && member.key !== "owner" && (
                  <Button onClick={() => setChangeAccess(member)}>
                    {member.active ? "Pause access" : "Reactivate"}
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="muted">
        An invitation permits Google sign-in; it does not send an email. Share
        the website address yourself.
      </p>
      {invite && (
        <Modal title="Invite a teammate" onClose={() => setInvite(false)}>
          <form onSubmit={add} className="stack">
            <Field label="Their name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                autoFocus
              />
            </Field>
            <Field label="Their Google email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </Field>
            <p className="muted">
              This Google account will be allowed to open its own private
              workspace.
            </p>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" variant="primary" busy={busy}>
              Allow this teammate
            </Button>
          </form>
        </Modal>
      )}
      {changeAccess && (
        <Modal
          title={
            changeAccess.active
              ? "Pause teammate access?"
              : "Reactivate teammate?"
          }
          onClose={() => setChangeAccess(null)}
        >
          <div className="stack">
            <p>
              {changeAccess.active
                ? `${changeAccess.name} will lose workspace access on their next request. Their trades will be kept.`
                : `${changeAccess.name} will be able to sign in again.`}
            </p>
            <Button variant="primary" busy={busy} onClick={access}>
              Confirm {changeAccess.active ? "pause" : "reactivation"}
            </Button>
            {error && <Notice error>{error}</Notice>}
          </div>
        </Modal>
      )}
      {results && (
        <Modal
          title={`${results.name} · shared results`}
          onClose={() => setResults(null)}
        >
          <div className="stack">
            {Object.entries(results.samples).map(([scope, s]) => (
              <div key={scope}>
                <h3>{scope}</h3>
                <div className="stats compact">
                  <Stat label="Win rate" value={percent(s.win_rate)} />
                  <Stat label="Average R" value={rvalue(s.avg_r)} />
                  <Stat label="Trades" value={number(s.trades)} />
                </div>
                {s.small_sample && (
                  <small className="muted">
                    Small sample · fewer than 30 trades
                  </small>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
