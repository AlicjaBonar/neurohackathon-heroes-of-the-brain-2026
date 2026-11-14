const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function resolveApiUrl(path: string): URL {
  const baseUrl = new URL(apiBaseUrl, window.location.origin);
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
  return new URL(path.replace(/^\/+/, ""), baseUrl);
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(resolveApiUrl(path), { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(`API request failed with status ${response.status}.`, response.status, body);
  }

  if (response.status === 204) {
    throw new Error(`Expected a JSON response from ${path}, but the API returned no content.`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error(`Expected a JSON response from ${path}.`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`The API returned invalid JSON for ${path}.`);
  }
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { method: "GET", signal });
}

export function postJson<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  return requestJson<TResponse>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
