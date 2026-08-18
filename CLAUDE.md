# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **⚠️ 세션 시작 시 `HANDOVER.md`를 먼저 읽어라.** 진행 중인 개선 작업의 상태, 데이터 소실을
> 막는 절대 규칙, 검증 절차, 태스크 보드가 거기 있다. 이 파일(CLAUDE.md)은 *변하지 않는*
> 코드베이스 규약이고, `HANDOVER.md`는 *매번 변하는* 진행 상태다. 작업을 마치면
> `HANDOVER.md`의 태스크 보드와 세션 로그를 갱신하고 끝낸다.
>
> Related docs: `HANDOVER.md` (진행 상태 — 먼저 읽기),
> `docs/TECHNICAL_DUE_DILIGENCE.md` (기술 실사: 문제점·근거·로드맵),
> `docs/AUTO_CYCLE_REPORT_2026-08.md` (08-06~08-17 자동 사이클이 바꾼 것 정리),
> `AGENTS.md` (Korean dev guide), `docs/ARCHITECTURE.md` (full architecture +
> known limitations), `docs/AI_INTEGRATION.md` (REST/MCP usage), `docs/REFACTORING_REPORT.md`.
> Project skills in `.claude/skills/`: `timeline-api` (AI data manipulation), `verify-app`
> (verification procedure), `deploy`.
>
> (2026-08-05: `.github/copilot-instructions.md`, `AGENTS.md`, `README.md` 의 낡은 서술은
> 실사 후 모두 교정됐다. 다시 드리프트가 생기면 여기에 기록할 것.)

## Commands

```bash
npm run dev          # Vite dev server, http://localhost:5173, hot-reload
npm run dev:api      # Express API server (PORT env, default 3000)
npm run build        # Production build → dist/
npm run lint         # ESLint 9 (flat config)
npm run test:unit    # Vitest — 도메인 순수함수 + XSS 회귀 (381건)
npm run test:server  # node:test — 검증·서비스·저장소 내구성·감사 로그·의존성 정합성 (128건)
npm run test:e2e     # Playwright E2E 80건 (API·dev 서버 자동 기동)
npm run verify       # 위 전부 + 빌드 — 변경 후 이것을 돌려라
```

`server/` and `mcp/` are **separate npm packages** with their own `package.json` — install them
before running the API or MCP server: `npm install --prefix server`, `npm install --prefix mcp`.

Running a subset of the tests:

```bash
npx vitest run tests/unit/taskTree.test.js          # one unit file
npx vitest                                          # watch mode
node --test server/test/validate.test.js            # one server file
npx playwright test tests/e2e/features.spec.js      # one E2E spec
npx playwright test -g "프로젝트"                   # by test-title substring
npx playwright test --headed --debug                # watch it / step through
```

**변경 후에는 `npm run verify`** — 합격 기준은 lint 0 error · unit 381/381 · server 128/128 ·
빌드 성공 · **E2E 80/80 (skip 0)**.

`playwright.config.js` 는 **API 서버와 dev 서버를 모두 자동 기동**하며, API는
`PH_DATA_DIR=.tmp-e2e-data` 로 격리된다. 예전에는 API 서버를 수동으로 띄우지 않으면 8건이
조용히 skip 되고 1건이 404로 실패해서(19/1/8) "통과"가 아무것도 보증하지 않았다.
**skip은 불합격으로 취급한다** — CI에도 skip 검사 게이트가 있다.

Env overrides that matter on this host: **포트 3000은 무관한 uvicorn 서비스가 점유 중**이다.
`PORT=3100 npm run dev:api` 로 띄우고 프론트는 `VITE_API_TARGET=http://localhost:3100 npm run dev`
로 맞춘다. `PH_DATA_DIR` 로 데이터 위치를 격리할 수 있다.

ESLint 9(flat config, `eslint.config.js`)가 붙어 있고 CI 게이트다 — 경고는 허용, **에러는 0**.
Test selector conventions are documented in `.claude/skills/verify-app/SKILL.md`.

