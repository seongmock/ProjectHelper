// 작업 트리 도메인 로직. HTTP를 모른다 — express 없이 store만 주입하면 호출할 수 있다.
//
// 오류는 AppError로 던진다. store.withTasks 는 mutator를 동기 호출하고 반환값이
// 배열일 때만 저장하므로, mutator 안에서 throw 하면 **아무것도 쓰이지 않은 채**
// 예외가 빠져나간다. 예전 라우트가 쓰던 `failReason` 클로저 변수 패턴을 이걸로 대체했다.
const tree = require('../lib/taskTree');
const { validate } = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');

// ── 공통 ─────────────────────────────────────────────
// If-Match 리비전 검사 (헤더가 없으면 통과 — 하위호환)
const assertRevision = (store, ifMatch) => {
    if (ifMatch === undefined) return;
    const current = store.readMeta().revision;
    if (String(current) !== String(ifMatch).trim()) throw conflict();
};

const assertValid = (body, spec) => {
    const err = validate(body, spec);
    if (err) throw badRequest(err);
};

const clampPosition = (position, length) =>
    Number.isInteger(position) ? Math.max(0, Math.min(position, length)) : length;

const insertAt = (list, item, position) => {
    const next = [...list];
    next.splice(clampPosition(position, next.length), 0, item);
    return next;
};

// 반드시 트리를 변경한다고 기대되는 연산에서 저장이 일어나지 않았다면 버그다.
const mustWrite = (result) => {
    if (!result) throw notFound();
    return result;
};

// ── 조회 ─────────────────────────────────────────────
const getRevision = (store) => {
    const meta = store.readMeta();
    return { revision: meta.revision, updatedAt: meta.updatedAt };
};

const listTasks = (store, { flat = false } = {}) => {
    const tasks = store.readTasks();
    const revision = store.readMeta().revision;
    if (!flat) return { revision, tasks };
    // 평탄 목록에는 timeRanges에서 계산한 시작/종료일을 포함 (AI의 ID/일정 탐색용)
    return {
        revision,
        tasks: tree.flattenAll(tasks).map(t => ({ ...t, ...tree.recalcTaskBounds(t.timeRanges) })),
    };
};

const getTask = (store, id) => {
    const found = tree.findTaskAndParent(store.readTasks(), id);
    if (!found) throw notFound();
    return {
        revision: store.readMeta().revision,
        task: found.task,
        parentId: found.parent ? found.parent.id : null,
    };
};

// ── 작업 CRUD ────────────────────────────────────────
const CREATE_SPEC = {
    name: { type: 'string', required: true },
    parentId: { type: 'string', nullable: true },
    position: { type: 'int' },
    startDate: { type: 'date' },
    endDate: { type: 'date' },
    color: { type: 'color' },
    description: { type: 'string' },
    labels: { type: 'stringArray' },
};

const createTask = (store, body, ifMatch) => {
    assertValid(body, CREATE_SPEC);
    assertRevision(store, ifMatch); // 순서 유지: 기존 라우트도 날짜 검사보다 먼저 409를 냈다

    const { name, parentId = null, position, startDate, endDate, color, description, labels } = body;
    if ((startDate && !endDate) || (!startDate && endDate)) {
        throw badRequest('startDate and endDate must be provided together');
    }
    if (startDate && endDate && endDate < startDate) {
        throw badRequest('endDate must be >= startDate');
    }

    const newTask = tree.createNewTask(name, parentId, startDate, endDate);
    if (color) newTask.color = color;
    if (description !== undefined) newTask.description = description;
    if (labels) newTask.labels = labels;

    const result = mustWrite(store.withTasks((tasks) => {
        if (!parentId) {
            const next = [...tasks];
            next.splice(clampPosition(position, next.length), 0, newTask);
            return next;
        }
        const parent = tree.findTask(tasks, parentId);
        if (!parent) throw notFound('parent task');
        return tree.updateTaskInTree(tasks, parentId, {
            children: insertAt(parent.children || [], newTask, position),
            expanded: true,
        });
    }));

    return { revision: result.meta.revision, task: newTask };
};

const PATCH_SPEC = {
    name: { type: 'string' },
    color: { type: 'color' },
    description: { type: 'string' },
    expanded: { type: 'bool' },
    labels: { type: 'stringArray' },
    divider: { type: 'object' },
    progress: { type: 'int' },
};

const updateTask = (store, id, body, ifMatch) => {
    assertValid(body, PATCH_SPEC);
    if (Object.keys(body).length === 0) throw badRequest('empty update');
    if (body.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
        throw badRequest('progress must be 0-100');
    }
    assertRevision(store, ifMatch);

    let updated = null;
    const result = mustWrite(store.withTasks((tasks) => {
        if (!tree.findTask(tasks, id)) throw notFound();
        const next = tree.updateTaskInTree(tasks, id, body);
        updated = tree.findTask(next, id);
        return next;
    }));

    return { revision: result.meta.revision, task: updated };
};

const deleteTask = (store, id, ifMatch) => {
    assertRevision(store, ifMatch);
    const result = mustWrite(store.withTasks((tasks) => {
        if (!tree.findTask(tasks, id)) throw notFound();
        return tree.deleteFromTree(tasks, id);
    }));
    return { revision: result.meta.revision };
};

