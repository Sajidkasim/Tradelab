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
import ReleaseNotes from "./ReleaseNotes";
import Results from "./Results";
import Trades from "./Trades";
import Import from "./Import";
import Tools from "./Tools";
import {WorkspaceEntrance} from "./PrimusSignIn";
import Backup from "./Backup";
import LabSettings from "./LabSettings";
import Access from "./Access";
import icon from "../../assets/primuslab-icon.svg";
import compassLogo from "../../assets/primus-compass.png";
import { labHref, journalPage } from "./paths";
import { sitePreview, localSitePreview, PrimusHeader } from './SiteExperience';

const journalPages = ["results", "", "overview", "trades", "journal"];
const pageFromLocation = () => journalPage(location.pathname, location.hash);

export default function App() {
  const [session, setSession] = useState(null),
    [meta, setMeta] = useState(null),
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
  const [filterEditor, setFilterEditor] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [dismissedRelease, setDismissedRelease] = useState(null);
  useEffect(() => {
    if (meta?.release_notes && !meta.release_notes.seen && dismissedRelease !== meta.release_notes.version && !meta.journal_preferences?.welcome_pending && meta.journal_preferences?.tour_status !== "pending" && !tourOpen && journalPages.includes(page)) setReleaseOpen(true);
  }, [meta, dismissedRelease, tourOpen, page]);
  useEffect(() => {
    if (meta?.journal_preferences?.tour_status === "pending" && !meta.journal_preferences.welcome_pending) {
      setPage("results");
      setTourOpen(true);
    }
  }, [meta?.journal_preferences?.tour_status, meta?.journal_preferences?.welcome_pending]);
  const toast = useCallback((text) => setMessage(text), []);
  const refresh = useCallback(async () => {
    const metadata = await api("/metadata");
    setMeta(metadata);
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
      setTourOpen(false);
      setReleaseOpen(false);
      setDismissedRelease(null);
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
    document.documentElement.dataset.theme = mode;
    delete document.documentElement.dataset.appearance;
    localStorage.setItem("primus-theme", mode);
    localStorage.removeItem("primus-appearance");
  }, [mode]);
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
    const sync = () => setPage(pageFromLocation());
    window.addEventListener("popstate", sync);
    window.addEventListener("primus:navigate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("primus:navigate", sync);
    };
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
              <button onClick={() => setReleaseOpen(true)}>
                <HelpCircle size={16} /> What’s new
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
      <div className={`loading-screen ${sitePreview()?"pt-loading":""}`} role="status" aria-live="polite">
        {sitePreview()?<div className="pt-loading-logo"><img src={compassLogo} alt="Primus compass"/><span aria-hidden="true"/></div>:<img src={icon} alt=""/>}
        <h1>{sitePreview()?"Your Strategy Lab":"PrimusLab"}</h1>
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Button onClick={boot}>Retry</Button>
          </>
        ) : (
          <>
            {!sitePreview()&&<span className="spinner" />}
            <p>{sitePreview()?"Bringing your setups and results together…":"Opening your workspace…"}</p>
          </>
        )}
      </div>
    );
  const entrancePreview=localSitePreview() && new URLSearchParams(location.search).get('preview')==='signin';
  if (!session.authenticated || entrancePreview)
    return (
      <WorkspaceEntrance workspace="lab"
        session={entrancePreview?{...session,auth_mode:'google'}:session}
        returnTo={sitePreview()?'/lab':''}
        ready={!entrancePreview&&Boolean(session.csrf)} onUnlocked={boot}
      />
    );
  return (
      <JournalClock.Provider
        value={meta.journal_preferences?.timezone || "America/New_York"}
      >
        <div className={`app-shell ${sitePreview() ? "pt-lab" : ""}`}>
          {sitePreview() ? <PrimusHeader active="lab" actions={workspaceMenu} theme={mode} onThemeToggle={()=>setMode(mode==='dark'?'light':'dark')}/> : <header className="site-header">
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
            {workspaceMenu}
          </header>}
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
                    <h1>{sitePreview() ? <>Strategy <em>Lab.</em></> : "Strategy Lab"}</h1>
                  </div>
                </div>
                <div className="research-toolbar">
                  <Button
                    type="button"
                    className="lab-settings-shortcut"
                    onClick={() => setLabSettings(true)}
                  >
                    <Settings2 size={15} aria-hidden="true" /> Settings
                  </Button>
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
                    revision={revision}
                    mode={mode}
                    scope={scope}
                    setScope={setScope}
                    refresh={refresh}
                    toast={toast}
                    onTrades={() => navigate("trades")}
                    onResults={() => navigate("results")}
                    activeView={page}
                    onImport={() => navigate("import")}
                    filterEditor={filterEditor}
                    onCloseFilterEditor={() => setFilterEditor(false)}
                    tourOpen={tourOpen}
                  />
                </section>
                <section id="trades" aria-label="Trades">
                  <Trades
                    revision={revision}
                    meta={meta}
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
              {page === "tools" && (
                <Tools meta={meta} onResults={() => navigate("results")} />
              )}
              {![...journalPages, "import", "tools"].includes(page) && (
                <div className="card empty">
                  <h1>Page not found</h1>
                  <Button onClick={() => navigate("results")}>
                    Open Results
                  </Button>
                </div>
              )}
            </main>
          </div>
          {message && (
            <div className="toast" role="status">
              {message}
            </div>
          )}
          {meta.journal_preferences?.welcome_pending && (
            <Welcome refresh={refresh} />
          )}
          {releaseOpen && !tourOpen && !meta.journal_preferences?.welcome_pending && <ReleaseNotes notes={meta.release_notes} onClose={() => { setReleaseOpen(false); setDismissedRelease(meta.release_notes.version); }} onSeen={async () => { await api("/release-notes/seen", {method:"POST"}); setDismissedRelease(meta.release_notes.version); setReleaseOpen(false); await refresh(); }} />}
          {tourOpen && !meta.journal_preferences?.welcome_pending && <GuidedTour refresh={refresh} onClose={() => setTourOpen(false)} />}
          {labSettings && (
            <LabSettings
              meta={meta}
              refresh={refresh}
              toast={toast}
              onClose={() => setLabSettings(false)}
              onCreateFilter={() => {
                setLabSettings(false);
                navigate("results");
                setFilterEditor(true);
              }}
            />
          )}
          {backup && (
            <Backup
              onClose={() => setBackup(false)}
              refresh={refresh}
              toast={toast}
              count={meta.trade_count}
            />
          )}
          {access && session.owner && session.auth_mode === "google" && (
            <Access onClose={() => setAccess(false)} />
          )}
        </div>
      </JournalClock.Provider>
  );
}