`node scripts/seed-roadmap.mjs` (API server must be up) injects `ROADMAP.md` into the app as a
task tree — the self-demo used for the README screenshots. It snapshots current data first.

### Deployment

```bash
cp .env.example .env       # 최초 1회 — BASIC_AUTH_USER / BASIC_AUTH_HASH 필수
./start_server.sh          # 백업 → 빌드 → 기동 → 헬스게이트 (Docker 불가 시 HTTP:8080 폴백)
./start_server.sh --dev    # hot-reload 오버레이 (docker-compose.dev.yml)
./scripts/verify-deploy.sh # 배포 후 검증 28건 — 자격증명 없이 전부 검사한다 (아래 참조)
```

`start_server.sh` 는 **배포 전에 자동으로 데이터 백업을 수행하고, 실패하면 배포를 중단한다.**
API 컨테이너는 non-root(uid 1000)로 실행되므로, non-root 전환 전에 만들어진 볼륨 파일의
소유권을 배포 스크립트가 멱등하게 조정한다. 자격증명은 `.env` 에서 주입된다 —
`Caddyfile` 에 해시를 다시 하드코딩하지 마라.

Docker Compose runs three services: the static frontend (nginx/`80`), the Express API
(`project-helper-api`, `3000`), and **Caddy** as the HTTPS reverse proxy (`443`). Caddy
routes `/api/*` → API container and everything else → frontend, and terminates TLS with an
internal cert (`tls internal`). Edit the IP/host in `Caddyfile` for your server. Note
`Caddyfile` also has HTTP basic auth enabled.

**`default_sni` in the global block is what makes the site reachable from a browser** — do not
remove it. Browsers send **no SNI when the address is an IP literal** (RFC 6066 allows host
names only), and with `tls internal { on_demand }` a no-SNI connection makes Caddy issue for the
connection's *local* address — which, inside Docker, is the container IP (`172.18.0.4`). The
browser then got a cert named `IP:172.18.0.4` for a URL of `10.178.21.120` and refused with
`ERR_CERT_COMMON_NAME_INVALID`. **Every script check passed the whole time** (`curl` and
`openssl -servername` do send SNI), so this failed in exactly the place automation could not
see. `verify-deploy.sh` [13] now connects with `-noservername` and asserts the SAN contains the
host. Override the name with `SITE_HOST` on the caddy container; it is deliberately *not* wired
into `docker-compose.yml`, because an empty value there would leave `default_sni` blank and
break startup.

Trusting the cert is a **separate** problem from naming it — fixing one does not fix the other.
Chromium/Electron on Linux reads user CAs from `~/.pki/nssdb` (not `/etc/ssl/certs`), so per
client machine:

```bash
sudo apt install libnss3-tools                         # certutil
sudo docker cp caddy-https:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n caddy-local-2026 -i /tmp/caddy-root.crt
```

The root is valid to 2036; the 12-hour leaf certs Caddy issues under it renew themselves, so
this is a one-time step. Firefox has its own store and needs its own import.

**`/api/health` is the one path exempt from basicauth** (`@needs_auth not path /api/health`) —
it is not an oversight. `basic_auth`'s 401 does not carry the `header` block (Caddy behaviour,
unchanged by `route` ordering), so without an unauthenticated 200 there was **no response the
security-header checks could look at**, and `verify-deploy.sh` skipped that whole section unless
someone typed the password — i.e. nobody verified the headers on a normal deploy. The exemption
is an **exact** path match (`/api/health/` and every data route still 401, asserted in
`verify-deploy.sh` [2]) and the body is only `{ok, time}`. Never widen the matcher to `/api/*`;
that opens the timeline data.

**`npm run verify` cannot see inside the Docker images** — unit/server/E2E all read host
sources, so a `COPY` missing from a Dockerfile is green everywhere and only surfaces at deploy
time (it happened twice: `0fca603`, and 2026-08-18 with `server/services/`). The `docker-smoke`
CI job is the only gate for that class: it builds both images, boots them, and probes
`/api/health` · `/api/projects` · `/api/tasks` plus the frontend's `index.html`/`assets/*.js`.
If you add a runtime directory, fix the Dockerfile `COPY` list too.

