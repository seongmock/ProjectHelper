// 작업 트리 도메인 로직. HTTP를 모른다 — express 없이 store만 주입하면 호출할 수 있다.
//
// 오류는 AppError로 던진다. store.withTasks 는 mutator를 동기 호출하고 반환값이
// 배열일 때만 저장하므로, mutator 안에서 throw 하면 **아무것도 쓰이지 않은 채**
// 예외가 빠져나간다. 예전 라우트가 쓰던 `failReason` 클로저 변수 패턴을 이걸로 대체했다.
//
// **변경 연산은 전부 OPS 표의 순수 변경자다** — `(tasks, args, out) => tasks`, store 를
// 모른다. 공개 함수는 그것을 withTasks 로 한 번 감싼 얇은 껍데기이고, `applyBatch` 는
// **같은 변경자들을 한 번의 withTasks 안에서 이어 붙인다**. 그래서 40개 op 이 리비전
// 하나·감사 한 줄·전부 아니면 전무가 된다. 변경자를 두 벌로 두면 batch 와 단건이
// 다른 판정을 하게 되고, 그 차이는 화면에 안 나온다.
const tree = require('../lib/taskTree');
const schedule = require('../lib/schedule');
const { validate, validateTaskTree } = require('../lib/validate');
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

// 의존성을 쓰기 전에 막는다 — 화면(useDependencyLink)이 하는 것과 같은 판정이다.
// 만든 뒤 경고로 알리는 것보다 낫다: 순환은 고치는 것 말고 할 일이 없고, 존재하지
// 않는 id 를 가리키는 참조는 어느 화면에도 안 나와 영원히 남는다.
// holderId 는 dependencies 를 **들고 있는 쪽**(후행)이다 — 간선은 dep → holder.
// tasks 는 변경 전 트리다. holder 의 기존 의존성은 전부 holder 로 들어오는 간선이라,
// 그것을 교체해도 holder 에서 나가는 경로(순환 판정이 보는 방향)는 달라지지 않는다.
// 한 항목이 들 수 있는 의존성 상한. 아래 반복문은 원소마다 트리를 BFS 하므로,
// 상한이 없으면 요청 하나가 서버를 붙잡아 둘 수 있다(중복 id 를 채우면 트리 크기와도
// 무관하게 늘어난다 — 그래서 Set 으로 한 번 걸러서 돈다).
const MAX_DEPENDENCIES = 200;

