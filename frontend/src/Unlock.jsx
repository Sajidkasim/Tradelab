import React, { useState } from "react";
import {
  LockKeyhole,
  ArrowRight,
  Eye,
  EyeOff,
  MoveUpRight,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { Button, Notice } from "./components";
import compass from "../../assets/primus-compass.png";

// An abstract market illustration, never a chart of journal performance.
function MarketStudy() {
  const candles = [
    [46, 195, 262, 214, 247],
    [78, 207, 286, 239, 271],
    [110, 226, 299, 250, 282],
    [142, 202, 279, 220, 262],
    [174, 165, 249, 187, 225],
    [206, 139, 214, 163, 194],
    [238, 157, 234, 178, 218],
    [270, 172, 258, 202, 237],
    [302, 148, 232, 172, 216],
    [334, 116, 198, 144, 180],
    [366, 87, 166, 112, 151],
    [398, 104, 188, 125, 165],
    [430, 135, 211, 155, 191],
    [462, 109, 184, 133, 171],
    [494, 70, 153, 96, 139],
    [526, 49, 131, 76, 115],
    [558, 67, 151, 88, 129],
    [590, 47, 132, 72, 112],
    [622, 31, 107, 54, 90],
    [654, 53, 139, 78, 117],
  ];
  return (
    <div className="login-market" aria-hidden="true">
      <div className="login-market-label">
        <span className="login-market-dot" /> THE MARKET IS YOUR CLASSROOM
      </div>
      <svg viewBox="0 0 700 360" fill="none" focusable="false">
        <defs>
          <linearGradient
            id="entry-chart-fade"
            x1="350"
            y1="0"
            x2="350"
            y2="360"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="currentColor" stopOpacity="0.8" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <g className="login-market-grid">
          <path d="M0 60H700M0 130H700M0 200H700M0 270H700M0 340H700" />
          <path d="M78 0V360M174 0V360M270 0V360M366 0V360M462 0V360M558 0V360M654 0V360" />
        </g>
        <path className="login-market-level" d="M0 200H700" />
        <g stroke="url(#entry-chart-fade)" strokeWidth="1.5">
          {candles.map(([x, high, low, top, bottom], index) => (
            <g
              key={x}
              className={
                index % 4 === 1 ? "login-candle-hollow" : "login-candle-solid"
              }
            >
              <path d={`M${x} ${high}V${low}`} />
              <rect
                x={x - 6}
                y={top}
                width="12"
                height={bottom - top}
                rx="1.5"
              />
            </g>
          ))}
        </g>
      </svg>
      <span className="login-market-caption">
        A study in price. An illustration, not your results.
      </span>
    </div>
  );
}

export default function Unlock({ ready, onUnlocked, authMode = "password" }) {
  const google = authMode === "google";
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(new URLSearchParams(window.location.search).get("login") === "retry"
      ? "Sign-in wasn’t completed. Please try Google again." : "");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (google) {
        const result = await api("/login/google", { method: "POST" });
        window.location.assign(result.url);
        return;
      }
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
      <div className="login-shell">
        <section className="login-story" aria-labelledby="login-story-title">
          <header className="login-brand">
            <img src={compass} alt="Primus" width="116" height="116" />
            <span>THE TRADING LAB</span>
          </header>
          <div className="login-story-copy">
            <span className="login-kicker">OBSERVE. RECORD. REFINE.</span>
            <h2 id="login-story-title">
              Every trade.
              <br />A clearer direction.
            </h2>
            <p>
              A place to study your setups, understand your results and build
              your own trading edge.
            </p>
          </div>
          <MarketStudy />
          <footer className="login-story-footer">
            <span>Built around your process.</span>
            <MoveUpRight size={18} />
          </footer>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-top">
            <span>PRIMUSLAB</span>
            <LockKeyhole size={16} aria-hidden="true" />
          </div>
          <form className="login-form" onSubmit={submit}>
            <span className="login-kicker">YOUR PRIVATE WORKSPACE</span>
            <h1 id="login-title">Welcome back.</h1>
            <p>Your trades. Your research. Your next discovery.</p>
            {!google && <div className="login-password-field">
              <label htmlFor="journal-password">Journal password</label>
              <div className="login-password-control">
                <input
                  id="journal-password"
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>}
            {error && (
              <div id="login-error">
                <Notice error>{error}</Notice>
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!ready}
            >
              {google ? "Continue with Google" : "Open my journal"} <ArrowRight size={18} aria-hidden="true" />
            </Button>
            <div className="login-form-note">
              <LockKeyhole size={13} aria-hidden="true" />
              <span>{google ? "New here? Your first sign-in creates your private journal. Other members cannot see your trades." : "A quiet space for your trading research."}</span>
            </div>
          </form>
          <footer className="login-panel-footer">
            <span>Less noise. More understanding.</span>
            <a href="/privacy">Privacy</a>
          </footer>
        </section>
      </div>
    </main>
  );
}
