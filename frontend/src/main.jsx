import React, {lazy,Suspense} from "react";
import { createRoot } from "react-dom/client";
const App=lazy(()=>import("./App"));
import BullpenProvider from "./components/BullpenProvider";
import SiteExperience, { sitePreview } from './SiteExperience';
import "./theme.css";
import "./styles.css";
import "./responsive.css";
import "./lab-preview.css";
import "./workspace-theme.css";
import "./mobile-shell.css";


class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="loading-screen">
        <h1>PrimusLab</h1>
        <p>This page could not be displayed. Refresh to retry.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Refresh page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BullpenProvider><Suspense fallback={<main className="loading-screen" role="status">Opening your workspace…</main>}>
      {sitePreview() && ['/', '/signin', '/journal', '/journal/', '/backtesting', '/learn', '/market-lab', '/mindset', '/matrix'].includes(location.pathname) ? <SiteExperience/> : <App />}
    </Suspense></BullpenProvider>
  </ErrorBoundary>,
);
