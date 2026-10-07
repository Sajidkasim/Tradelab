import { afterEach, expect, it, vi } from "vitest";
import { api, setCsrf } from "./api";
afterEach(() => vi.unstubAllGlobals());

it("does not turn a cancelled response body into a successful empty result", async () => {
  const cancelled = new DOMException("Cancelled", "AbortError");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(cancelled),
      }),
  );
  await expect(api("/results")).rejects.toMatchObject({ name: "AbortError" });
});

it("reports unreadable responses instead of returning invalid result objects", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Invalid JSON")),
      }),
  );
  await expect(api("/results")).rejects.toThrow(/unreadable response/);
});

it("attaches the session CSRF header to writes and retains multipart boundaries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
  vi.stubGlobal("fetch", fetcher);
  setCsrf("test-only-csrf");
  const form = new FormData();
  form.append("source", "fxreplay");
  await api("/import/preview", { method: "POST", body: form });
  const options = fetcher.mock.calls[0][1];
  expect(options.headers["X-Primus-CSRF"]).toBe("test-only-csrf");
  expect(options.headers).not.toHaveProperty("Content-Type");
  expect(options.body).toBe(form);
});
