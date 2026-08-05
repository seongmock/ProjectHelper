// 작업 트리 순수 유틸리티 — App.jsx 내부 클로저들을 추출한 공용 헬퍼.
// 모든 함수는 불변(immutable) 방식으로 새 트리를 반환한다 (undo/redo 히스토리 보호).
//
// ⚠️ server/lib/taskTree.js(CommonJS)는 이 파일의 미러 — 시그니처 변경 시 함께 갱신할 것.
import { generateId } from './dataModel';

// 재귀적으로 특정 작업을 업데이트 (깊이 제한 없음)
export const updateTaskInTree = (items, taskId, updates) => {
    return items.map(task => {
        if (task.id === taskId) {
            return { ...task, ...updates };
        }
        if (task.children && task.children.length > 0) {
            return { ...task, children: updateTaskInTree(task.children, taskId, updates) };
        }
        return task;
    });
};

// 작업 삭제 (자식 포함, 불변 재귀)
// children 이 없는 노드를 허용한다 — 가져오기(import) 경로 중 migrateTaskData 를
// 거치지 않는 분기가 있어 정규화되지 않은 노드가 트리에 들어올 수 있다.
export const deleteFromTree = (items, taskId) =>
    items
        .filter(item => item.id !== taskId)
        .map(item => ({
            ...item,
            children: deleteFromTree(item.children || [], taskId),
        }));

// 특정 부모의 children 끝에 새 작업 추가 (부모는 자동 확장)
export const addToParent = (items, parentId, newTask) =>
    items.map(item => {
        if (item.id === parentId) {
            return { ...item, children: [...(item.children || []), newTask], expanded: true };
        }
        if (item.children && item.children.length > 0) {
            return { ...item, children: addToParent(item.children, parentId, newTask) };
        }
        return item;
    });

// 작업과 그 부모/인덱스/소속 리스트 탐색
export const findTaskAndParent = (items, taskId, parent = null) => {
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

// targetId가 parent의 자손인지 확인 (순환 이동 방지용)
export const isDescendant = (parent, targetId) => {
    if (!parent.children) return false;
    for (const child of parent.children) {
        if (child.id === targetId) return true;
        if (isDescendant(child, targetId)) return true;
    }
    return false;
};

// 들여쓰기: 작업을 바로 위 형제의 자식으로 이동
export const indentTask = (items, taskId) => {
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === taskId) {
            if (i === 0) return items; // 첫 번째 항목은 들여쓰기 불가

            const prevSibling = items[i - 1];
            const taskToMove = items[i];

            const newItems = [...items];
            newItems.splice(i, 1); // 현재 위치에서 제거

            // 이전 형제의 자식으로 추가
            newItems[i - 1] = {
                ...prevSibling,
                children: [...(prevSibling.children || []), taskToMove],
                expanded: true, // 부모가 되면 자동 확장
            };
            return newItems;
        }

        if (items[i].children && items[i].children.length > 0) {
            const updatedChildren = indentTask(items[i].children, taskId);
            if (updatedChildren !== items[i].children) {
                return items.map((item, index) =>
                    index === i ? { ...item, children: updatedChildren } : item
                );
            }
        }
    }
    return items;
};

// 내어쓰기(내부 재귀): 작업을 부모의 형제로 이동.
// 반환값이 {found}면 상위 레벨에서 처리해야 한다는 신호.
const outdentRecursive = (items, taskId, parent = null) => {
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === taskId) {
            if (!parent) return items; // 최상위 레벨이면 내어쓰기 불가
            return { found: true, task: items[i], index: i };
        }

        if (items[i].children && items[i].children.length > 0) {
            const result = outdentRecursive(items[i].children, taskId, items[i]);

            // 자식에서 찾음 → 내 자식에서 빼서 내 뒤(형제)로 삽입
            if (result && result.found) {
                const newChildren = [...items[i].children];
                newChildren.splice(result.index, 1);

                const newItems = [...items];
                newItems[i] = { ...items[i], children: newChildren };
                newItems.splice(i + 1, 0, result.task);
                return newItems;
            }

            // 하위에서 이미 처리됨 → 변경 전파
            if (Array.isArray(result) && result !== items[i].children) {
                return items.map((item, index) =>
                    index === i ? { ...item, children: result } : item
                );
            }
        }
    }
    return items;
};

// 내어쓰기 공개 API: 항상 배열을 반환
export const outdentTask = (items, taskId) => {
    const result = outdentRecursive(items, taskId);
    // 최상위에서 found 객체가 반환되면 내어쓰기 불가 → 원본 유지
    if (!Array.isArray(result) && result.found) return items;
    return result;
};

// 가져오기 병합 시 ID 재생성 (충돌 방지)
export const regenerateIds = (items) =>
    items.map(item => ({
        ...item,
        id: generateId(),
        children: item.children ? regenerateIds(item.children) : [],
        milestones: item.milestones
            ? item.milestones.map(ms => ({ ...ms, id: generateId() }))
            : [],
        dependencies: [],
    }));

// timeRanges 배열에서 전체 시작/종료일 재계산
export const recalcTaskBounds = (timeRanges) => {
    if (!timeRanges || timeRanges.length === 0) return null;
    const allStarts = timeRanges.map(r => new Date(r.startDate).getTime());
    const allEnds = timeRanges.map(r => new Date(r.endDate).getTime());
    return {
        startDate: new Date(Math.min(...allStarts)).toISOString().split('T')[0],
        endDate: new Date(Math.max(...allEnds)).toISOString().split('T')[0],
    };
};

// recalcTaskBounds의 방어적 버전: 잘못된 날짜(NaN)는 무시하고,
// 계산 불가 시 빈 문자열을 반환 (TimelineBarPopover의 기존 시맨틱 유지)
export const recalcTaskBoundsSafe = (timeRanges) => {
    const allStarts = (timeRanges || []).map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
    const allEnds = (timeRanges || []).map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));
    return {
        startDate: allStarts.length > 0 ? new Date(Math.min(...allStarts)).toISOString().split('T')[0] : '',
        endDate: allEnds.length > 0 ? new Date(Math.max(...allEnds)).toISOString().split('T')[0] : '',
    };
};

// 지연(overdue) 판정: 완료(progress>=100)가 아니고 마지막 기간의 종료일이 오늘보다 과거
// todayStr: 'YYYY-MM-DD' (호출부에서 렌더당 1회 계산) — ISO 문자열 비교는 안전
export const isTaskOverdue = (task, todayStr) => {
    if ((task.progress ?? 0) >= 100) return false;
    const { endDate } = recalcTaskBoundsSafe(task.timeRanges);
    return !!endDate && endDate < todayStr;
};

// 평탄화된 작업 목록에서 특정 ID(작업/기간/마일스톤)의 소유자 탐색
// 반환: { task, kind: 'task' | 'range' | 'milestone' } 또는 null
export const findOwnerOfEntity = (flatList, entityId) => {
    let task = flatList.find(t => t.id === entityId);
    if (task) return { task, kind: 'task' };

    task = flatList.find(t => t.timeRanges && t.timeRanges.some(r => r.id === entityId));
    if (task) return { task, kind: 'range' };

    task = flatList.find(t => t.milestones && t.milestones.some(m => m.id === entityId));
    if (task) return { task, kind: 'milestone' };

    return null;
};