const assertDependenciesWritable = (tasks, holderId, dependencies) => {
    if (!dependencies || dependencies.length === 0) return;
    const known = new Set(tree.collectEntities(tree.flattenAll(tasks)).map(e => e.id));
    const { successors } = tree.findDependencyIssues(tasks);

    for (const depId of new Set(dependencies)) {
        if (!known.has(depId)) throw badRequest(`unknown dependency id: ${depId}`);
        if (tree.wouldCreateDependencyCycle(successors, depId, holderId)) {
            throw badRequest(`dependency would create a cycle: ${depId} -> ${holderId}`);
        }
    }
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

// 트리 전체의 의존성 문제를 훑는다 — 화면(타임라인 화살표·인스펙터 배지)이 보는 것과
// 같은 판정이다. 쓰기 전 차단(assertDependenciesWritable)이 막지 못하는 것들을 여기서 본다:
// 일정 위반, 그리고 끊어진 참조. 후자는 이제 삭제 경로가 스스로 정리하므로(pruneDependencies)
// 이 서비스를 거치지 않은 쓰기(blob POST /api/data·과거 데이터)가 남긴 것만 남는다.
// successors 는 Map 이라, edgeIssues 는 화살표 색을 정하는 화면 전용이라 응답에서 뺀다.
//
// **edges 를 함께 돌려준다** — 문제만 돌려주던 동안, MCP 만 쓰는 에이전트에게는 연결
// 그래프를 읽을 방법이 아예 없었다(평탄 목록은 dependencies 를 투영에서 떨어뜨린다).
// "문제 없음"과 "연결 없음"이 같은 응답으로 보이면 AI 는 확인할 길 없이 일정을 옮긴다.
const getDependencyIssues = (store) => {
    const tasks = store.readTasks();
    const { cycles, overlaps, dangling } = tree.findDependencyIssues(tasks);
    const entities = tree.collectEntities(tree.flattenAll(tasks));
    const byId = new Map(entities.map(e => [e.id, e]));
    const edges = [];
    for (const holder of entities) {
        for (const depId of holder.dependencies || []) {
            if (!byId.has(depId)) continue; // 끊어진 참조는 dangling 이 말한다
            edges.push({
                fromId: depId, fromName: byId.get(depId).name,
                toId: holder.id, toName: holder.name,
            });
        }
    }
    return { revision: store.readMeta().revision, edges, cycles, overlaps, dangling };
};

// ── 검증 스펙 ────────────────────────────────────────
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

const PATCH_SPEC = {
    name: { type: 'string' },
    color: { type: 'color' },
    description: { type: 'string' },
    expanded: { type: 'bool' },
    labels: { type: 'stringArray' },
    divider: { type: 'object' },
    progress: { type: 'int' },
};

const MOVE_SPEC = {
    parentId: { type: 'string', nullable: true, required: true },
    position: { type: 'int' },
};

const RANGE_SPEC = {
    startDate: { type: 'date', required: true },
    endDate: { type: 'date', required: true },
    label: { type: 'string' },
    color: { type: 'color', nullable: true },
    dependencies: { type: 'stringArray', max: MAX_DEPENDENCIES },
};

const RANGE_PATCH_SPEC = {
    startDate: { type: 'date' },
    endDate: { type: 'date' },
    label: { type: 'string' },
    color: { type: 'color', nullable: true },
    dependencies: { type: 'stringArray', max: MAX_DEPENDENCIES },
};

const SHAPES = ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'];
// 화면(InspectorPanel)이 고르게 하는 값과 같은 집합이다. 'auto' 는 배치를
// milestoneLabels.js 에 맡긴다는 뜻이고, 나머지는 겹침을 감수한 수동 지정이다.
const LABEL_POSITIONS = ['auto', 'top', 'bottom', 'left', 'right'];

const MILESTONE_SPEC = {
    date: { type: 'date', required: true },
    label: { type: 'string' },
    color: { type: 'color' },
    shape: { enum: SHAPES },
    labelPosition: { enum: LABEL_POSITIONS },
    dependencies: { type: 'stringArray', max: MAX_DEPENDENCIES },
};

const MILESTONE_PATCH_SPEC = {
    date: { type: 'date' },
    label: { type: 'string' },
    color: { type: 'color' },
    shape: { enum: SHAPES },
    labelPosition: { enum: LABEL_POSITIONS },
    dependencies: { type: 'stringArray', max: MAX_DEPENDENCIES },
};

// timeRanges가 바뀌면 상위 startDate/endDate도 다시 계산해야 한다 (뷰가 이 값을 읽는다)
const withRecalcedBounds = (tasks, taskId, timeRanges) =>
    tree.updateTaskInTree(tasks, taskId, { timeRanges, ...tree.recalcTaskBounds(timeRanges) });

const requireTask = (tasks, id) => {
    const task = tree.findTask(tasks, id);
    if (!task) throw notFound();
    return task;
};

const nonEmpty = (body) => {
    if (Object.keys(body).length === 0) throw badRequest('empty update');
};

// ── 순수 변경자 ──────────────────────────────────────
// check(body): 트리를 보지 않고 판정할 수 있는 것. **리비전 검사보다 먼저** 돈다
//   (기존 라우트의 400/409 순서를 그대로 지킨다 — 테스트가 그 순서를 본다).
// apply(tasks, args, out): 트리를 봐야 판정되는 것 + 실제 변경. args 는
//   { taskId, rangeId, milestoneId, body, options }.
const OPS = {
    'create-task': {
        spec: CREATE_SPEC,
        ids: [],
        apply(tasks, { body }, out) {
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
            out.task = newTask;

            if (!parentId) return insertAt(tasks, newTask, position);
            const parent = tree.findTask(tasks, parentId);
            if (!parent) throw notFound('parent task');
            return tree.updateTaskInTree(tasks, parentId, {
                children: insertAt(parent.children || [], newTask, position),
                expanded: true,
            });
        },
    },

    'update-task': {
        spec: PATCH_SPEC,
        ids: ['taskId'],
        check(body) {
            nonEmpty(body);
            if (body.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
                throw badRequest('progress must be 0-100');
            }
        },
        apply(tasks, { taskId, body }, out) {
            requireTask(tasks, taskId);
            const next = tree.updateTaskInTree(tasks, taskId, body);
            out.task = tree.findTask(next, taskId);
            return next;
        },
    },

    // 삭제 3종은 지운 id 를 가리키던 참조까지 같은 쓰기에서 걷어낸다 — 남겨 두면
    // 존재하지 않는 상대를 가리키는 dependencies 가 화면 어디에도 안 나온 채 영원히 남는다.
    'delete-task': {
        ids: ['taskId'],
        apply(tasks, { taskId }) {
            const task = requireTask(tasks, taskId);
            return tree.pruneDependencies(tree.deleteFromTree(tasks, taskId), tree.collectOwnedIds(task));
        },
    },

    'move-task': {
        spec: MOVE_SPEC,
        ids: ['taskId'],
        apply(tasks, { taskId, body }, out) {
            const { parentId, position } = body;
            const found = tree.findTaskAndParent(tasks, taskId);
            if (!found) throw notFound();

            if (parentId !== null) {
                if (parentId === taskId || tree.isDescendant(found.task, parentId)) {
                    throw badRequest('cannot move a task into its own subtree');
                }
                if (!tree.findTask(tasks, parentId)) throw notFound('parent task');
            }

            // 1) 원위치에서 제거 → 2) 새 위치에 삽입
            const without = tree.deleteFromTree(tasks, taskId);
            const moved = { ...found.task, parentId };
            out.task = moved;

            if (parentId === null) return insertAt(without, moved, position);
            const newParent = tree.findTask(without, parentId);
            return tree.updateTaskInTree(without, parentId, {
                children: insertAt(newParent.children || [], moved, position),
                expanded: true,
            });
        },
    },

    'add-time-range': {
        spec: RANGE_SPEC,
        ids: ['taskId'],
        check(body) {
            if (body.endDate < body.startDate) throw badRequest('endDate must be >= startDate');
        },
        apply(tasks, { taskId, body }, out) {
            const task = requireTask(tasks, taskId);
            const newRange = {
                id: tree.generateId(),
                startDate: body.startDate,
                endDate: body.endDate,
                dependencies: body.dependencies || [],
                color: body.color ?? null,
                label: body.label || '',
            };
            assertDependenciesWritable(tasks, newRange.id, newRange.dependencies);
            out.timeRange = newRange;
            return withRecalcedBounds(tasks, taskId, [...(task.timeRanges || []), newRange]);
        },
    },

    'update-time-range': {
        spec: RANGE_PATCH_SPEC,
        ids: ['taskId', 'rangeId'],
        check: nonEmpty,
        apply(tasks, { taskId, rangeId, body, options = {} }, out) {
            const task = requireTask(tasks, taskId);
            const ranges = task.timeRanges || [];
            const target = ranges.find(r => r.id === rangeId);
            if (!target) throw notFound('timeRange');

            const merged = { ...target, ...body };
            if (merged.endDate < merged.startDate) throw badRequest('endDate must be >= startDate');
            if (body.dependencies) assertDependenciesWritable(tasks, rangeId, body.dependencies);
            out.timeRange = merged;

            let next = withRecalcedBounds(tasks, taskId, ranges.map(r => (r.id === rangeId ? merged : r)));

            // 캐스케이드: 이 기간의 **종료일이 뒤로 밀린 만큼** 후행 전체를 같이 민다.
            // 앞당김(delta<0)은 전파하지 않는다 — 선행을 하루 줄였다고 후행 40개를
            // 당겨 놓으면 사용자가 손으로 잡아 둔 간격이 통째로 사라진다. 미는 쪽만
            // 사고를 막고, 당기는 쪽은 사고를 만든다.
            if (options.cascade) {
                const delta = schedule.diffDays(target.endDate, merged.endDate);
                if (delta > 0) {
                    const { successors } = tree.findDependencyIssues(tasks);
                    const moved = schedule.collectTransitiveSuccessors(successors, rangeId);
                    out.cascaded = [...moved];
                    out.cascadeDays = delta;
                    // 편집한 그 기간은 제외한다 — 작업 레벨 dependencies(레거시)가 있으면
                    // 후행 집합에 소유 작업이 되돌아오고, 그러면 방금 쓴 값이 delta 만큼
                    // 한 번 더 밀린 채 저장된다. 응답은 인자로 만들어지므로 200 이 저장소와
                    // 다른 날짜를 말하고, 되돌릴 근거가 응답 어디에도 남지 않는다.
                    next = schedule.shiftEntities(next, moved, delta, {
                        workdays: options.workdays,
                        exclude: new Set([rangeId]),
                    });
                } else {
                    out.cascaded = [];
                    out.cascadeDays = 0;
                }
            }
            return next;
        },
    },

    'delete-time-range': {
        ids: ['taskId', 'rangeId'],
        apply(tasks, { taskId, rangeId }) {
            const task = requireTask(tasks, taskId);
            const ranges = task.timeRanges || [];
            if (!ranges.some(r => r.id === rangeId)) throw notFound('timeRange');
            return tree.pruneDependencies(
                withRecalcedBounds(tasks, taskId, ranges.filter(r => r.id !== rangeId)), [rangeId]);
        },
    },

    'add-milestone': {
        spec: MILESTONE_SPEC,
        ids: ['taskId'],
        apply(tasks, { taskId, body }, out) {
            const task = requireTask(tasks, taskId);
            const milestone = {
                id: tree.generateId(),
                date: body.date,
                label: body.label || '',
                color: body.color || '#5CB85C',
                shape: body.shape || 'diamond',
                labelPosition: body.labelPosition || 'auto',
                dependencies: body.dependencies || [],
            };
            assertDependenciesWritable(tasks, milestone.id, milestone.dependencies);
            out.milestone = milestone;
            return tree.updateTaskInTree(tasks, taskId, {
                milestones: [...(task.milestones || []), milestone],
            });
        },
    },

    // 수정 엔드포인트가 없던 동안, 날짜 하나를 고치려면 삭제 후 재생성뿐이었다 —
    // 그러면 id 가 바뀌고 deleteMilestone 의 pruneDependencies 가 (정상 동작으로)
    // 그 마일스톤을 가리키던 연결을 함께 지운다. 옳은 삭제가 수정 수단의 부재
    // 때문에 데이터 손실 경로가 됐던 자리다.
    'update-milestone': {
        spec: MILESTONE_PATCH_SPEC,
        ids: ['taskId', 'milestoneId'],
        check: nonEmpty,
        apply(tasks, { taskId, milestoneId, body }, out) {
            const task = requireTask(tasks, taskId);
            const milestones = task.milestones || [];
            const target = milestones.find(m => m.id === milestoneId);
            if (!target) throw notFound('milestone');
            if (body.dependencies) assertDependenciesWritable(tasks, milestoneId, body.dependencies);

            const merged = { ...target, ...body };
            out.milestone = merged;
            return tree.updateTaskInTree(tasks, taskId, {
                milestones: milestones.map(m => (m.id === milestoneId ? merged : m)),
            });
        },
    },

    'delete-milestone': {
        ids: ['taskId', 'milestoneId'],
        apply(tasks, { taskId, milestoneId }) {
            const task = requireTask(tasks, taskId);
            const milestones = task.milestones || [];
            if (!milestones.some(m => m.id === milestoneId)) throw notFound('milestone');
            return tree.pruneDependencies(tree.updateTaskInTree(tasks, taskId, {
                milestones: milestones.filter(m => m.id !== milestoneId),
            }), [milestoneId]);
        },
    },
};

// 쓰기 직전에 결과 트리를 `POST /api/data` 와 **같은 잣대**로 본다.
// validateTaskTree 가 blob 경로에만 걸려 있던 동안, batch 25개로 깊이 25 트리를
// 만들 수 있었고 — 그 순간부터 그 프로젝트를 열고 있는 브라우저의 자동저장이
// 영구히 400 이 됐다(구제 수단인 스냅샷 생성도 같은 검증을 지난다). AI 의 한 번의
// 쓰기가 사람의 모든 쓰기를 막는 자리라, 상한은 트리를 만드는 **모든** 경로가 봐야 한다.
const commit = (store, mutator) => store.withTasks((tasks) => {
    const next = mutator(tasks);
    if (!Array.isArray(next)) return next;
    const err = validateTaskTree(next);
    if (err) throw badRequest(`resulting tree invalid: ${err}`);
    return next;
});

// 공개 함수 한 개를 만드는 껍데기. 검증 → 리비전 → 한 번의 withTasks.
const single = (opName, args, store, ifMatch) => {
    const op = OPS[opName];
    if (op.spec) assertValid(args.body, op.spec);
    if (op.check) op.check(args.body);
    assertRevision(store, ifMatch);
    const out = {};
    const result = mustWrite(commit(store, (tasks) => op.apply(tasks, args, out)));
    return { revision: result.meta.revision, ...out };
};

// ── 작업 CRUD ────────────────────────────────────────
const createTask = (store, body, ifMatch) => single('create-task', { body }, store, ifMatch);
const updateTask = (store, id, body, ifMatch) => single('update-task', { taskId: id, body }, store, ifMatch);
const deleteTask = (store, id, ifMatch) => single('delete-task', { taskId: id }, store, ifMatch);
const moveTask = (store, id, body, ifMatch) => single('move-task', { taskId: id, body }, store, ifMatch);

// ── 기간(timeRange) ──────────────────────────────────
const addTimeRange = (store, id, body, ifMatch) =>
    single('add-time-range', { taskId: id, body }, store, ifMatch);

const updateTimeRange = (store, id, rangeId, body, ifMatch, options = {}) =>
    single('update-time-range', { taskId: id, rangeId, body, options }, store, ifMatch);

const deleteTimeRange = (store, id, rangeId, ifMatch) =>
    single('delete-time-range', { taskId: id, rangeId }, store, ifMatch);

// ── 마일스톤 ─────────────────────────────────────────
const addMilestone = (store, id, body, ifMatch) =>
    single('add-milestone', { taskId: id, body }, store, ifMatch);

const updateMilestone = (store, id, milestoneId, body, ifMatch) =>
    single('update-milestone', { taskId: id, milestoneId, body }, store, ifMatch);

const deleteMilestone = (store, id, milestoneId, ifMatch) =>
    single('delete-milestone', { taskId: id, milestoneId }, store, ifMatch);

// ── 일괄 적용 ────────────────────────────────────────
// 40 노드짜리 계획을 40 번 왕복하면 리비전이 40 번 오르고, 매 호출이 트리 전체를
// 다시 쓰고, 그 사이 브라우저는 폴링으로 **반쯤 지어진 계획**을 본다. 유일한 벌크
// 경로였던 blob POST /api/data 는 하필 순환 검사가 없는 경로다 — 벌크가 필요할수록
// 검증이 약한 쪽으로 몰리는 구조였다. 여기는 단건과 **같은 변경자**를 쓴다.
const BATCH_MAX = 200;
// @이름 / @이름:range — 앞선 op 이 만든 id 를 뒤 op 이 가리킨다. 이게 없으면
// batch 로는 평평한 목록밖에 못 만든다(자식은 부모 id 를 알아야 한다).
const REF_RE = /^@([A-Za-z0-9_-]+)(:range)?$/;

const deref = (value, refs) => {
    if (typeof value !== 'string') return value;
    const m = REF_RE.exec(value);
    if (!m) return value;
    const target = refs.get(m[1]);
    if (!target) throw badRequest(`unknown ref: ${value}`);
    const id = m[2] ? target.rangeId : target.id;
    if (!id) throw badRequest(`ref has no time range: ${value}`);
    return id;
};

const BATCH_KEYS = new Set(['op', 'ref', 'body', 'taskId', 'rangeId', 'milestoneId']);

const parseOps = (ops) => ops.map((raw, i) => {
    const at = `ops[${i}]`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest(`${at} must be an object`);
    const unknown = Object.keys(raw).filter(k => !BATCH_KEYS.has(k));
    if (unknown.length > 0) throw badRequest(`${at}: unknown field(s): ${unknown.join(', ')}`);

    // hasOwn 이어야 한다 — `OPS['constructor']` 는 truthy 라서 `op.ids` 에서 TypeError 가
    // 나고, 클라이언트 잘못이 500 으로 새어 나갔다(에러 로그와 5xx 카운터까지 함께).
    const op = Object.hasOwn(OPS, raw.op) ? OPS[raw.op] : null;
    if (!op) throw badRequest(`${at}.op must be one of: ${Object.keys(OPS).join(', ')}`);
    if (raw.ref !== undefined && (typeof raw.ref !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw.ref))) {
        throw badRequest(`${at}.ref must match [A-Za-z0-9_-]+`);
    }
    for (const key of op.ids) {
        if (typeof raw[key] !== 'string' || raw[key] === '') throw badRequest(`${at}.${key} is required`);
    }
    const body = raw.body ?? {};
    if (op.spec) {
        // ref 는 아직 문자열 '@x' 라 date/color 검사에 걸리지 않는다 — id 필드뿐이고
        // 그 필드들은 spec 상 string 이므로 검증을 그대로 통과한다.
        assertValid(body, op.spec);
        if (op.check) op.check(body);
    } else if (Object.keys(body).length > 0) {
        throw badRequest(`${at}.body is not allowed for op '${raw.op}'`);
    }
    return { at, name: raw.op, ref: raw.ref, raw, body };
});

