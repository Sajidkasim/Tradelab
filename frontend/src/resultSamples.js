// Fetch independent samples. Financial statistics and charts stay on the server.
export function fetchResultSamples(request, filters, options, signal) {
  const scopes =
    filters.scope === "All"
      ? ["Backtesting", "Forward testing"]
      : [filters.scope];
  return Promise.all(
    scopes.map((scope) =>
      request("/results", {
        method: "POST",
        body: { ...filters, ...options, scope, sample: scope },
        signal,
      }),
    ),
  );
}
