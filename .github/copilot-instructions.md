# Copilot Instructions

## Commands

```bash
npm run dev      # Dev server with hot-reload at http://localhost:5173
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

No test suite or linter is configured. Always verify changes with `npm run build`.

## Architecture

This is a **pure client-side React 18 + Vite SPA** with no backend. All data lives in `localStorage`.

### State Management

All task state flows through `App.jsx` via the `useUndoRedo` hook (`src/hooks/useUndoRedo.js`):

- **`setState`** — records a new history entry (use for user actions)
- **`setStateSilent`** — mutates current entry without recording (use for drag intermediate states)
- History is capped at 20 entries

### Data Model

Tasks form a **recursive tree** (`task.children[]`). Key fields on each task:

| Field | Notes |
|---|---|
| `timeRanges[]` | Array of `{ id, startDate, endDate, dependencies[], color, label }` — primary date data |
| `milestones[]` | `{ id, date, label, color, shape: 'diamond'\|'circle'\|'triangle'\|'square' }` |
| `dependencies[]` | Always `[]`; range-level deps live in `timeRanges[n].dependencies` |
| `children[]` | Sub-tasks (recursive) |
| `divider` | `{ enabled, thickness, style, color }` — visual separator below the row |

**Important:** `startDate` / `endDate` at the task level are **legacy**. Use `timeRanges` exclusively.

`migrateTaskData()` in `src/utils/dataModel.js` upgrades old data on load (called automatically in `App.jsx` and for sample data).

### localStorage Keys

| Key | Contents |
|---|---|
| `project-timeline-data` | Active task tree |
| `project-timeline-settings` | UI settings (timeScale, zoomLevel, darkMode, etc.) |
| `project-timeline-snapshots` | Named save slots |

### View Modes

`App.jsx` holds a `viewMode` state: `'table'`, `'timeline'`, or `'split'`.  
`filteredTasks` is a `useMemo`-derived variable (not a function) — reference as `filteredTasks`, never call as `filteredTasks()`.

### Component Structure

Each component has a paired CSS file (`Foo.jsx` + `Foo.css`). Major components:

- **`TableView`** — spreadsheet-like hierarchical list with inline editing
- **`TimelineView`** — Gantt chart with `@dnd-kit` drag-to-reorder and drag-to-resize bars
- **`TimelineBar`** — individual Gantt bar; drag handles for start/end date
- **`TimelineBarPopover`** — right-click context menu on bars
- **`Header`** / **`Toolbar`** — top controls and view switcher
- **`SaveLoadModal`** — named snapshot management (localStorage)
- **`ImportExportModal`** — JSON and HTML export
- **`Toast`** — toast notification UI, driven by `useToast` hook

### Dark Mode

Applied via `data-theme="dark"` on `document.documentElement`. CSS variables in component `.css` files use `[data-theme="dark"]` selectors.

## Key Conventions

- **Date format**: always `YYYY-MM-DD` strings; use `formatDate()` from `src/utils/dataModel.js` or `dateUtils` from `src/utils/dateUtils.js`
- **ID generation**: `generateId()` → `task-${Date.now()}-${randomStr}`; use this for all new tasks, ranges, and milestones
- **Flat list for rendering**: `flattenTasks(tasks, level)` produces the visible ordered list with `level` for indentation; respects `expanded` flag
- **Task mutations**: always produce a new array/object using the `updateTaskInTree` recursive helper in `App.jsx` — never mutate objects in place
- **Task deletion**: use the immutable `deleteFromTree` pattern (filter + map recursion), never assign to `item.children` directly
- **New task shape**: create with `createNewTask(name, parentId)` from `src/utils/dataModel.js` — never construct task objects by hand
- **Deep clone**: use `structuredClone()`, never `JSON.parse(JSON.stringify())`
- **User notifications**: use `toast.success/error/warn/info()` from `useToast` — `alert()` is forbidden
- **Styling**: vanilla CSS only; no CSS-in-JS or utility framework

