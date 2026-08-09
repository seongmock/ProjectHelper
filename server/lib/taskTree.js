// 작업 트리 헬퍼 (CommonJS) — src/utils/taskTree.js + dataModel.js의 미러.
// ⚠️ 프론트엔드 시그니처 변경 시 이 파일도 함께 갱신할 것.

const generateId = () => {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const formatDate = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// dataModel.js의 createNewTask 미러 (기본 30일 기간)
const createNewTask = (name = '새 작업', parentId = null, startDate = null, endDate = null) => {
    const today = new Date();
    const defaultEnd = new Date(today);
    defaultEnd.setDate(today.getDate() + 30);

    const hasRange = startDate && endDate;
    return {
        id: generateId(),
        name,
        timeRanges: [
            {
                id: generateId(),
                startDate: hasRange ? startDate : formatDate(today),
                endDate: hasRange ? endDate : formatDate(defaultEnd),
                dependencies: [],
                color: null,
                label: '',
            },
        ],
        color: '#4A90E2',
        description: '',
        progress: 0,
        children: [],
        expanded: true,
        labels: [],
        parentId,
        milestones: [],
        dependencies: [],
        divider: { enabled: false, thickness: 2, style: 'solid', color: '#000000' },
    };
};

const findTask = (items, taskId) => {
    for (const item of items) {
        if (item.id === taskId) return item;
        if (item.children && item.children.length > 0) {
            const found = findTask(item.children, taskId);
            if (found) return found;
        }
    }
    return null;
};

const findTaskAndParent = (items, taskId, parent = null) => {
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === taskId) {
            return { task: items[i], parent, index: i, list: items };
        }
        if (items[i].children && items[i].children.length > 0) {
            const result = findTaskAndParent(items[i].children, taskId, items[i]);
            if (result) return result;
        }
    }
    return null;
};

const updateTaskInTree = (items, taskId, updates) =>
    items.map(task => {
        if (task.id === taskId) return { ...task, ...updates };
        if (task.children && task.children.length > 0) {
            return { ...task, children: updateTaskInTree(task.children, taskId, updates) };
        }
        return task;
    });

const deleteFromTree = (items, taskId) =>
    items
        .filter(item => item.id !== taskId)
        .map(item => ({ ...item, children: deleteFromTree(item.children || [], taskId) }));

const isDescendant = (parent, targetId) => {
    if (!parent.children) return false;
    for (const child of parent.children) {
        if (child.id === targetId) return true;
        if (isDescendant(child, targetId)) return true;
    }
    return false;
};

// 트리 평탄화 (expanded 무시 — API 소비자는 전체가 필요)
const flattenAll = (items, level = 0, parentId = null) => {
    const result = [];
    for (const item of items) {
        result.push({ ...item, level, parentId, children: undefined });
        if (item.children && item.children.length > 0) {
            result.push(...flattenAll(item.children, level + 1, item.id));
        }
    }
    return result;
};

// timeRanges에서 전체 시작/종료일 재계산 (프론트 recalcTaskBoundsSafe 미러)
const recalcTaskBounds = (timeRanges) => {
    const starts = (timeRanges || []).map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
    const ends = (timeRanges || []).map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));
    return {
        startDate: starts.length ? new Date(Math.min(...starts)).toISOString().split('T')[0] : '',
        endDate: ends.length ? new Date(Math.max(...ends)).toISOString().split('T')[0] : '',
    };
};

// ── 삭제가 남기는 참조 정리 (src/utils/taskTree.js 의 미러) ──
// deleteFromTree 는 상대의 dependencies 를 정리하지 않으므로, 삭제 경로가
// pruneDependencies 를 이어서 부른다. deleteFromTree 자체에 넣지 않는 이유는
// moveTask 가 "제거 후 재삽입"에 그 함수를 쓰기 때문이다 — 이동이 의존성을 지우면 안 된다.

const collectOwnedIds = (task) => {
    const ids = new Set();
    const walk = (t) => {
        if (!t) return;
        ids.add(t.id);
        (t.timeRanges || []).forEach(r => ids.add(r.id));
        (t.milestones || []).forEach(m => ids.add(m.id));
        (t.children || []).forEach(walk);
    };
    walk(task);
    return ids;
};

const pruneDependencies = (tasks, removedIds) => {
    const gone = removedIds instanceof Set ? removedIds : new Set(removedIds);
    if (gone.size === 0) return tasks;

    const strip = (holder) => {
        const deps = holder.dependencies;
        if (!deps || !deps.some(id => gone.has(id))) return holder;
        return { ...holder, dependencies: deps.filter(id => !gone.has(id)) };
    };

    const prune = (items) => items.map(item => ({
        ...strip(item),
        ...(item.timeRanges ? { timeRanges: item.timeRanges.map(strip) } : {}),
        ...(item.milestones ? { milestones: item.milestones.map(strip) } : {}),
        children: prune(item.children || []),
    }));
    return prune(tasks);
};

// ── 의존성 정합성 (src/utils/taskTree.js 의 같은 이름 함수들의 미러) ──
// 클라이언트는 2026-08-09 부터 순환을 만들기 전에 막지만, REST/MCP 로 들어오는 AI 는
// 그 검사를 거치지 않는다. 판정 규칙이 두 벌이 되면 화면과 API 가 다른 말을 하므로
// **동작 호환**으로 옮긴다 — 반환 형태(successors/edgeIssues 포함)까지 같게 유지한다.

