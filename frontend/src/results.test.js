import { expect, it, vi } from "vitest";
import { fetchResultSamples } from "./resultSamples";

it("All asks the server for one combined raw-trade sample", async () => {
  const filters = {
    scope: "All",
    strategy: "My setup",
    confirmations: ["SMT", "CISD"],
    window: "All sessions",
  };
  const request = vi.fn(async (path, options) => ({
    sample: options.body.scope,
  }));
  const signal = new AbortController().signal;
  expect(
    await fetchResultSamples(
      request,
      filters,
      { mode: "light", detail: true },
      signal,
    ),
  ).toEqual([{ sample: "All" }]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1]).toMatchObject({
    signal,
    body: { ...filters, combined: true, mode: "light", detail: true },
  });
  expect(filters.scope).toBe("All");
});
it("A single data source stays singular", async () => {
  const request = vi.fn(async () => ({ sample: "Forward testing" }));
  await fetchResultSamples(
    request,
    { scope: "Forward testing" },
    {},
    undefined,
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].body).toMatchObject({
    scope: "Forward testing",
    combined: false,
  });
});
