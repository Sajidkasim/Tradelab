// Only the server's validated configuration selects the journal section.
export const labBase = typeof document === "undefined" ? "" :
  document.querySelector('meta[name="primus-lab-path"]')?.content || "";
export const labHref = (page = "") => page ? `${labBase}/${page}` : labBase || "/";
export function journalPage(pathname, hash = "") {
  const relative = pathname.slice(labBase.length).replace(/^\/+/, "");
  return relative.split("/")[0] || (hash === "#trades" ? "trades" : "results");
}