const applyBatch = (store, payload, ifMatch) => {
    if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.ops)) {
        throw badRequest('body.ops must be an array');
    }
    if (payload.ops.length === 0) throw badRequest('body.ops must not be empty');
    if (payload.ops.length > BATCH_MAX) throw badRequest(`too many ops (max ${BATCH_MAX})`);

    // 1) 전부 형식 검증. 하나라도 틀리면 리비전 검사에도 못 간다 — 아무것도 안 쓴다.
    const parsed = parseOps(payload.ops);
    // 같은 ref 이름을 두 번 쓰면 조용히 뒤엣것으로 덮였다 — 200 op 짜리 계획에서
    // 첫 노드에 붙어야 할 자식이 오류 없이 다른 노드로 간다. 화면에도 응답에도 안 나온다.
    const seenRefs = new Set();
    for (const p of parsed) {
        if (!p.ref) continue;
        if (seenRefs.has(p.ref)) throw badRequest(`${p.at}.ref is already used: ${p.ref}`);
        seenRefs.add(p.ref);
    }
    assertRevision(store, ifMatch);

    const results = [];
    const result = mustWrite(commit(store, (tasks) => {
        const refs = new Map();
        results.length = 0;
        return parsed.reduce((acc, p) => {
            const op = OPS[p.name];
            const args = { body: { ...p.body }, options: {} };
            for (const key of op.ids) args[key] = deref(p.raw[key], refs);
            if (typeof args.body.parentId === 'string') args.body.parentId = deref(args.body.parentId, refs);
            if (Array.isArray(args.body.dependencies)) {
                args.body.dependencies = args.body.dependencies.map(d => deref(d, refs));
            }

            const out = {};
            const next = op.apply(acc, args, out);
            const created = out.task || out.timeRange || out.milestone;
            if (p.ref) {
                refs.set(p.ref, {
                    id: created ? created.id : args.taskId,
                    rangeId: out.timeRange ? out.timeRange.id : (out.task?.timeRanges || [])[0]?.id,
                });
            }
            results.push({ op: p.name, ...out });
            return next;
        }, tasks);
    }));

    return { revision: result.meta.revision, applied: results.length, results };
};

// ── 임계경로 / 여유 ──────────────────────────────────
const getCriticalPath = (store) => {
    const out = schedule.criticalPath(store.readTasks());
    if (out.cycles.length > 0) {
        throw badRequest(`cannot compute critical path: dependency cycle(s) present (${out.cycles.length})`);
    }
    return { revision: store.readMeta().revision, ...out, cycles: undefined };
};

module.exports = {
    assertRevision,
    getRevision,
    listTasks,
    getTask,
    getDependencyIssues,
    createTask,
    updateTask,
    deleteTask,
    moveTask,
    addTimeRange,
    updateTimeRange,
    deleteTimeRange,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    applyBatch,
    getCriticalPath,
    OPS,
    BATCH_MAX,
};
