export function fetchResultSamples(request, filters, options, signal, chartFirst = false) {
  // Compare requests each source independently so each gets its own sample and statistics.
  const scopes = chartFirst && filters.scope === "All"
    ? ["Backtesting", "Forward testing"]
    : [filters.scope];
  return Promise.all(scopes.map(scope => request("/results", {
    method: "POST",
    body: {
      ...filters, ...options, scope,
      combined: !chartFirst && scope === "All",
      ...(chartFirst && { chart_first: true }),
    },
    signal,
  })));
}
