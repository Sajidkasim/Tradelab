import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SiteExperience, { sitePreview } from './SiteExperience';
import "./theme.css";
import "./styles.css";
import "./responsive.css";
import "./lab-preview.css";

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
    {sitePreview() && ['/', '/journal', '/journal/', '/backtesting'].includes(location.pathname) ? <SiteExperience/> : <App />}
  </ErrorBoundary>,
);
