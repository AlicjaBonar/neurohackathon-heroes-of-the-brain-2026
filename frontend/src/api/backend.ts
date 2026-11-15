import { getJson, requestJson } from "./rest";
import type {
  Dashboard,
  Exercise,
  Fitness,
  History,
  Persona,
  Probe,
  SessionCreated,
  SourceIn,
  Summary,
  Timeline,
  User,
  UserIn,
} from "./types";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  createUser: (body: UserIn) => requestJson<User>("users", json("POST", body)),
  updateUser: (id: string, body: UserIn) => requestJson<User>(`users/${id}`, json("PUT", body)),
  getUser: (id: string) => getJson<User>(`users/${id}`),
  dashboard: (id: string) => getJson<Dashboard>(`users/${id}/dashboard`),
  history: (id: string, metrics: string[], signal?: AbortSignal, byHour = false) =>
    getJson<History>(`users/${id}/history?metrics=${metrics.join(",")}${byHour ? "&by_hour=true" : ""}`, signal),
  fitness: (id: string, signal?: AbortSignal) => getJson<Fitness>(`users/${id}/fitness`, signal),
  exercises: () => getJson<Exercise[]>("exercises"),
  personas: () => getJson<Persona[]>("demo/personas"),
  createSession: (body: { user_id: string; source: SourceIn; protocol: string[] }) =>
    requestJson<SessionCreated>("sessions", json("POST", body)),
  finishSession: (id: string) => requestJson<Summary>(`sessions/${id}/finish`, json("POST")),
  probe: (id: string) => getJson<Probe>(`sessions/${id}/probe`),
  timeline: (id: string) => getJson<Timeline>(`sessions/${id}/timeline`),
  summary: (id: string) => getJson<Summary>(`sessions/${id}/summary`),
};

/** Backend errors are `{"error": {"code", "message"}}` (docs 8.3); returns the message if present. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "responseBody" in error) {
    try {
      const body = JSON.parse(String((error as { responseBody: string }).responseBody));
      if (body?.error?.message) return String(body.error.message);
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error.message : "Unknown error";
}
