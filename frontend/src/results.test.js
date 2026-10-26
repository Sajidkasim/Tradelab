import { expect, it, vi } from "vitest";
import { fetchResultSamples } from "./resultSamples";

it("All fetches two independent result samples with identical setup filters", async () => {
  const filters = {
    scope: "All",
    strategy: "My setup",
    confirmations: ["SMT", "CISD"],
    window: "New York",
  };
  const request = vi.fn(async (path, options) => ({
    sample: options.body.scope,
  }));
  const signal = new AbortController().signal;
  const data = await fetchResultSamples(
    request,
    filters,
    { mode: "light", detail: true },
    signal,
  );
  expect(data).toEqual([
    { sample: "Backtesting" },
    { sample: "Forward testing" },
  ]);
  expect(request).toHaveBeenCalledTimes(2);
  for (const [index, scope] of ["Backtesting", "Forward testing"].entries()) {
    expect(request.mock.calls[index][1]).toMatchObject({
      signal,
      body: { ...filters, scope, sample: scope, mode: "light", detail: true },
    });
  }
  expect(filters.scope).toBe("All");
});

it("A single data source needs only its own result request", async () => {
  const request = vi.fn(async () => ({ sample: "Forward testing" }));
  await fetchResultSamples(
    request,
    { scope: "Forward testing" },
    {},
    undefined,
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].body.scope).toBe("Forward testing");
});
