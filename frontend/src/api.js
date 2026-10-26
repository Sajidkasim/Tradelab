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

export async function api(path, options = {}) {
  const { body, ...rest } = options;
  const form = body instanceof FormData;
  const headers = {
    "X-Primus-CSRF": csrf,
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
    );
  }
  return data;
}
