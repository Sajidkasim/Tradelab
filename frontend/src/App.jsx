import React, { useCallback, useEffect, useState } from "react";
import {
  Sun,
  Moon,
  Calculator,
  Download,
  LogOut,
  Settings2,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { Button, Notice, Menu } from "./components";
import Results from "./Results";
import Trades from "./Trades";
import Import from "./Import";
import Unlock from "./Unlock";
import Tools from "./Tools";
import Backup from "./Backup";
import LabSettings from "./LabSettings";
import icon from "../../assets/primuslab-icon.svg";

const journalPages = ["results", "", "overview", "trades", "journal"];
const pageFromLocation = () =>
  location.pathname.split("/")[1] ||
  (location.hash === "#trades" ? "trades" : "results");

export default function App() {
  const [session, setSession] = useState(null),
    [meta, setMeta] = useState(null),
    [trades, setTrades] = useState([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const [page, setPage] = useState(pageFromLocation),
    [mode, setMode] = useState(
      () => localStorage.getItem("primus-theme") || "light",
    );
  const [scope, setScope] = useState("All"),
    [backup, setBackup] = useState(false),
    [labSettings, setLabSettings] = useState(false),
    [message, setMessage] = useState("");
  const toast = useCallback((text) => setMessage(text), []);
  const refresh = useCallback(async () => {
    const [metadata, rows] = await Promise.all([
      api("/metadata"),
      api("/trades"),
    ]);
    setMeta(metadata);
    setTrades(rows);
    setRevision((v) => v + 1);
  }, []);
  async function boot() {
    setError("");
    try {
      const identity = await api("/session");
      setCsrf(identity.csrf);
      setSession(identity);
      if (identity.authenticated) await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    boot();
    const clear = () => {
      setSession({ authenticated: false });
      setMeta(null);
      setTrades([]);
      setCsrf("");
      api("/session")
        .then((identity) => {
          setCsrf(identity.csrf);
          setSession(identity);
        })
        .catch((error) => setError(error.message));
    };
    window.addEventListener("primus:logout", clear);
    return () => window.removeEventListener("primus:logout", clear);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem("primus-theme", mode);
  }, [mode]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const pop = () => setPage(pageFromLocation());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const journalReady = Boolean(meta);
  useEffect(() => {
    if (page === "trades") document.getElementById("trades")?.scrollIntoView();
  }, [page, journalReady]);
  function navigate(next) {
    setPage(next);
    const section = next === "trades" ? "trades" : "results";
    history.pushState(
      {},
      "",
      journalPages.includes(next) ? `/#${section}` : `/${next}`,
    );
    requestAnimationFrame(() => {
      if (journalPages.includes(next))
        document.getElementById(section)?.scrollIntoView();
      else window.scrollTo({ top: 0 });
    });
  }
  async function logout() {
    try {
      await api("/logout", { method: "POST" });
      window.dispatchEvent(new Event("primus:logout"));
    } catch (e) {
      setError(e.message);
    }
  }
  if (!session || (session.authenticated && !meta))
    return (
      <div className="loading-screen">
        <img src={icon} alt="" />
        <h1>PrimusLab</h1>
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Button onClick={boot}>Retry</Button>
          </>
        ) : (
          <>
            <span className="spinner" />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  if (!session.authenticated)
    return <Unlock ready={Boolean(session.csrf)} onUnlocked={boot} authMode={session.auth_mode} />;
  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("results");
          }}
        >
          <img src={icon} alt="" />
          <span>PrimusLab</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a
            href="/"
            aria-current={journalPages.includes(page) ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate("results");
            }}
          >
            Strategy Lab
          </a>
        </nav>
        <Menu label="My journal" className="workspace-menu">
          <div className="menu-account">
            <strong>{session.name}</strong>
            <small>
              {session.local
                ? "Local preview · separate journal"
                : "Private workspace"}
            </small>
          </div>
          <button onClick={() => setLabSettings(true)}>
            <Settings2 size={16} /> Lab settings
          </button>
          <button onClick={() => setBackup(true)}>
            <Download size={16} /> Backup & restore
          </button>
          <button onClick={() => setMode(mode === "light" ? "dark" : "light")}>
            {mode === "light" ? <Moon size={16} /> : <Sun size={16} />}
            {mode === "light" ? "Dark mode" : "Light mode"}
          </button>
          <button onClick={() => navigate("tools")}>
            <Calculator size={16} /> Advanced tools
          </button>
          {session.can_lock && (
            <button onClick={logout}>
              <LogOut size={16} /> {session.auth_mode === "google" ? "Sign out" : "Lock journal"}
            </button>
          )}
        </Menu>
      </header>
      <div className="main-shell">
        <main className="content">
          {error && <Notice error>{error}</Notice>}
          <div hidden={!journalPages.includes(page)} className="journal-page">
            <div className="journal-intro">
              <div>
                <span className="eyebrow">PRIMUSLAB</span>
                <h1>Strategy Lab</h1>
                <p>Find the setups worth repeating.</p>
              </div>
              <nav aria-label="Journal sections">
                <a
                  href="#results"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("results");
                  }}
                >
                  Results
                </a>
                <a
                  href="#trades"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("trades");
                  }}
                >
                  Trades ↓
                </a>
              </nav>
            </div>
            <section id="results" aria-label="Results">
              <Results
                meta={meta}
                trades={trades}
                revision={revision}
                mode={mode}
                scope={scope}
                setScope={setScope}
                onTrades={() => navigate("trades")}
              />
            </section>
            <section id="trades" aria-label="Trades">
              <Trades
                meta={meta}
                trades={trades}
                refresh={refresh}
                scope={scope}
                onImport={() => navigate("import")}
                toast={toast}
              />
            </section>
          </div>
          {page === "import" && (
            <Import
              meta={meta}
              refresh={refresh}
              onBack={() => navigate("trades")}
              toast={toast}
            />
          )}
          {page === "tools" && (
            <Tools meta={meta} onResults={() => navigate("results")} />
          )}
          {![...journalPages, "import", "tools"].includes(page) && (
            <div className="card empty">
              <h1>Page not found</h1>
              <Button onClick={() => navigate("results")}>Open Results</Button>
            </div>
          )}
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      {labSettings && (
        <LabSettings
          meta={meta}
          refresh={refresh}
          toast={toast}
          onClose={() => setLabSettings(false)}
        />
      )}
      {backup && (
        <Backup
          onClose={() => setBackup(false)}
          refresh={refresh}
          toast={toast}
          count={trades.length}
        />
      )}
    </div>
  );
}
