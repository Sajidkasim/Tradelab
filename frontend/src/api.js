import {replayFrames} from './replayFrames';
let csrf = "";
export function setCsrf(value) {
  csrf = value || "";
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
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
    pendingSession = request(path, { ...options, signal: undefined }).finally(() => {
      pendingSession = undefined;
    });
  }
  return pendingSession;
}

async function request(path, options) {
  const { body, ...rest } = options;
  const form = body instanceof FormData;
  const headers = {
    "X-Primus-CSRF": csrf,
    ...(path.startsWith("/backtesting/")?{"X-Primus-Replay-Wire":"columns-v1"}:{}),
    ...(!form && body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...rest.headers,
  };
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
  if (!response.ok) {
    if (response.status === 401 && path !== "/unlock")
      window.dispatchEvent(new Event("primus:logout"));
    throw new ApiError(
      data.detail || "That request could not be completed. Please retry.",
      response.status,
      data.code,
    );
  }
  if(data.projection)data.projection={...data.projection,frames:replayFrames(data.projection.frames)};
  return data;
}