**Never run `docker compose down -v`** (or otherwise prune volumes): the `api_data` named
volume mounted at `/app/data` in the API container holds live production timeline data.
`start_server.sh` deliberately runs `down --remove-orphans` without `-v`. Compose commands in
this project need `sudo`.

**운영 API에 쓰기 요청을 보내지 마라.** 2026-08-05 실사 중 검증 없는 `POST /api/data` 로
운영 데이터가 소실됐다(`docs/TECHNICAL_DUE_DILIGENCE.md` 부록 A). 그 경로는 이후 차단됐지만,
운영은 테스트 환경이 아니다. 쓰기 검증이 필요하면 `PH_DATA_DIR` 로 격리한 로컬 인스턴스를 쓴다.

데이터 보호 장치는 3중이다: ① `scripts/backup-data.sh` 일일 볼륨 백업(크론 03:00, 14일 보관)
② `store.js` 의 쓰기 전 세대 백업(`data.json.bak.1~5`, 10분 간격 + 트리가 절반 이하로
줄어드는 파괴적 쓰기는 간격 무시하고 보존) ③ `validateTaskTree()` 로 라우트 검증 +
`writeTasks()` 의 배열 타입 가드(라우트를 우회한 경로도 막는다).

여기에 **추적** 장치가 하나 더 있다(복구 수단은 아니다): `lib/eventLog.js` 가 프로젝트별
append-only 로그 `data/projects/<pid>/events.jsonl` 에 모든 쓰기를 한 줄씩 남긴다 —
`{ts, actor, op, revision, nodes, prevNodes}`. `store.writeTasks`/`writeSnapshots` 가 유일한
기록 지점이고, 컨텍스트(`actor`/`op`)는 `index.js` 미들웨어가 `getProjectStore(pid, ctx)` 로
주입한다. 읽기는 `GET /api/projects/:pid/events?limit=50`. 로그 실패가 쓰기를 실패시키지
않는다(warn 만 남기고 삼킨다).

## Architecture

Client-heavy React 18 + Vite SPA with a thin Express persistence backend.

### Storage is a localStorage-cache + server-sync hybrid — this is the most important thing to understand

`src/utils/storage.js` is the single source of truth for persistence. It is NOT
localStorage-only:

- **Reads** (`loadData`/`loadSettings`/`loadSnapshots`): try the server (`/api/*`) first,
  refresh the localStorage cache on success, and **fall back to localStorage** on any network
  error. So the app keeps working offline.
- **Writes** (`saveData`/`saveSettings`): write localStorage **immediately (synchronously)**,
  then send to the server; a failed server write never blocks the UI.
- `App.jsx` **debounces `saveData` by 1.5s** (auto-save `useEffect`) to avoid a server
  request per keystroke/drag. Settings changes call `storage.saveSettings` directly.
- **A failed `saveData` is surfaced and retried — it is not just logged.**
  `features/projects/syncStatus.js` owns the whole judgement (pure): the phase machine
  (`nextSyncState`: saved/pending/saving/error), the backoff (`retryDelay`, 2s→60s), and the
  display wording (`describeSyncState`). `useProjectSync` wires it and `SyncIndicator` (header,
  next to the project name) draws it — colour **plus** icon **plus** text, and the error state
  is a button that retries immediately. Three consequences hang off `hasUnsavedEdits()`:
  the revision poll **skips reloading** while edits are unsaved (reloading there would silently
  discard them — the reload also sets `skipNextSave`), `beforeunload` warns, and a failed
  project-switch flush keeps the dirty state and toasts. Sync state resets per project on
  switch. `savingRef` prevents the debounce and retry timers from double-sending (the late one
  would get a stale `If-Match` → 409 → a bogus "changed externally" toast).
