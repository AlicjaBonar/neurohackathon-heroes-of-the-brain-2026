# NeuroFlow frontend

## Run

```sh
pnpm install
pnpm dev
pnpm build
```

Start the backend first (`uvicorn app.backend.main:app --port 8000` from the repo root). In dev, Vite
proxies `/api` and `/ws` to `localhost:8000` (see `vite.config.ts`), so no CORS setup is needed.

Copy `.env.example` to `.env.local` to configure the API:

- `VITE_API_BASE_URL` is the REST base URL (defaults to `/api`). Use `getJson` or
  `postJson` from `src/api/rest.ts`; successful responses must contain JSON.
- `VITE_WS_URL` is the live stream URL (defaults to `/ws` on the current host,
  using `wss` on HTTPS). The stream sends JSON text messages. Close the returned
  function to disconnect; reconnection is managed by the caller.

## Structure

- `src/App.tsx` only switches between screens and holds app-wide state (avatar, session mode).
- `src/components/` holds reusable, feature-agnostic building blocks:
  - `ui/Button.tsx` — `Button` (`primary` / `ghost` / `danger`), `BackButton`.
  - `ui/Card.tsx` — `GlassPanel`, `CardHeader`, `ProgressBar`, `ValueWithUnit`.
  - `ui/Page.tsx` — `ScreenTitle`, `StepIndicator`; plus `ui/Modal.tsx`, `ui/Icon.tsx`.
  - `form/Fields.tsx` — `UnitField`, `SelectField`.
  - `layout/AppShell.tsx` — `AppShell` (background + header), `Brand`, `StatusPill`.
- `src/features/<view>/` — one folder per view (`profile`, `hub`, `stats`, `session`) with
  `<View>Screen.tsx` and mock data files. Small parts used only by one screen live in that
  screen's file as non-exported functions. `features/avatar/` is shared by several views.
- `src/lib/utils.ts` — small helpers (`cx`, formatting, constants).

Rule of thumb: one file per concept, not per component. Split a component into its own
file only when it is reused, large, or has its own logic (hooks, effects).

- `src/api/` — `rest.ts` (fetch + `ApiError`), `backend.ts` (typed calls for every endpoint used),
  `types.ts` (REST models and WebSocket messages from docs/APP_SPEC.md), `liveSocket.ts`
  (WebSocket with `send`/`close`; takes the `ws_url` returned by `POST /api/sessions`).
- `src/features/session/useLiveSession.ts` runs one session: create → connect → `baseline_pre` →
  exercise → `finish`. Demo personas use `replay`; others use `mock` (replay falls back to mock on 404/422).
- `src/features/model3d/` contains the canvas lifecycle contract for a 3D renderer.
  Supply a renderer implementing `Model3DRenderer`; no 3D engine or model asset is
  included until one is selected.
