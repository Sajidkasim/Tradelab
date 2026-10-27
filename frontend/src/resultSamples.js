// The API computes combined results from the underlying trades, never by
// averaging separate win rates or combining chart totals in the browser.
export function fetchResultSamples(request, filters, options, signal) {
  return request("/results", {
    method: "POST",
    body: { ...filters, ...options, combined: filters.scope === "All" },
    signal,
  }).then((result) => [result]);
}