const moveTask = (store, id, body, ifMatch) => {
    assertValid(body, {
        parentId: { type: 'string', nullable: true, required: true },
        position: { type: 'int' },
    });
    assertRevision(store, ifMatch);

    const { parentId, position } = body;
    let moved = null;

    const result = mustWrite(store.withTasks((tasks) => {
        const found = tree.findTaskAndParent(tasks, id);
        if (!found) throw notFound();

        if (parentId !== null) {
            if (parentId === id || tree.isDescendant(found.task, parentId)) {
                throw badRequest('cannot move a task into its own subtree');
            }
            if (!tree.findTask(tasks, parentId)) throw notFound('parent task');
        }

        // 1) 원위치에서 제거 → 2) 새 위치에 삽입
        const without = tree.deleteFromTree(tasks, id);
        moved = { ...found.task, parentId };

        if (parentId === null) {
            const next = [...without];
            next.splice(clampPosition(position, next.length), 0, moved);
            return next;
        }
        const newParent = tree.findTask(without, parentId);
        return tree.updateTaskInTree(without, parentId, {
            children: insertAt(newParent.children || [], moved, position),
            expanded: true,
        });
    }));

    return { revision: result.meta.revision, task: moved };
};

// ── 기간(timeRange) ──────────────────────────────────
const RANGE_SPEC = {
    startDate: { type: 'date', required: true },
    endDate: { type: 'date', required: true },
    label: { type: 'string' },
    color: { type: 'color', nullable: true },
    dependencies: { type: 'stringArray' },
};

// timeRanges가 바뀌면 상위 startDate/endDate도 다시 계산해야 한다 (뷰가 이 값을 읽는다)
const withRecalcedBounds = (tasks, taskId, timeRanges) =>
    tree.updateTaskInTree(tasks, taskId, { timeRanges, ...tree.recalcTaskBounds(timeRanges) });

const addTimeRange = (store, id, body, ifMatch) => {
    assertValid(body, RANGE_SPEC);
    if (body.endDate < body.startDate) throw badRequest('endDate must be >= startDate');
    assertRevision(store, ifMatch);

    const newRange = {
        id: tree.generateId(),
        startDate: body.startDate,
        endDate: body.endDate,
        dependencies: body.dependencies || [],
        color: body.color ?? null,
        label: body.label || '',
    };

    const result = mustWrite(store.withTasks((tasks) => {
        const task = tree.findTask(tasks, id);
        if (!task) throw notFound();
        return withRecalcedBounds(tasks, id, [...(task.timeRanges || []), newRange]);
    }));

    return { revision: result.meta.revision, timeRange: newRange };
};

const updateTimeRange = (store, id, rangeId, body, ifMatch) => {
    assertValid(body, {
        startDate: { type: 'date' },
        endDate: { type: 'date' },
        label: { type: 'string' },
        color: { type: 'color', nullable: true },
        dependencies: { type: 'stringArray' },
    });
    if (Object.keys(body).length === 0) throw badRequest('empty update');
    assertRevision(store, ifMatch);

    let updatedRange = null;
    const result = mustWrite(store.withTasks((tasks) => {
        const task = tree.findTask(tasks, id);
        if (!task) throw notFound();
        const ranges = task.timeRanges || [];
        const target = ranges.find(r => r.id === rangeId);
        if (!target) throw notFound('timeRange');

        const merged = { ...target, ...body };
        if (merged.endDate < merged.startDate) throw badRequest('endDate must be >= startDate');
        updatedRange = merged;

        return withRecalcedBounds(tasks, id, ranges.map(r => (r.id === rangeId ? merged : r)));
    }));

    return { revision: result.meta.revision, timeRange: updatedRange };
};

const deleteTimeRange = (store, id, rangeId, ifMatch) => {
    assertRevision(store, ifMatch);
    const result = mustWrite(store.withTasks((tasks) => {
        const task = tree.findTask(tasks, id);
        if (!task) throw notFound();
        const ranges = task.timeRanges || [];
        if (!ranges.some(r => r.id === rangeId)) throw notFound('timeRange');
        return withRecalcedBounds(tasks, id, ranges.filter(r => r.id !== rangeId));
    }));
    return { revision: result.meta.revision };
};

// ── 마일스톤 ─────────────────────────────────────────
const addMilestone = (store, id, body, ifMatch) => {
    assertValid(body, {
        date: { type: 'date', required: true },
        label: { type: 'string' },
        color: { type: 'color' },
        shape: { enum: ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'] },
    });
    assertRevision(store, ifMatch);

    const milestone = {
        id: tree.generateId(),
        date: body.date,
        label: body.label || '',
        color: body.color || '#5CB85C',
        shape: body.shape || 'diamond',
    };

    const result = mustWrite(store.withTasks((tasks) => {
        const task = tree.findTask(tasks, id);
        if (!task) throw notFound();
        return tree.updateTaskInTree(tasks, id, {
            milestones: [...(task.milestones || []), milestone],
        });
    }));

    return { revision: result.meta.revision, milestone };
};

const deleteMilestone = (store, id, milestoneId, ifMatch) => {
    assertRevision(store, ifMatch);
    const result = mustWrite(store.withTasks((tasks) => {
        const task = tree.findTask(tasks, id);
        if (!task) throw notFound();
        const milestones = task.milestones || [];
        if (!milestones.some(m => m.id === milestoneId)) throw notFound('milestone');
        return tree.updateTaskInTree(tasks, id, {
            milestones: milestones.filter(m => m.id !== milestoneId),
        });
    }));
    return { revision: result.meta.revision };
};

module.exports = {
    assertRevision,
    getRevision,
    listTasks,
    getTask,
    createTask,
    updateTask,
    deleteTask,
    moveTask,
    addTimeRange,
    updateTimeRange,
    deleteTimeRange,
    addMilestone,
    deleteMilestone,
};
