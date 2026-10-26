import React, { useState } from "react";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { api, setCsrf } from "./api";
import { Button, Field, Notice } from "./components";
import icon from "../../assets/primuslab-icon.svg";

export default function Unlock({ ready, onUnlocked }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/unlock", {
        method: "POST",
        body: { password },
      });
      setPassword("");
      setCsrf(result.csrf);
      await onUnlocked();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-brand">
        <img src={icon} alt="" />
        <strong>PrimusLab</strong>
      </div>
      <form className="card login-card stack" onSubmit={submit}>
        <LockKeyhole size={26} className="muted" />
        <h1>Your journal.</h1>
        <p>Enter your password to continue.</p>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            maxLength={1024}
            autoFocus
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
          Unlock journal <ArrowRight size={16} />
        </Button>
        <small>Private trading research. Just for you.</small>
      </form>
    </main>
  );
}
