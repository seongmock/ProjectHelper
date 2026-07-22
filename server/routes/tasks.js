// 작업 단위 CRUD API — AI 에이전트가 트리 전체를 다루지 않고 개별 작업을 조작할 수 있게 한다.
// 응답: 성공 { ok:true, revision, ... } / 오류 { ok:false, error, revision? }
// 모든 변경 요청은 선택적 If-Match 헤더(리비전)를 지원 — 불일치 시 409.
const express = require('express');
const store = require('../lib/store');
const tree = require('../lib/taskTree');
const { validate } = require('../lib/validate');

const router = express.Router();

// If-Match 리비전 검사 (없으면 통과 — 하위호환)
const checkRevision = (req, res) => {
    const ifMatch = req.get('If-Match');
    if (ifMatch === undefined) return true;
    const current = store.readMeta().revision;
    if (String(current) !== ifMatch.trim()) {
        res.status(409).json({ ok: false, error: 'revision mismatch', revision: current });
        return false;
    }
    return true;
};

const notFound = (res, what = 'task') =>
    res.status(404).json({ ok: false, error: `${what} not found`, revision: store.readMeta().revision });

const badRequest = (res, error) =>
    res.status(400).json({ ok: false, error, revision: store.readMeta().revision });

// ── 리비전 폴링 ──────────────────────────────────────
router.get('/revision', (req, res) => {
    const meta = store.readMeta();
    res.json({ ok: true, revision: meta.revision, updatedAt: meta.updatedAt });
});

// ── 작업 목록 ────────────────────────────────────────
router.get('/tasks', (req, res) => {
    const tasks = store.readTasks();
    const revision = store.readMeta().revision;
    if (req.query.flat === 'true') {
        // 평탄 목록에는 timeRanges에서 계산한 시작/종료일을 포함 (AI의 ID/일정 탐색용)
        const flat = tree.flattenAll(tasks).map(t => ({
            ...t,
            ...tree.recalcTaskBounds(t.timeRanges),
        }));
        return res.json({ ok: true, revision, tasks: flat });
    }
    res.json({ ok: true, revision, tasks });
});

// ── 작업 단건 조회 ───────────────────────────────────
router.get('/tasks/:id', (req, res) => {
    const tasks = store.readTasks();
    const found = tree.findTaskAndParent(tasks, req.params.id);
    if (!found) return notFound(res);
    res.json({
        ok: true,
        revision: store.readMeta().revision,
        task: found.task,
        parentId: found.parent ? found.parent.id : null,
    });
});

// ── 작업 생성 ────────────────────────────────────────
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

router.post('/tasks', (req, res) => {
    const err = validate(req.body, CREATE_SPEC);
    if (err) return badRequest(res, err);
    if (!checkRevision(req, res)) return;

    const { name, parentId = null, position, startDate, endDate, color, description, labels } = req.body;
    if ((startDate && !endDate) || (!startDate && endDate)) {
        return badRequest(res, 'startDate and endDate must be provided together');
    }
    if (startDate && endDate && endDate < startDate) {
        return badRequest(res, 'endDate must be >= startDate');
    }

    const newTask = tree.createNewTask(name, parentId, startDate, endDate);
    if (color) newTask.color = color;
    if (description !== undefined) newTask.description = description;
    if (labels) newTask.labels = labels;

    let created = null;
    const result = store.withTasks((tasks) => {
        if (parentId) {
            const parent = tree.findTask(tasks, parentId);
            if (!parent) return undefined; // 저장 안 함
            created = newTask;
            return tree.updateTaskInTree(tasks, parentId, {
                children: insertAt(parent.children || [], newTask, position),
                expanded: true,
            });
        }
        created = newTask;
        const next = [...tasks];
        next.splice(clampPosition(position, next.length), 0, newTask);
        return next;
    });

    if (!result || !created) return notFound(res, 'parent task');
    res.status(201).json({ ok: true, revision: result.meta.revision, task: newTask });
});

const clampPosition = (position, length) =>
    Number.isInteger(position) ? Math.max(0, Math.min(position, length)) : length;

const insertAt = (list, item, position) => {
    const next = [...list];
    next.splice(clampPosition(position, next.length), 0, item);
    return next;
};