// 의존성이 걸릴 수 있는 모든 엔티티(작업 + 마일스톤 + 기간)를 한 배열로 모은다.
const collectEntities = (flatList) => {
    const milestones = flatList.flatMap(t =>
        (t.milestones || []).map(m => ({ ...m, type: 'milestone', parentId: t.id, name: m.label || 'Milestone' })));
    const ranges = flatList.flatMap(t =>
        (t.timeRanges || []).map((r, i) => ({
            ...r,
            type: 'range',
            parentId: t.id,
            name: r.label || `${t.name} (Period ${i + 1})`,
        })));
    return [...flatList, ...milestones, ...ranges];
};

const dependencyEdgeKey = (fromId, toId) => `${fromId}>${toId}`;

// 'YYYY-MM-DD' 두 날짜의 차이(b - a, 일수). UTC 로 파싱한다.
const diffDays = (a, b) => {
    const ta = Date.parse(`${a}T00:00:00Z`);
    const tb = Date.parse(`${b}T00:00:00Z`);
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86_400_000);
};

// 엔티티가 차지하는 날짜 구간. 마일스톤은 한 점(시작=종료)이다.
// 날짜가 없으면 null — 판정할 근거가 없는 간선은 위반으로 세지 않는다.
const entityWindow = (entity) => {
    if (!entity) return null;
    if (entity.type === 'milestone') {
        return entity.date ? { start: entity.date, end: entity.date } : null;
    }
    // 작업의 실제 날짜는 기간 묶음이다(startDate/endDate 는 그 캐시라 어긋날 수 있다).
    const bounds = entity.type !== 'range' && (entity.timeRanges || []).length > 0
        ? recalcTaskBounds(entity.timeRanges)
        : { startDate: entity.startDate, endDate: entity.endDate };
    if (!bounds.startDate) return null;
    return { start: bounds.startDate, end: bounds.endDate || bounds.startDate };
};

// startId 에서 goalId 까지 후행 방향으로 내려가는 경로(BFS, 최단). 없으면 null.
const findDependencyPath = (successors, startId, goalId) => {
    const queue = [[startId]];
    const visited = new Set([startId]);
    while (queue.length > 0) {
        const path = queue.shift();
        const tail = path[path.length - 1];
        for (const next of successors.get(tail) || []) {
            if (next === goalId) return [...path, next];
            if (visited.has(next)) continue;
            visited.add(next);
            queue.push([...path, next]);
        }
    }
    return null;
};

// 같은 순환을 어느 간선에서 발견하든 한 번만 보고하기 위한 정규화.
const cycleKey = (ids) => {
    let pivot = 0;
    ids.forEach((id, i) => { if (id < ids[pivot]) pivot = i; });
    return [...ids.slice(pivot), ...ids.slice(0, pivot)].join('>');
};

// 트리 전체의 의존성 문제를 한 번에 판정한다. 반환은 클라이언트와 동일:
//   successors / edgeIssues / cycles / overlaps / dangling
const findDependencyIssues = (tasks) => {
    const entities = collectEntities(flattenAll(tasks || []));
    const byId = new Map(entities.map(e => [e.id, e]));
    const nameOf = (id) => byId.get(id)?.name || id;

    const successors = new Map();
    const edges = [];
    const dangling = [];

    entities.forEach(holder => {
        (holder.dependencies || []).forEach(depId => {
            if (!byId.has(depId)) {
                dangling.push({ holderId: holder.id, holderName: holder.name, missingId: depId });
                return;
            }
            edges.push({ fromId: depId, toId: holder.id });
            if (!successors.has(depId)) successors.set(depId, []);
            successors.get(depId).push(holder.id);
        });
    });

    const edgeIssues = {};
    const cycles = [];
    const seenCycles = new Set();
    const overlaps = [];

    edges.forEach(({ fromId, toId }) => {
        const back = fromId === toId ? [] : findDependencyPath(successors, toId, fromId);
        if (fromId === toId || back) {
            edgeIssues[dependencyEdgeKey(fromId, toId)] = 'cycle';
            const ids = fromId === toId ? [fromId] : [fromId, ...back.slice(0, -1)];
            const key = cycleKey(ids);
            if (!seenCycles.has(key)) {
                seenCycles.add(key);
                cycles.push({ ids, names: ids.map(nameOf) });
            }
            return; // 순환은 구조 결함이라 일정 위반보다 앞선다
        }

        const from = entityWindow(byId.get(fromId));
        const to = entityWindow(byId.get(toId));
        if (!from || !to) return;
        // 같은 날 인계(to.start === from.end)는 정상 계획으로 보고 세지 않는다.
        if (to.start < from.end) {
            edgeIssues[dependencyEdgeKey(fromId, toId)] = 'overlap';
            overlaps.push({
                fromId, toId,
                fromName: nameOf(fromId), toName: nameOf(toId),
                fromEnd: from.end, toStart: to.start,
                days: diffDays(to.start, from.end),
            });
        }
    });

    return { successors, edgeIssues, cycles, overlaps, dangling };
};

// sourceId → targetId 연결을 **추가하면** 순환이 되는가.
const wouldCreateDependencyCycle = (successors, sourceId, targetId) => {
    if (!sourceId || !targetId) return false;
    if (sourceId === targetId) return true;
    return findDependencyPath(successors || new Map(), targetId, sourceId) !== null;
};

module.exports = {
    generateId,
    formatDate,
    createNewTask,
    findTask,
    findTaskAndParent,
    updateTaskInTree,
    deleteFromTree,
    isDescendant,
    flattenAll,
    recalcTaskBounds,
    collectOwnedIds,
    pruneDependencies,
    collectEntities,
    dependencyEdgeKey,
    findDependencyIssues,
    wouldCreateDependencyCycle,
};