- **Revision-based sync with external (AI) writers**: every server mutation bumps a revision
  counter (`server/data/meta.json`). The browser sends `If-Match: <revision>` on save — a 409
  means an external writer (AI) changed data first, and the app reloads server state
  (server-wins, via `setTasksSilent` so undo history isn't polluted). A 10s polling effect
  on `GET /api/revision` picks up external changes in open tabs.
- API base is `/api`: dev uses the Vite proxy to :3000 (vite.config.js), prod uses Caddy.
- **Cache keys are project-scoped, settings are not**: `project-timeline-data:<pid>` and
  `project-timeline-snapshots:<pid>` per project, but `project-timeline-settings` is a single
  global blob (server-side too — `GET/POST /api/settings` is outside the project scope). The
  active project id lives in `project-timeline-active-project`. storage.js runs a one-time
  migration of the old suffix-less keys to `:default` at module load.

The server (`server/`) is a small CommonJS Express app. **Data is multi-project** (v1.5):
`server/data/projects/<pid>/{data,meta,snapshots}.json` + `events.jsonl` + `projects.json` registry, with
per-project revision counters. Routers get `req.projectStore` injected by middleware and are
mounted twice: `/api/projects/:pid/*` (scoped) and `/api/*` (alias → 'default' project,
backward compat). Key modules: `routes/tasks.js` (per-task CRUD, validated, 409 on If-Match
mismatch), `routes/data.js` (blob+snapshots), `routes/projects.js`, `lib/store.js`
(`getProjectStore(pid)`, atomic writes + revision), `lib/registry.js` (project CRUD +
legacy migration on boot), `lib/taskTree.js` (**partial CJS port of the client tree helpers —
overlapping functions must stay behavior-compatible**; note it also owns `createNewTask`, which
on the client lives in `dataModel.js` and takes different args, plus server-only `flattenAll`/
`findTask`), `lib/validate.js`, `lib/eventLog.js` (append-only 감사 로그), `lib/aiGuide.js`
(machine-readable guide at `GET /api/guide`).
**Dependency integrity is enforced server-side too**: `findDependencyIssues`/
`wouldCreateDependencyCycle` are mirrored in `lib/taskTree.js` (same return shape as the
client's — keep them in sync), `taskService` rejects unknown-id and cycle-closing
`dependencies` on time-range writes (400), and `GET /api/projects/:pid/dependency-issues`
reports what a single write can't judge (schedule violations, dangling refs). The blob
`POST /api/data` is deliberately *not* gated on cycles — it is also the browser's save path,
and rejecting it would lock a user out of fixing pre-existing data.
**Deletes prune the references to what they removed** (`collectOwnedIds` + `pruneDependencies`,
mirrored on both sides): deleting a task/time-range/milestone strips every `dependencies` entry
pointing at it, in the same write, so dangling refs are no longer created. `deleteFromTree`
itself is *not* where this lives — `moveTask` uses it to remove-then-reinsert, and pruning there
would make moving a task destroy its dependencies. Dangling refs that remain come from writes
that bypass those paths (blob `POST /api/data`, imports, pre-existing data); the inspector's
cleanup button and `GET .../dependency-issues` still surface them.
**Merge-import is the one place ids are rewritten** (`regenerateIds`, client-only — the server has
no import): it reissues task **and** time-range **and** milestone ids, then relinks every
`dependencies` entry through the old→new map, dropping refs that point outside the imported
bundle. Skipping either half cross-links the copy's arrows onto the originals.
No database. Auth is Caddy basicauth; the authenticated user is forwarded as `X-Auth-User` and
recorded (owner/createdBy) but not yet enforced.

**Frontend project switching** (App.jsx `handleSwitchProject`) is order-sensitive: cancel
pending debounce → flush if dirty → `storage.setProject` (bumps epoch, guards stale
responses) → load + `resetTasks` (undo history reset — never skip this; stale history would
let Ctrl+Z restore another project's tree and auto-save it).

### AI integration surface

AI agents manipulate timeline data via per-task REST endpoints (`server/openapi.yaml` is the
spec) or the **MCP server** (`mcp/index.js`, 16 tools, registered via `.mcp.json` —
`list-tasks`/`add-task`/`reschedule`/`check-dependencies`/etc.; the 13 data tools take an
optional `projectId`, defaulting to the 'default' project).
See `docs/AI_INTEGRATION.md` and the `timeline-api` skill. Prefer per-task endpoints over blob `POST /api/data`.

### State management (`src/App.jsx`, ~1000 lines — the hub)

`App.jsx` owns essentially all state and passes handlers down. Key pieces:

- **`useUndoRedo(tasks)`** (`src/shared/hooks/useUndoRedo.js`) holds the entire task tree with history
  (max 20 entries). Use `setState(fn)` for user actions that should be undoable; use
  **`setStateSilent(fn)`** for transient states like mid-drag updates that must NOT pollute
  history. The whole judgement (push vs overwrite, the 20-entry cap, gesture coalescing) is
  the pure `shared/hooks/undoHistory.js`; the hook only resolves function updaters.
- **A continuous control must name its gesture, or it eats the whole history.** History is 20
  entries, so one progress-slider drag (`step=5` → up to 21 events), one drag inside the native
  colour dialog, or one held `]` key (browser auto-repeat, tens of events per second) used to
  push every event as its own entry — the user's previous 20 edits were gone and undo just
  crawled back 5%/one day at a time. Text inputs dodge this by committing on blur/Enter
  (`DraftField`); dragged controls have no such moment, so they pass a **gesture key** as the
  last argument (`actions.updateTask(id, updates, 'progress:<id>')`, `ColorPicker`'s
  `gestureKey` prop, `e.repeat ? 'shift:<id>' : null` in `useTaskKeyboard`) and consecutive
  writes under the same key within `COALESCE_WINDOW_MS` (600ms) overwrite one entry instead of
  adding one. Undo then lands **before** the gesture. Discrete actions pass nothing — clicking
  two colour chips is two edits, and undo/redo/silent writes end any gesture in progress.
- **`useToast()`** (`src/shared/hooks/useToast.js`) — always use `toast.success/error/warn/info`
  instead of `alert()`.
- **Collapsing a branch goes through one gate — `App.handleToggleExpand`.** Two things differ
  by context and both are easy to get wrong. (1) While searching, `filterTasksByQuery` force-
  expands ancestors to reveal matches, so a write to the tree's `expanded` is invisible on
  screen and only dirties the document; that collapse is view state instead
  (`uiStore.searchCollapsedIds`, dropped when the query is cleared) and the filter takes it as
  its third argument. The stored flag cannot tell "collapsed before the search" (must be
  re-expanded) from "collapsed just now" (must be honoured) — that is why the set exists.
  (2) Outside search it writes the tree **silently** (`updateTaskSilent`): collapsing is
  visual state, and history is 20 entries deep, so collapses would push out the edit the user
  actually wants to undo.
- **Drag placement is judged against what is on screen, not against the stored tree.**
  `moveTaskInTree(tasks, activeId, overId, viewTasks)` and `indentTask(items, taskId, viewTasks)`
  take the rendered list as their last argument, and `App.handleMoveTask`/`handleIndentTask` are
  the one gate that passes `filteredTasks` (identical to `tasks` when not searching, so no
  branch is needed). While searching the two differ: the filter force-expands ancestors, so a
  task that `flattenTasks(tasks)` skips (collapsed branch) is still draggable — judging from the
  tree made that drag a **silent no-op**, and indent nested the task under a sibling the user
  could not see. `outdentTask` needs no view: "become the parent's next sibling" is the same
  either way. For the same reason the drag-start auto-collapse (`TableView`/`TimelineView`) is
  skipped while searching — it has no visible effect there and its restore flipped the stored
  `expanded` to `true`.
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
- Besides `timeRanges`, a task carries `milestones: [{ id, date, label, color, shape }]`
  (`shape`: diamond|circle|triangle|square), `progress` (0–100), and
  `divider: { enabled, thickness, style, color }`.
- **Dates are always `YYYY-MM-DD` strings** — never `Date` objects in stored data. Use
  `formatDate()` (dataModel.js) or `dateUtils` (dateUtils.js).
- **All ids come from `generateId()`** — tasks, time ranges, and milestones alike.
- **A time range never ends before it starts.** A reversed range is invisible on the chart
  (`getDuration` returns 0 → a 0px bar), so every write path enforces the order: dragging
  stops at the boundary (`TimelineBar`), the keyboard clamps (`shiftTaskDates`), the server
  rejects with 400 (`taskService`), and typed dates go through **`patchRange`**, which applies
  the pure `orderRangeDates()` — it pulls back **only the endpoint you just edited**, never the
  one you left alone. Edit range dates through `patchRange`, not an inline `map`. Reversed
  ranges that arrive by other routes (blob `POST /api/data`, imports, old data) are *not*
  rewritten; the inspector's range card flags them instead.

### Component conventions

- **Source layout is feature-first** (`src/features/<name>/`): `shell` (Header/Toolbar/
  DisplayOptionsMenu), `table`, `timeline`, `tasks`, `projects`, `io`. A feature folder holds
  its components, its hooks, and any util used *only* by it (e.g. `timelineGeometry.js`,
  `htmlExporter.js`). Cross-feature pieces live in `src/shared/ui/` (Modal, Toast, Tooltip,
  ColorPicker, ErrorBoundary), `src/shared/hooks/` (useUndoRedo, useToast), and
  `src/shared/keyboard.js` (window-level key policy — see below).
  `src/utils/` keeps only the domain core every layer uses — `dataModel`, `taskTree`,
  `dateUtils`, `storage`. There is no `src/components/` or top-level `src/hooks/` anymore.
- Each component is a `Foo.jsx` + `Foo.css` pair. **Vanilla CSS only** — no CSS-in-JS, no
  utility framework.
- **Every overlay goes through `shared/ui/Modal`** — it owns Escape, overlay click, the
  `.modal-overlay` class that `useTaskKeyboard`'s `hasOverlay()` checks, *and focus*
  (entry / Tab trap / restore to the opener, via the pure `shared/ui/focusTrap.js`). Rolling
  your own shell means those five things diverge per modal — they used to. A child that wants
  focus can just grab it in its own effect (the palette input does); Modal only steps in if
  focus is still outside the dialog. A child that wants `Tab` for itself calls
  `preventDefault()` and the trap stands down.
- **Window-level keyboard policy lives in `src/shared/keyboard.js`** — both `window` keydown
  listeners (global shortcuts in `App.jsx`, selected-task keys in `useTaskKeyboard`) get their
  guards from it, because a guard that exists in two places gets fixed in one. The pure
  `resolveGlobalShortcut(event, {textEditing, overlay})` owns the whole keymap and answers
  "which command, if any" — **the caller `preventDefault()`s only when a command comes back**,
  so a `Ctrl+Z` we decline stays the input's. Two rules it encodes: commands that mutate the
  tree (undo/redo/addTask) don't fire while a text input has focus or a modal is open; commands
  that don't (palette/export) always fire. Keys are matched case-insensitively — `Shift` and
  `CapsLock` deliver `key` as `'Z'`, and the old `key === 'z'` checks silently died under both.
  Add new global shortcuts to `KEYMAP`, not to a new `if` in a component.
- Dark mode is done purely with the `[data-theme="dark"]` CSS selector — no JS theming for it.
  Chart color themes are separate, in `src/themes/`.
- Timeline drag-and-drop uses **@dnd-kit** (`TimelineView.jsx` / `TimelineBar.jsx`).
- **A dependency whose other end is off screen is still reported, never dropped.** Arrow
  endpoints sit on *rendered rows* (`itemAnchor` derives `y` from the row index), so an endpoint
  inside a collapsed branch or outside the search filter has no coordinate — the old
  `collectLinks` just skipped it, which made "connection deleted" and "connection hidden" look
  identical. `features/timeline/dependencyLinks.js` (pure) resolves each edge against the
  **whole tree**, which `TimelineView` gets as `allTasks` (its `tasks` prop is filtered):
  an endpoint with a visible ancestor is *rolled up* to that ancestor's row (x stays the hidden
  item's own date, so only `y` moves — the usual Gantt summary-bar behaviour), and one with no
  visible ancestor at all gets a marker on the surviving end instead. Both carry the
  counterpart's **name** for the tooltip; that name is the only way to read which descendant a
  rolled-up line belongs to. Two deliberate silences: edges whose ends roll up to the *same*
  row aren't drawn (unreadable, and expanding reveals them), and a dangling ref never becomes a
  "hidden" marker — `findDependencyIssues` owns that diagnosis. The set of edges collected is
  unchanged (range- and milestone-held `dependencies` only; task-level ones stay legacy).
- **The table says a connection exists; the inspector is still the only place to edit one.**
  Dependencies used to live only on the timeline (arrows) and in the inspector, so a table-only
  user could not tell a linked task from an unlinked one. `features/table/dependencyBadges.js`
  (pure) folds the whole tree's edges onto the *rendered rows* — `summarizeRowDependencies(
  allTasks, visibleIds, dependencyIssues)` → `Map<rowId, {predecessors, successors, broken,
  issue}>`, and `TaskRow` draws the counts (`←n →n`) plus the worst issue (cycle > overlap >
  broken, icon **and** colour). Same rules as the arrows, for the same reason: edges held by a
  hidden descendant roll up to the nearest visible ancestor row (carrying that descendant's name
  as `via`, so the tooltip can say whose connection it is), edges whose ends land on the same
  row aren't counted, and the edge list comes from `findDependencyIssues` rather than being
  re-derived — two derivations would let the table and the inspector disagree. Clicking a badge
  goes through `App.handleOpenDependencies` → `focusInInspector(taskId)`, the same gate the
  milestone column uses; it clears the range/milestone focus because a task-level badge does not
  name one. A row with no edges renders `—`, not an empty cell.
- **Collapsing a branch hides its rows, not its schedule.** `flattenTasks` only looks at
  `expanded`, so a collapsed branch's descendants have no row to draw on — while
  `computeDateRange` still walks them and keeps the axis space. The result was a stretch of
  empty chart, and *"has no schedule"* and *"is collapsed"* looked identical (a group task with
  no dates of its own left the row completely blank; since the arrow roll-up above, an arrow
  could point at that empty row). `features/timeline/rollupBars.js` (pure) answers it per row:
  `resolveRollup(task)` → `{segments, milestones, taskCount}` or `null`, and `TimelineBar` draws
  the segments as thin hatched bars **on top of** the real bar (z-index 30 — behind it they were
  entirely covered whenever the parent's own range spanned its children) plus hollow diamonds for
  the hidden milestones. Three judgements worth keeping: overlapping/touching intervals merge but
  **gaps stay gaps** (one bar from January to December would assert work that isn't there — worse
  than hiding it), each segment and marker carries the descendant's **name** in its `title`
  because that is the only way to read whose schedule it is, and the roll-up is **not editable** —
  clicking selects the representing row, since one bar covering several tasks can't say what a
  drag should move. Unlike the dependency roll-ups it is judged against the **rendered** tree
  (`TimelineView`'s `tasks`, i.e. `filteredTasks`), not `allTasks`: reviving search-filtered
  tasks on an ancestor row would invert "show me only these". A connection is a fact; a filter is
  a request.
- `htmlExporter.js` generates a **self-contained interactive HTML** export of the timeline.

### Tree-update invariants (critical for correctness)

Because the tree feeds undo/redo history, **never mutate task objects in place**. Use the
pure helpers in **`src/utils/taskTree.js`** (`updateTaskInTree`, `deleteFromTree`,
`findTaskAndParent`, `indentTask`, `outdentTask`, `recalcTaskBounds*`, `findOwnerOfEntity`,
…) — don't reimplement tree recursion inline. Deep-clone with `structuredClone`, not
`JSON.parse(JSON.stringify(...))`. `filteredTasks` in `App.jsx` is a `useMemo` **value** —
reference it as `filteredTasks`, not `filteredTasks()`. If you change a taskTree.js
signature, update its CJS counterpart `server/lib/taskTree.js` too.
