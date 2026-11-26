import {recordTiming} from './replayTiming';
import {replayFrames} from './replayFrames';
import {clearAllCache, invalidateCache, setCachedSession} from './routeCache';
let csrf = "";
export function setCsrf(value) {
  csrf = value || "";
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let pendingSession;

export function api(path, options = {}) {
  if (path !== "/session" || (options.method && options.method !== "GET")) {
    return request(path, options);
  }
  // Concurrent startup requests must share the same session cookie and CSRF token.
  // A component unmounting must not cancel the request for the other callers.
  if (!pendingSession) {
    pendingSession = request(path, { ...options, signal: undefined })
      .then((data) => {
        setCachedSession(data);
        return data;
      })
      .finally(() => {
        pendingSession = undefined;
      });
  }
  return pendingSession;
}

function invalidateForMutation(path) {
  const clean = path.split("?")[0];
  if (clean === "/logout" || clean === "/unlock") {
    clearAllCache();
    return;
  }
  if (clean.startsWith("/journal-accounts")) {
    invalidateCache("/journal-accounts");
    invalidateCache("/journal");
    invalidateCache("/metadata");
    return;
  }
  if (clean.startsWith("/journal")) {
    invalidateCache("/journal");
    invalidateCache("/metadata");
    invalidateCache("/results:");
    return;
  }
  if (clean.startsWith("/mindset")) {
    invalidateCache("/mindset");
    return;
  }
  if (clean.startsWith("/backtesting")) {
    invalidateCache("/backtesting");
    return;
  }
  if (clean.startsWith("/matrix")) {
    invalidateCache("/matrix");
    return;
  }
  // Trades, settings, imports, restores, etc. affect Lab metadata & results.
  invalidateCache("/metadata");
  invalidateCache("/results:");
}

async function request(path, options) {
  const { body, silent401 = false, ...rest } = options;
  const method = (rest.method || "GET").toUpperCase();
  const form = body instanceof FormData;
  const headers = {
    "X-Primus-CSRF": csrf,
    ...(path.startsWith("/backtesting/")?{"X-Primus-Replay-Wire":"columns-v1"}:{}),
    ...(!form && body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...rest.headers,
  };
  const started=performance.now();
  const response = await fetch(`/api${path}`, {
    ...rest,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await response.json().catch((error) => {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "The server returned an unreadable response. Please retry.",
      response.status,
    );
  });
  recordTiming('api:'+ method+':'+path.split('?')[0].replace(/sessions\/[^/]+/,'sessions/:id'),started);
  if (!response.ok) {
    if (response.status === 401 && path !== "/unlock" && !silent401) {
      clearAllCache();
      window.dispatchEvent(new Event("primus:logout"));
    }
    throw new ApiError(
      data?.detail || "That request could not be completed. Please retry.",
      response.status,
    );
  }
  if (method !== "GET" && path.split("?")[0] !== "/results" && path.split("?")[0] !== "/activity") {
    invalidateForMutation(path);
  }
  if(data?.projection)data.projection={...data.projection,frames:replayFrames(data.projection.frames)};
  return data;
}
