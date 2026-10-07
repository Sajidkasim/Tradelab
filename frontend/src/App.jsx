import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Users,
  Sun,
  Moon,
  ArrowUpRight,
  Download,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { Button, Notice } from "./components";
import Results from "./Results";
import Trades from "./Trades";
import Import from "./Import";
import Team from "./Team";
import Backup from "./Backup";
import icon from "../../assets/primuslab-icon.svg";

const pages = [
  { id: "results", name: "Results", icon: Activity },
  { id: "trades", name: "Trades", icon: BookOpen },
  { id: "team", name: "Team", icon: Users },
];
export default function App() {
  const [session, setSession] = useState(null),
    [meta, setMeta] = useState(null),
    [trades, setTrades] = useState([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const [page, setPage] = useState(
      location.pathname.split("/")[1] || "results",
    ),
    [mode, setMode] = useState(
      () => localStorage.getItem("primus-theme") || "light",
    );
  const [backup, setBackup] = useState(false),
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
    const pop = () => setPage(location.pathname.split("/")[1] || "results");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(next) {
    setPage(next);
    history.pushState({}, "", next === "results" ? "/" : `/${next}`);
    window.scrollTo({ top: 0 });
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
    return (
      <main className="login">
        <div className="login-brand">
          <img src={icon} alt="" />
          <strong>PrimusLab</strong>
        </div>
        <div className="card login-card">
          <span className="eyebrow">LESS NOISE. MORE EVIDENCE.</span>
          <h1>Find your edge.</h1>
          <p>
            A private home for your trading research. Log the setup, review the
            outcome, see what works.
          </p>
          {location.search.includes("login=denied") && (
            <Notice error>
              Sign-in could not be completed. Use your invited Google account or
              ask the workspace owner for access.
            </Notice>
          )}
          <a className="button primary" href="/auth/google">
            Continue with Google <ArrowUpRight size={18} />
          </a>
          <small>Only the owner and invited teammates can enter.</small>
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("results");
          }}
        >
          <img src={icon} alt="" />
          <span>PrimusLab</span>
        </a>
        <div className="workspace">
          <span className="avatar">
            {session.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div>
            <strong>{session.name}</strong>
            <small>Private workspace</small>
          </div>
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {pages.map((item) => (
            <a
              key={item.id}
              href={item.id === "results" ? "/" : `/${item.id}`}
              aria-current={
                page === item.id || (page === "import" && item.id === "trades")
                  ? "page"
                  : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                navigate(item.id);
              }}
            >
              <item.icon size={18} />
              {item.name}
              {item.id === "trades" &&
                trades.filter((t) => t.needs_tagging).length > 0 && (
                  <span className="nav-count">
                    {trades.filter((t) => t.needs_tagging).length}
                  </span>
                )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setBackup(true)}>
            <Download size={17} /> Backup & restore
          </button>
          <details className="more-tools">
            <summary>
              More tools <ChevronDown size={14} />
            </summary>
            <p>
              Advanced risk, backtesting and broker tools remain available in
              the current PrimusLab site while this interface is prepared for
              launch.
            </p>
            <a
              href="https://primuslab.streamlit.app/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open current site <ArrowUpRight size={14} />
            </a>
          </details>
          <button onClick={() => setMode(mode === "light" ? "dark" : "light")}>
            {mode === "light" ? <Moon size={17} /> : <Sun size={17} />}
            {mode === "light" ? "Dark mode" : "Light mode"}
          </button>
          {!session.local && (
            <button onClick={logout}>
              <LogOut size={17} /> Sign out
            </button>
          )}
          <small>PrimusLab · Your trading research</small>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <span>
            Workspace <span>/</span>{" "}
            {page === "import"
              ? "Trades / Import"
              : pages.find((p) => p.id === page)?.name || "Results"}
          </span>
          <span className="topbar-status">
            <span className="dot" />
            {session.local ? "Local preview" : "Private & connected"}
          </span>
        </div>
        <main className="content">
          {error && <Notice error>{error}</Notice>}
          <div hidden={!["results", "", "overview"].includes(page)}>
            <Results
              meta={meta}
              trades={trades}
              revision={revision}
              mode={mode}
              onTrades={() => navigate("trades")}
            />
          </div>
          <div hidden={page !== "trades"}>
            <Trades
              meta={meta}
              trades={trades}
              refresh={refresh}
              onImport={() => navigate("import")}
              toast={toast}
            />
          </div>
          {page === "import" && (
            <Import
              meta={meta}
              refresh={refresh}
              onBack={() => navigate("trades")}
              toast={toast}
            />
          )}
          {page === "team" && <Team session={session} toast={toast} />}
          {!["results", "", "overview", "trades", "import", "team"].includes(
            page,
          ) && (
            <div className="card empty">
              <h1>Page not found</h1>
              <Button onClick={() => navigate("results")}>Open Results</Button>
            </div>
          )}
        </main>
        <footer className="page-footer">
          Evidence over instinct.
          <span>All times shown in New York unless stated.</span>
        </footer>
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
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
