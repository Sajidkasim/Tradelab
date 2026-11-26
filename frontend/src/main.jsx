import React, {lazy, Suspense, useEffect, useState} from "react";
import { createRoot } from "react-dom/client";
const App=lazy(()=>import("./App"));
import BullpenProvider from "./components/BullpenProvider";
import SiteExperience, { sitePreview } from './SiteExperience';
import { isSitePath, isSpaPath, navigateTo } from "./paths";
import "./theme.css";
import "./styles.css";
import "./responsive.css";
import "./lab-preview.css";
import "./workspace-theme.css";
import "./mobile-shell.css";
import "./primus-tokens.css";
import "./primus-living.css";
import "./primus-studio.css";


class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }
  render() {
    return this.state.failed ? (
      <div className="loading-screen">
        <h1>PrimusTrader</h1>
        <p>This page could not be displayed. Refresh or switch views to retry.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Refresh page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function RootRouter() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;
      const rawHref = anchor.getAttribute("href") || "";
      if (!rawHref || rawHref.startsWith("#")) return;
      let url;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      if (!isSpaPath(url.pathname)) return;
      event.preventDefault();
      navigateTo(url.pathname + url.search + url.hash);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("primus:navigate", sync);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("primus:navigate", sync);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<main className="loading-screen" role="status">Opening your workspace…</main>}>
        {sitePreview() && isSitePath(pathname) ? <SiteExperience pathname={pathname} /> : <App />}
      </Suspense>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BullpenProvider>
      <RootRouter />
    </BullpenProvider>
  </ErrorBoundary>,
);
