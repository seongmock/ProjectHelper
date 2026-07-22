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
};