// ── 작업 부분 수정 ───────────────────────────────────
const PATCH_SPEC = {
    name: { type: 'string' },
    color: { type: 'color' },
    description: { type: 'string' },
    expanded: { type: 'bool' },
    labels: { type: 'stringArray' },
    divider: { type: 'object' },
    progress: { type: 'int' },
};

router.patch('/tasks/:id', (req, res) => {
    const err = validate(req.body, PATCH_SPEC);
    if (err) return badRequest(res, err);
    if (Object.keys(req.body).length === 0) return badRequest(res, 'empty update');
    if (req.body.progress !== undefined && (req.body.progress < 0 || req.body.progress > 100)) {
        return badRequest(res, 'progress must be 0-100');
    }
    if (!checkRevision(req, res)) return;

    let updated = null;
    const result = store.withTasks((tasks) => {
        const found = tree.findTask(tasks, req.params.id);
        if (!found) return undefined;
        const next = tree.updateTaskInTree(tasks, req.params.id, req.body);
        updated = tree.findTask(next, req.params.id);
        return next;
    });

    if (!result) return notFound(res);
    res.json({ ok: true, revision: result.meta.revision, task: updated });
});

// ── 작업 삭제 (서브트리 포함) ────────────────────────
router.delete('/tasks/:id', (req, res) => {
    if (!checkRevision(req, res)) return;

    let existed = false;
    const result = store.withTasks((tasks) => {
        if (!tree.findTask(tasks, req.params.id)) return undefined;
        existed = true;
        return tree.deleteFromTree(tasks, req.params.id);
    });

    if (!result || !existed) return notFound(res);
    res.json({ ok: true, revision: result.meta.revision });
});

// ── 작업 이동 (재부모화 / 순서 변경) ─────────────────
router.post('/tasks/:id/move', (req, res) => {
    const err = validate(req.body, {
        parentId: { type: 'string', nullable: true, required: true },
        position: { type: 'int' },
    });
    if (err) return badRequest(res, err);
    if (!checkRevision(req, res)) return;

    const { parentId, position } = req.body;
    let moved = null;
    let failReason = null;

    const result = store.withTasks((tasks) => {
        const found = tree.findTaskAndParent(tasks, req.params.id);
        if (!found) { failReason = 'task not found'; return undefined; }

        if (parentId !== null) {
            if (parentId === req.params.id || tree.isDescendant(found.task, parentId)) {
                failReason = 'cannot move a task into its own subtree';
                return undefined;
            }
            if (!tree.findTask(tasks, parentId)) { failReason = 'parent task not found'; return undefined; }
        }

        // 1) 원위치에서 제거
        const without = tree.deleteFromTree(tasks, req.params.id);
        const movedTask = { ...found.task, parentId };
        moved = movedTask;

        // 2) 새 위치에 삽입
        if (parentId === null) {
            const next = [...without];
            next.splice(clampPosition(position, next.length), 0, movedTask);
            return next;
        }
        const newParent = tree.findTask(without, parentId);
        return tree.updateTaskInTree(without, parentId, {
            children: insertAt(newParent.children || [], movedTask, position),
            expanded: true,
        });
    });

    if (!result) {
        if (failReason === 'cannot move a task into its own subtree') return badRequest(res, failReason);
        return notFound(res, failReason === 'parent task not found' ? 'parent task' : 'task');
    }
    res.json({ ok: true, revision: result.meta.revision, task: moved });
});

// ── 기간(timeRange) CRUD ─────────────────────────────
const RANGE_SPEC = {
    startDate: { type: 'date', required: true },
    endDate: { type: 'date', required: true },
    label: { type: 'string' },
    color: { type: 'color', nullable: true },
    dependencies: { type: 'stringArray' },
};

router.post('/tasks/:id/time-ranges', (req, res) => {
    const err = validate(req.body, RANGE_SPEC);
    if (err) return badRequest(res, err);
    if (req.body.endDate < req.body.startDate) return badRequest(res, 'endDate must be >= startDate');
    if (!checkRevision(req, res)) return;

    const newRange = {
        id: tree.generateId(),
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        dependencies: req.body.dependencies || [],
        color: req.body.color ?? null,
        label: req.body.label || '',
    };

    const result = store.withTasks((tasks) => {
        const task = tree.findTask(tasks, req.params.id);
        if (!task) return undefined;
        const timeRanges = [...(task.timeRanges || []), newRange];
        return tree.updateTaskInTree(tasks, req.params.id, {
            timeRanges,
            ...tree.recalcTaskBounds(timeRanges),
        });
    });

    if (!result) return notFound(res);
    res.status(201).json({ ok: true, revision: result.meta.revision, timeRange: newRange });
});

