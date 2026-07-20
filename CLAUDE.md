# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Related docs: `AGENTS.md` (Korean dev guide), `docs/ARCHITECTURE.md` (full architecture +
> known limitations), `docs/AI_INTEGRATION.md` (REST/MCP usage), `docs/REFACTORING_REPORT.md`.
> Project skills in `.claude/skills/`: `timeline-api` (AI data manipulation), `verify-app`
> (verification procedure), `deploy`.

## Commands

```bash
npm run dev       # Vite dev server, http://localhost:5173, hot-reload
npm run dev:api   # Express API server on :3000 (dev proxies /api to it)
npm run build     # Production build → dist/
npm run test:e2e  # Playwright E2E (auto-starts vite dev server)
```

**After any code change, run `npm run build` && `npx playwright test`** — 16 E2E tests
(14 smoke + 2 AI-sync; the AI-sync pair auto-skips if the API server isn't running).
There is no linter configured. Test selector conventions are documented in
`.claude/skills/verify-app/SKILL.md`.

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
  then send to the server; a failed server write is logged but never blocks the UI.
- `App.jsx` **debounces `saveData` by 1.5s** (auto-save `useEffect`) to avoid a server
  request per keystroke/drag. Settings changes call `storage.saveSettings` directly.
- **Revision-based sync with external (AI) writers**: every server mutation bumps a revision
  counter (`server/data/meta.json`). The browser sends `If-Match: <revision>` on save — a 409
  means an external writer (AI) changed data first, and the app reloads server state
  (server-wins, via `setTasksSilent` so undo history isn't polluted). A 10s polling effect
  on `GET /api/revision` picks up external changes in open tabs.
- API base is `/api`: dev uses the Vite proxy to :3000 (vite.config.js), prod uses Caddy.

The server (`server/`) is a small CommonJS Express app: `index.js` (blob + settings +
snapshots routes), `routes/tasks.js` (per-task CRUD for AI integration, validated, 409 on
If-Match mismatch), `lib/store.js` (atomic writes + revision), `lib/taskTree.js` (**CJS
mirror of `src/utils/taskTree.js` — keep signatures in sync**), `lib/validate.js`.
Data lives in JSON files under `server/data/`. No database; auth is Caddy basicauth only.

### AI integration surface

AI agents manipulate timeline data via per-task REST endpoints (`server/openapi.yaml` is the
spec) or the **MCP server** (`mcp/index.js`, 12 tools, registered via `.mcp.json` —
`list-tasks`/`add-task`/`reschedule`/etc.). See `docs/AI_INTEGRATION.md` and the
`timeline-api` skill. Prefer per-task endpoints over blob `POST /api/data`.

### State management (`src/App.jsx`, ~880 lines — the hub)

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

Because the tree feeds undo/redo history, **never mutate task objects in place**. Use the
pure helpers in **`src/utils/taskTree.js`** (`updateTaskInTree`, `deleteFromTree`,
`findTaskAndParent`, `indentTask`, `outdentTask`, `recalcTaskBounds*`, `findOwnerOfEntity`,
…) — don't reimplement tree recursion inline. Deep-clone with `structuredClone`, not
`JSON.parse(JSON.stringify(...))`. `filteredTasks` in `App.jsx` is a `useMemo` **value** —
reference it as `filteredTasks`, not `filteredTasks()`. If you change a taskTree.js
signature, update the CJS mirror `server/lib/taskTree.js` too.
