# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> There is also a detailed Korean guide in `AGENTS.md`. It is thorough on data-model
> internals and manual test checklists, but **outdated on one point**: it says the app is
> "backend 없음 / localStorage only." That is no longer true — see the Architecture note below.

## Commands

```bash
npm run dev      # Vite dev server, http://localhost:5173, hot-reload
npm run build    # Production build → dist/
npm run preview  # Preview the built dist/ locally

# API server (separate CommonJS Express app)
cd server && npm install && npm start   # runs on port 3000
```

There is **no test runner and no linter configured**. The only automated verification is
`npm run build` succeeding. Verify behavior changes manually in the running app (AGENTS.md
has a detailed manual test checklist).

### Deployment

```bash
./start_server.sh          # Docker Compose (HTTPS via Caddy); falls back to `serve -s dist` on HTTP:8080 if Docker is unavailable
./start_server.sh --dev    # Compose with hot-reload overlay (docker-compose.dev.yml)
```

Docker Compose runs three services: the static frontend (nginx/`80`), the Express API
(`project-helper-api`, `3000`), and **Caddy** as the HTTPS reverse proxy (`443`). Caddy
routes `/api/*` → API container and everything else → frontend, and terminates TLS with an
internal cert (`tls internal`). Edit the IP/host in `Caddyfile` for your server. Note
`Caddyfile` also has HTTP basic auth enabled.

## Architecture

Client-heavy React 18 + Vite SPA with a thin Express persistence backend.

### Storage is a localStorage-cache + server-sync hybrid — this is the most important thing to understand

`src/utils/storage.js` is the single source of truth for persistence. It is NOT
localStorage-only:

- **Reads** (`loadData`/`loadSettings`/`loadSnapshots`): try the server (`/api/*`) first,
  refresh the localStorage cache on success, and **fall back to localStorage** on any network
  error. So the app keeps working offline.
- **Writes** (`saveData`/`saveSettings`): write localStorage **immediately (synchronously)**,
  then fire the server request asynchronously; a failed server write is logged but never
  blocks the UI.
- `App.jsx` **debounces `saveData` by 1.5s** (see the auto-save `useEffect`) to avoid a server
  request per keystroke/drag. Settings changes call `storage.saveSettings` directly.
- The API base is `/api`, so in production Caddy must proxy `/api/*` to the server; in dev
  there is currently **no Vite proxy** for `/api`, so server reads fail and the app silently
  uses the localStorage fallback.

The server (`server/index.js`) is deliberately trivial: Express reads/writes three JSON files
under `server/data/` — `data.json`, `settings.json`, `snapshots.json`. No database, no auth at
the app layer (auth is Caddy basicauth).

### State management (`src/App.jsx`, ~1000 lines — the hub)

`App.jsx` owns essentially all state and passes handlers down. Key pieces:

- **`useUndoRedo(tasks)`** (`src/hooks/useUndoRedo.js`) holds the entire task tree with history
  (max 20 entries). Use `setState(fn)` for user actions that should be undoable; use
  **`setStateSilent(fn)`** for transient states like mid-drag updates that must NOT pollute
  history.
- **`useToast()`** (`src/hooks/useToast.js`) — always use `toast.success/error/warn/info`
  instead of `alert()`.
- View mode is `'table' | 'timeline' | 'split'`; ~10 UI settings (timeScale, zoomLevel,
  darkMode, etc.) are each their own `useState`, initialized synchronously from the
  localStorage settings cache and then overwritten after the async server load resolves.

### Data model — tasks are a recursive tree (`src/utils/dataModel.js`)

A Task has `children: []` (recursion) and `timeRanges: [...]` — **`timeRanges` is the real
date data**; top-level `startDate`/`endDate` and task-level `dependencies` are legacy.
Dependencies now live at the range level.

- **`createNewTask()`** — always create tasks through this, never build the object by hand.
- **`migrateTaskData()`** — converts old `startDate`/`endDate` tasks into `timeRanges`; it is
  called on every load (including in `getSampleData`), so loaded data is always normalized.
- **`flattenTasks()`** — flattens the tree to an ordered array while respecting each node's
  `expanded` flag; this is what the views render.

### Component conventions

- Each component is a `Foo.jsx` + `Foo.css` pair.
- Dark mode is done purely with the `[data-theme="dark"]` CSS selector — no JS theming for it.
  Chart color themes are separate, in `src/themes/`.
- Timeline drag-and-drop uses **@dnd-kit** (`TimelineView.jsx` / `TimelineBar.jsx`).
- `htmlExporter.js` generates a **self-contained interactive HTML** export of the timeline.

### Tree-update invariants (critical for correctness)

Because the tree feeds undo/redo history, **never mutate task objects in place**. Update
immutably via recursive helpers (`updateTaskInTree`, `deleteFromTree` patterns shown in
AGENTS.md), and deep-clone with `structuredClone`, not `JSON.parse(JSON.stringify(...))`.
`filteredTasks` in `App.jsx` is a `useMemo` **value** — reference it as `filteredTasks`, not
`filteredTasks()`.
