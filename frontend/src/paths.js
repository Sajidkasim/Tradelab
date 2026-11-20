// Only the server's validated configuration selects the journal section.
export const labBase = typeof document === "undefined" ? "" :
  document.querySelector('meta[name="primus-lab-path"]')?.content || "";
export const labHref = (page = "") => page ? `${labBase}/${page}` : labBase || "/";
export function journalPage(pathname, hash = "") {
  const relative = pathname.slice(labBase.length).replace(/^\/+/, "");
  return relative.split("/")[0] || (hash === "#trades" ? "trades" : "results");
}

export const SITE_PATHS = ["/", "/signin", "/journal", "/journal/", "/backtesting", "/learn", "/mindset", "/matrix"];
const LAB_PAGES = new Set(["", "trades", "journal", "overview", "import", "tools"]);

export function isSitePath(pathname) {
  return SITE_PATHS.includes(pathname);
}

export function isSpaPath(pathname) {
  if (SITE_PATHS.includes(pathname)) return true;
  if (labBase) {
    if (pathname === labBase || pathname === `${labBase}/`) return true;
    if (pathname.startsWith(`${labBase}/`)) {
      const sub = pathname.slice(labBase.length + 1).replace(/\/+$/, "");
      return LAB_PAGES.has(sub);
    }
    return false;
  }
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  return LAB_PAGES.has(clean);
}

export function navigateTo(href, { replace = false } = {}) {
  const url = new URL(href, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", next);
  window.dispatchEvent(new Event("primus:navigate"));
  if (!url.hash) {
    window.scrollTo({ top: 0 });
  }
}
