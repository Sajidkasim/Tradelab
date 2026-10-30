import React, { useCallback, useEffect, useState } from "react";
import {
  Sun,
  Moon,
  Download,
  LogOut,
  Settings2,
  Users,
  ArrowDown,
  HelpCircle,
} from "lucide-react";
import { api, setCsrf } from "./api";
import { Button, Notice, Menu } from "./components";
import { JournalClock } from "./JournalClock";
import GuidedTour from "./GuidedTour";
import Welcome from "./Welcome";
import Results from "./Results";
import Trades from "./Trades";
import Import from "./Import";
import Unlock from "./Unlock";
import Backup from "./Backup";
import LabSettings from "./LabSettings";
import Access from "./Access";
import icon from "../../assets/primuslab-icon.svg";
import { labHref, journalPage } from "./paths";
import { AppearanceContext, AppearanceSwitch } from "./Appearance";
import { sitePreview, PrimusHeader } from './SiteExperience';

const journalPages = ["results", "", "overview", "trades", "journal"];
const pageFromLocation = () => journalPage(location.pathname, location.hash);

export default function App() {
  const [appearance, setAppearance] = useState(() =>
    localStorage.getItem("primus-appearance") === "classic"
      ? "classic"
      : "modern",
  );
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
    [access, setAccess] = useState(false),
    [message, setMessage] = useState("");
  const [importSettingsRequested, setImportSettingsRequested] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (meta?.journal_preferences?.tour_status === "pending" && !meta.journal_preferences.welcome_pending) {
      setPage("results");
      setTourOpen(true);
    }
  }, [meta?.journal_preferences?.tour_status, meta?.journal_preferences?.welcome_pending]);
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
      setTourOpen(false);
      setImportSettingsRequested(false);
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
    document.documentElement.dataset.theme =
      appearance === "classic" ? "light" : mode;
    document.documentElement.dataset.appearance = appearance;
    localStorage.setItem("primus-theme", mode);
    localStorage.setItem("primus-appearance", appearance);
  }, [mode, appearance]);
  useEffect(() => {
    if (!session?.authenticated || session.auth_mode !== "google") return;
    const report = () => {
      if (document.visibilityState === "visible")
        api("/activity", { method: "POST" }).catch(() => {});
    };
    report();
    const timer = setInterval(report, 60000);
    document.addEventListener("visibilitychange", report);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", report);
    };
  }, [session?.authenticated, session?.auth_mode]);
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
      journalPages.includes(next) ? `${labHref()}#${section}` : labHref(next),
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
  const workspaceMenu = session && (
            <Menu label="My lab" className="workspace-menu">
              <div className="menu-account">
                <strong>{session.local ? "My lab" : session.name}</strong>
                <small>
                  {session.local
                    ? "Local preview · separate lab"
                    : "Private workspace"}
                </small>
              </div>
              {sitePreview() && <div className="pt-lab-appearance"><span>LAB APPEARANCE</span><AppearanceSwitch value={appearance} onChange={setAppearance}/></div>}
              <button onClick={() => setLabSettings(true)}>
                <Settings2 size={16} /> Lab settings
              </button>
              <button onClick={() => {
                setImportSettingsRequested(true);
                if (page !== "import") navigate("import");
              }}>
                <Settings2 size={16} /> Import settings
              </button>
              <button onClick={() => { navigate("results"); setTourOpen(true); }}>
                <HelpCircle size={16} /> Quick guide
              </button>
              <button onClick={() => setBackup(true)}>
                <Download size={16} /> Backup & restore
              </button>
              {session.owner && session.auth_mode === "google" && (
                <button onClick={() => setAccess(true)}>
                  <Users size={16} /> Manage access
                </button>
              )}
              <button
                onClick={() => {
                  setAppearance("modern");
                  setMode(mode === "light" ? "dark" : "light");
                }}
              >
                {mode === "light" ? <Moon size={16} /> : <Sun size={16} />}
                {mode === "light" ? "Dark mode" : "Light mode"}
              </button>
              {session.can_lock && (
                <button onClick={logout}>
                  <LogOut size={16} />{" "}
                  {session.auth_mode === "google" ? "Sign out" : "Lock lab"}
                </button>
              )}
            </Menu>
  );
  useEffect(() => {
    if (!sitePreview()) return;
    document.documentElement.dataset.siteLab = 'true';
    document.title = 'Strategy Lab — PrimusTrader';
    return () => { delete document.documentElement.dataset.siteLab; };
  }, []);
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
      <Unlock
        appearance={appearance}
        onAppearanceChange={setAppearance}
        ready={Boolean(session.csrf)}
        onUnlocked={boot}
        authMode={session.auth_mode}
      />
    );
  return (
    <AppearanceContext.Provider value={appearance}>
      <JournalClock.Provider
        value={meta.journal_preferences?.timezone || "America/New_York"}
      >
        <div className={`app-shell ${sitePreview() ? "pt-lab" : ""}`}>
          {sitePreview() ? <PrimusHeader active="lab" actions={workspaceMenu}/> : <header className="site-header">
            <a
              href={labHref()}
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
              {sitePreview() && <><a href="/">Home</a><a href="/journal">Journal</a></>}
              <a
                href={labHref()}
                aria-current={journalPages.includes(page) ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate("results");
                }}
              >
                Strategy Lab
              </a>
            </nav>
            <AppearanceSwitch value={appearance} onChange={setAppearance} />
            {workspaceMenu}
          </header>}
          {appearance === "classic" && (
            <nav className="classic-nav" aria-label="Classic navigation">
              <strong>RESEARCH DESK</strong>
              <button onClick={() => navigate("results")}>Results</button>
              <button onClick={() => navigate("trades")}>Trades</button>
              <button onClick={() => navigate("import")}>Import</button>
              <button onClick={() => setLabSettings(true)}>Lab settings</button>
              <span>PRIVATE STRATEGY TESTER · CLASSIC EDITION</span>
            </nav>
          )}
          <div className="main-shell">
            <main className="content">
              {session.local && (
                <div className="preview-notice">
                  {sitePreview() ? "Local concept preview · sample data · not published" : "Local preview · data on this Mac"}
                </div>
              )}
              {error && <Notice error>{error}</Notice>}
              <div
                hidden={!journalPages.includes(page)}
                className={`journal-page ${sitePreview() ? "pt-lab-page" : ""}`}
              >
                <div className="journal-intro">
                  <div>
                    <span className="eyebrow">{sitePreview() ? "THE RESEARCH PROCESS" : "PRIMUSLAB"}</span>
                    <h1>{sitePreview() ? <>Strategy <em>Lab.</em></> : "Strategy Lab"}</h1>
                    <p>Find the setups worth repeating.</p>
                  </div>
                </div>
                <div className="research-toolbar">
                  <Button
                    variant="primary"
                    className="jump-to-trades"
                    onClick={() => navigate("trades")}
                  >
                    Go to trades <ArrowDown size={16} aria-hidden="true" />
                  </Button>
                </div>
                <section id="results" aria-label="Results">
                  <Results
                    meta={meta}
                    trades={trades}
                    revision={revision}
                    mode={appearance === "classic" ? "light" : mode}
                    scope={scope}
                    setScope={setScope}
                    refresh={refresh}
                    toast={toast}
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
                  settingsRequested={importSettingsRequested}
                  onSettingsOpened={() => setImportSettingsRequested(false)}
                  meta={meta}
                  refresh={refresh}
                  onBack={() => navigate("trades")}
                  toast={toast}
                />
              )}
              {![...journalPages, "import"].includes(page) && (
                <div className="card empty">
                  <h1>Page not found</h1>
                  <Button onClick={() => navigate("results")}>
                    Open Results
                  </Button>
                </div>
              )}
            </main>
          </div>
          {appearance === "classic" && (
            <footer className="classic-footer">
              <span>PrimusLab · Personal trading research</span>
              <span>Classic edition</span>
              <a
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  window.scrollTo({ top: 0 });
                }}
              >
                Back to top ↑
              </a>
            </footer>
          )}
          {message && (
            <div className="toast" role="status">
              {message}
            </div>
          )}
          {meta.journal_preferences?.welcome_pending && (
            <Welcome refresh={refresh} />
          )}
          {tourOpen && !meta.journal_preferences?.welcome_pending && <GuidedTour refresh={refresh} onClose={() => setTourOpen(false)} />}
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
          {access && session.owner && session.auth_mode === "google" && (
            <Access onClose={() => setAccess(false)} />
          )}
        </div>
      </JournalClock.Provider>
    </AppearanceContext.Provider>
  );
}