router.patch('/tasks/:id/time-ranges/:rangeId', (req, res) => {
    const err = validate(req.body, {
        startDate: { type: 'date' },
        endDate: { type: 'date' },
        label: { type: 'string' },
        color: { type: 'color', nullable: true },
        dependencies: { type: 'stringArray' },
    });
    if (err) return badRequest(res, err);
    if (Object.keys(req.body).length === 0) return badRequest(res, 'empty update');
    if (!checkRevision(req, res)) return;

    let updatedRange = null;
    let failReason = null;
    const result = store.withTasks((tasks) => {
        const task = tree.findTask(tasks, req.params.id);
        if (!task) { failReason = 'task'; return undefined; }
        const ranges = task.timeRanges || [];
        const target = ranges.find(r => r.id === req.params.rangeId);
        if (!target) { failReason = 'timeRange'; return undefined; }

        const merged = { ...target, ...req.body };
        if (merged.endDate < merged.startDate) { failReason = 'invalid-dates'; return undefined; }
        updatedRange = merged;

        const timeRanges = ranges.map(r => (r.id === req.params.rangeId ? merged : r));
        return tree.updateTaskInTree(tasks, req.params.id, {
            timeRanges,
            ...tree.recalcTaskBounds(timeRanges),
        });
    });

    if (!result) {
        if (failReason === 'invalid-dates') return badRequest(res, 'endDate must be >= startDate');
        return notFound(res, failReason || 'task');
    }
    res.json({ ok: true, revision: result.meta.revision, timeRange: updatedRange });
});

router.delete('/tasks/:id/time-ranges/:rangeId', (req, res) => {
    if (!checkRevision(req, res)) return;

    let failReason = null;
    const result = store.withTasks((tasks) => {
        const task = tree.findTask(tasks, req.params.id);
        if (!task) { failReason = 'task'; return undefined; }
        const ranges = task.timeRanges || [];
        if (!ranges.some(r => r.id === req.params.rangeId)) { failReason = 'timeRange'; return undefined; }

        const timeRanges = ranges.filter(r => r.id !== req.params.rangeId);
        return tree.updateTaskInTree(tasks, req.params.id, {
            timeRanges,
            ...tree.recalcTaskBounds(timeRanges),
        });
    });

    if (!result) return notFound(res, failReason || 'task');
    res.json({ ok: true, revision: result.meta.revision });
});

// ── 마일스톤 추가/삭제 ───────────────────────────────
router.post('/tasks/:id/milestones', (req, res) => {
    const err = validate(req.body, {
        date: { type: 'date', required: true },
        label: { type: 'string' },
        color: { type: 'color' },
        shape: { enum: ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'] },
    });
    if (err) return badRequest(res, err);
    if (!checkRevision(req, res)) return;

    const milestone = {
        id: tree.generateId(),
        date: req.body.date,
        label: req.body.label || '',
        color: req.body.color || '#5CB85C',
        shape: req.body.shape || 'diamond',
    };

    const result = store.withTasks((tasks) => {
        const task = tree.findTask(tasks, req.params.id);
        if (!task) return undefined;
        return tree.updateTaskInTree(tasks, req.params.id, {
            milestones: [...(task.milestones || []), milestone],
        });
    });

    if (!result) return notFound(res);
    res.status(201).json({ ok: true, revision: result.meta.revision, milestone });
});

router.delete('/tasks/:id/milestones/:milestoneId', (req, res) => {
    if (!checkRevision(req, res)) return;

    let failReason = null;
    const result = store.withTasks((tasks) => {
        const task = tree.findTask(tasks, req.params.id);
        if (!task) { failReason = 'task'; return undefined; }
        const milestones = task.milestones || [];
        if (!milestones.some(m => m.id === req.params.milestoneId)) { failReason = 'milestone'; return undefined; }
        return tree.updateTaskInTree(tasks, req.params.id, {
            milestones: milestones.filter(m => m.id !== req.params.milestoneId),
        });
    });

    if (!result) return notFound(res, failReason || 'task');
    res.json({ ok: true, revision: result.meta.revision });
});

module.exports = { router, checkRevision };
