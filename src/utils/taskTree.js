// 작업 트리 순수 유틸리티 — App.jsx 내부 클로저들을 추출한 공용 헬퍼.
// 모든 함수는 불변(immutable) 방식으로 새 트리를 반환한다 (undo/redo 히스토리 보호).
//
// ⚠️ server/lib/taskTree.js(CommonJS)는 이 파일의 미러 — 시그니처 변경 시 함께 갱신할 것.
import { generateId, flattenTasks } from './dataModel';

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

// 일정 상태 판정. 상태 색상 모드(바 색)와 범례가 같은 규칙을 쓰도록 여기 한 곳에 둔다.
// 반환 순서가 곧 우선순위다: 완료 > 지연 > 예정 > 진행중.
// 날짜가 없으면 'none' — 칠할 바 자체가 없으므로 색상 모드에서도 작업 색을 그대로 쓴다.
export const getTaskStatus = (task, todayStr) => {
    if ((task.progress ?? 0) >= 100) return 'done';
    const { startDate, endDate } = recalcTaskBoundsSafe(task.timeRanges);
    if (!startDate || !endDate) return 'none';
    if (endDate < todayStr) return 'overdue';
    if (startDate > todayStr) return 'upcoming';
    return 'active';
};

// 'YYYY-MM-DD' 에 일수를 더한다. UTC 로 파싱해 UTC 로 더한다 —
// setDate(로컬)와 toISOString(UTC)을 섞으면 음수 오프셋 지역에서 하루가 밀린다.
// 날짜가 아니면 원본을 그대로 돌려준다(호출부가 "변화 없음"으로 판별한다).
const addDaysToDateStr = (dateStr, days) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(d.getTime())) return dateStr;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
};

// 키보드 일정 편집. 실사 §5.3 "타임라인 바는 마우스 드래그 전용 → 키보드로 일정 변경 불가".
//   mode 'move'   — 모든 기간을 통째로 days 만큼 이동
//   mode 'resize' — 종료일만 days 만큼 (기간 늘이기/줄이기). 하루 미만으로는 줄지 않는다.
// 반환은 updateTask 에 그대로 넘길 수 있는 patch. **바뀔 것이 없으면 null** 이다 —
// 날짜 없는 작업에 히스토리 항목만 쌓는 것을 호출부가 막을 수 있어야 한다.
export const shiftTaskDates = (task, days, mode = 'move') => {
    const ranges = task?.timeRanges || [];
    if (ranges.length === 0 || days === 0) return null;

    let changed = false;
    const timeRanges = ranges.map(r => {
        const startDate = mode === 'move' ? addDaysToDateStr(r.startDate, days) : r.startDate;
        let endDate = addDaysToDateStr(r.endDate, days);
        if (mode === 'resize' && endDate < startDate) endDate = startDate;
        if (startDate === r.startDate && endDate === r.endDate) return r;
        changed = true;
        return { ...r, startDate, endDate };
    });

    return changed ? { timeRanges, ...recalcTaskBoundsSafe(timeRanges) } : null;
};

// 드래그 앤 드롭 재배치 — activeId 를 overId 위치로 옮긴 새 트리를 반환한다.
// 이동할 수 없는 경우(자기 자신, 존재하지 않음, 자기 서브트리로의 이동)에는
// **원본 참조를 그대로** 반환한다 (호출부가 `next === prev` 로 무변경을 판별한다).
//
// 이 함수는 순수 배치 규칙이지만 눈에 보이는 결과가 직관에 의존해서 규칙이 두 개 붙어 있다:
//  (A) 최상위 작업을 하위 작업 위로 끌면, 그 하위 작업의 자식이 되는 대신
//      해당 하위 작업이 속한 최상위 조상 위치로 매핑한다.
//      (그렇지 않으면 최상위 항목이 우연히 남의 자식이 되어 사라진 것처럼 보인다)
//  (B) '펼쳐져 있고 자식이 있는' 그룹 제목 위로 아래 방향 드래그하면 그 그룹의
//      첫 번째 자식으로 넣는다. 빈 작업은 Leaf 로 취급해 순서 변경만 한다 —
//      빈 작업 안에 넣으려면 들여쓰기 제스처를 쓴다.
//
// App.jsx 안에 인라인으로 있던 것을 옮겨 왔다. 앱에서 가장 버그가 잦은 로직인데
// 컴포넌트 안에 있어 테스트가 불가능했다.
export const moveTaskInTree = (tasks, activeId, overId) => {
    if (activeId === overId) return tasks;
    if (!findTaskAndParent(tasks, activeId) || !findTaskAndParent(tasks, overId)) return tasks;

    // 불변성 유지를 위해 deep clone 후 제자리 조작 (splice 를 쓰기 위함)
    const clonedTasks = structuredClone(tasks);
    const activeNode = findTaskAndParent(clonedTasks, activeId);
    const overNode = findTaskAndParent(clonedTasks, overId);
    if (!activeNode || !overNode) return tasks;

    // 순환 참조 방지: overNode 가 activeNode 의 자손이면 이동 불가
    if (isDescendant(activeNode.task, overId)) return tasks;

    // 이동 방향은 평탄화된(= 화면에 보이는) 순서 기준으로 판별한다
    const flatList = flattenTasks(tasks);
    const activeFlatItem = flatList.find(t => t.id === activeId);
    const overFlatItem = flatList.find(t => t.id === overId);
    if (!activeFlatItem || !overFlatItem) return tasks;

    const activeGlobalIndex = flatList.findIndex(t => t.id === activeId);
    let overGlobalIndex = flatList.findIndex(t => t.id === overId);

    // (A) 최상위 → 하위 위로 드래그: 대상의 최상위 조상으로 매핑
    let effectiveOverId = overId;
    let targetNode = overNode;
    if (activeFlatItem.level === 0 && overFlatItem.level > 0) {
        for (let i = overGlobalIndex; i >= 0; i--) {
            if (flatList[i].level === 0) {
                effectiveOverId = flatList[i].id;
                overGlobalIndex = i;
                break;
            }
        }
    }

    const isMovingDown = activeGlobalIndex < overGlobalIndex;

    // 원위치에서 제거
    activeNode.list.splice(activeNode.index, 1);

    // 타겟이 바뀌었으면 다시 찾는다 (effectiveOverId 는 최상위라 제거 후에도 유효)
    if (effectiveOverId !== overId) {
        const found = findTaskAndParent(clonedTasks, effectiveOverId);
        if (found) targetNode = found;
    }

    let targetList = targetNode.list;
    let targetIndex = targetList.findIndex(t => t.id === effectiveOverId);

    // (B) 펼쳐진 그룹 제목 위로 아래 방향 드래그 → 그 그룹의 첫 자식으로
    const isDroppingOnExpandedParent =
        isMovingDown &&
        overNode.task.expanded &&
        overNode.task.children && overNode.task.children.length > 0 &&
        overNode.task.id === effectiveOverId;

    if (isDroppingOnExpandedParent) {
        targetList = overNode.task.children;
        targetIndex = 0;
    } else if (isMovingDown) {
        targetIndex += 1; // 아래로 이동할 때는 타겟의 뒤에 넣는다
    }

    targetList.splice(targetIndex, 0, activeNode.task);
    return clonedTasks;
};

// dataModel 의 flattenTasks 는 expanded 인 가지만 내려간다(화면에 보이는 것 = 렌더 대상).
// 접힌 가지까지 전부 필요한 계산(의존성 탐색 등)에는 이쪽을 쓴다.
// server/lib/taskTree.js 의 flattenAll 과 같은 역할이다.
export const flattenAll = (items, level = 0) => {
    const result = [];
    (items || []).forEach(item => {
        result.push({ ...item, level });
        if (item.children && item.children.length > 0) {
            result.push(...flattenAll(item.children, level + 1));
        }
    });
    return result;
};

// 접힌 부모 아래 숨어 있는 작업으로 이동할 때, 그 조상 사슬을 전부 펼친다.
// 펼칠 것이 없으면(이미 다 펼쳐졌거나 작업이 없으면) **null** — patchRange 등과 같은 규약이다.
// 빈 상태 변경을 만들지 않는다.
export const expandAncestors = (items, taskId) => {
    let changed = false;

    // [바뀐 목록, 이 가지 안에서 찾았는지]
    const walk = (list) => {
        let hit = false;
        const next = list.map(item => {
            if (item.id === taskId) {
                hit = true;
                return item;
            }
            const children = item.children || [];
            if (children.length === 0) return item;

            const [nextChildren, childHit] = walk(children);
            if (!childHit) return item;
            hit = true;
            if (item.expanded) return { ...item, children: nextChildren };
            changed = true;
            return { ...item, expanded: true, children: nextChildren };
        });
        return [next, hit];
    };

    const [next] = walk(items || []);
    return changed ? next : null;
};

// 의존성이 걸릴 수 있는 모든 엔티티(작업 + 마일스톤 + 기간)를 한 배열로 모은다.
// 작업은 원본 그대로, 마일스톤·기간은 표시용 name 과 소유 작업 parentId 를 얹는다.
export const collectEntities = (flatList) => {
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

// 'YYYY-MM-DD' 두 날짜의 차이(b - a, 일수). UTC 로 파싱한다 — addDaysToDateStr 와 같은 이유.
const diffDays = (a, b) => {
    const ta = Date.parse(`${a}T00:00:00Z`);
    const tb = Date.parse(`${b}T00:00:00Z`);
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86_400_000);
};

// 인스펙터 패널이 보여 줄 파생 정보를 한 번에 계산한다.
// 화면이 아니라 여기서 계산하는 이유: 상태·일수·롤업·의존성은 전부 순수 계산이고,
// 컴포넌트에 흩어 놓으면 테스트할 수 없다.
// 반환 null = 해당 작업이 트리에 없음(선택이 남아 있는데 작업이 지워진 경우).
export const summarizeTask = (tasks, taskId, todayStr) => {
    if (!taskId) return null;
    const flat = flattenAll(tasks);
    const task = flat.find(t => t.id === taskId);
    if (!task) return null;

    const { startDate, endDate } = recalcTaskBoundsSafe(task.timeRanges);
    const ranges = [...(task.timeRanges || [])].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const milestones = [...(task.milestones || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // 하위 진행률 롤업. 자신은 빼고 자손 전체의 평균이다 — 부모의 progress 는 사용자가
    // 직접 넣는 값이라, 자손 평균과 어긋나 있다는 사실 자체가 봐야 할 정보다.
    const descendants = flattenAll(task.children || []);
    const rollupProgress = descendants.length > 0
        ? Math.round(descendants.reduce((sum, d) => sum + (d.progress ?? 0), 0) / descendants.length)
        : null;

    // 이 작업이 소유한 ID 전부(작업 자신 + 기간 + 마일스톤) 기준으로 앞뒤를 찾는다.
    // 의존성은 기간·마일스톤 단위로도 걸리므로 작업 ID 만 보면 절반을 놓친다.
    const ownIds = new Set([task.id, ...ranges.map(r => r.id), ...milestones.map(m => m.id)]);
    const ownDeps = new Set([
        ...(task.dependencies || []),
        ...ranges.flatMap(r => r.dependencies || []),
        ...milestones.flatMap(m => m.dependencies || []),
    ]);
    const entities = collectEntities(flat);
    // 앞뒤 목록에는 **제거에 필요한 상대 정보**를 함께 싣는다. 의존성은 늘 한쪽이 보유하고
    // 있어서(holder.dependencies 에 상대 id 가 들어간다), 지우려면 "누가 들고 있는지"를
    // 알아야 한다: 선행은 내 쪽 어느 엔티티가(holderId), 후행은 내 쪽 어느 id 를(depId).
    const holderOf = (depId) => {
        if ((task.dependencies || []).includes(depId)) return task.id;
        return ranges.find(r => (r.dependencies || []).includes(depId))?.id
            ?? milestones.find(m => (m.dependencies || []).includes(depId))?.id
            ?? task.id;
    };
    const predecessors = entities
        .filter(e => ownDeps.has(e.id) && !ownIds.has(e.id))
        .map(e => ({ ...e, holderId: holderOf(e.id) }));
    const successors = entities
        .filter(e => !ownIds.has(e.id) && (e.dependencies || []).some(d => ownIds.has(d)))
        .map(e => ({ ...e, depId: (e.dependencies || []).find(d => ownIds.has(d)) }));

    const parent = findTaskAndParent(tasks, taskId)?.parent || null;

    return {
        task,
        parentName: parent?.name || null,
        status: getTaskStatus(task, todayStr),
        startDate,
        endDate,
        // 시작·종료 양끝을 포함한 일수 (하루짜리 기간 = 1일)
        durationDays: startDate && endDate ? diffDays(startDate, endDate) + 1 : null,
        // 오늘부터 종료일까지 남은 일수. 음수면 그만큼 지났다는 뜻이다.
        daysToEnd: endDate ? diffDays(todayStr, endDate) : null,
        ranges,
        milestones,
        childCount: (task.children || []).length,
        descendantCount: descendants.length,
        rollupProgress,
        predecessors,
        successors,
    };
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

// ── 기간(timeRange) 편집 ────────────────────────────────────────────────────
// 기간을 고치는 경로는 이 세 함수만이다. 반환값은 updateTask 에 그대로 넘길 patch 이고
// **항상 작업 전체의 bounds 를 함께 재계산한다** — 기간만 고치고 startDate/endDate 갱신을
// 빠뜨리면 표(레거시 필드를 읽는다)와 타임라인의 날짜가 갈라진다. 폐기한 팝오버는
// 라벨·색 변경 경로에서 실제로 재계산을 건너뛰고 있었다.
// 대상이 없어 바뀔 것이 없으면 **null** 이다(호출부가 빈 undo 항목을 만들지 않게).

export const patchRange = (task, rangeId, patch) => {
    const ranges = task.timeRanges || [];
    if (!ranges.some(r => r.id === rangeId)) return null;
    const timeRanges = ranges.map(r => (r.id === rangeId ? { ...r, ...patch } : r));
    return { timeRanges, ...recalcTaskBoundsSafe(timeRanges) };
};

// dateStr('YYYY-MM-DD') 에 하루짜리 기간을 붙인다. timeRanges 가 비어 있는데 레거시
// startDate/endDate 가 남아 있으면 그것을 먼저 기간으로 승격한다 — 승격하지 않으면
// bounds 재계산이 새 기간만 보게 되어 레거시 날짜가 조용히 사라진다.
export const appendRange = (task, dateStr) => {
    const timeRanges = [...(task.timeRanges || [])];
    if (timeRanges.length === 0 && (task.startDate || task.endDate)) {
        timeRanges.push({ id: generateId(), startDate: task.startDate, endDate: task.endDate });
    }
    timeRanges.push({ id: generateId(), startDate: dateStr, endDate: dateStr });
    return { timeRanges, ...recalcTaskBoundsSafe(timeRanges) };
};

// 마지막 기간을 지우면 bounds 는 빈 문자열이 된다(recalcTaskBoundsSafe) — 남겨 두면
// 기간이 없는 작업에 바가 계속 그려진다.
export const removeRange = (task, rangeId) => {
    const ranges = task.timeRanges || [];
    if (!ranges.some(r => r.id === rangeId)) return null;
    const timeRanges = ranges.filter(r => r.id !== rangeId);
    return { timeRanges, ...recalcTaskBoundsSafe(timeRanges) };
};

// ── 마일스톤 편집 ──────────────────────────────────────────────────────────
// 기간과 같은 규약(반환은 updateTask 에 넘길 patch, 대상이 없으면 null)이지만
// **bounds 는 재계산하지 않는다** — recalcTaskBoundsSafe 는 timeRanges 만 보므로
// 마일스톤은 작업의 시작·종료일에 들어가지 않는다. 여기서 재계산하면 기간이 없는
// 작업의 bounds 가 빈 문자열로 덮여 표의 날짜가 사라진다.

export const patchMilestone = (task, milestoneId, patch) => {
    const list = task.milestones || [];
    if (!list.some(m => m.id === milestoneId)) return null;
    return { milestones: list.map(m => (m.id === milestoneId ? { ...m, ...patch } : m)) };
};

export const removeMilestone = (task, milestoneId) => {
    const list = task.milestones || [];
    if (!list.some(m => m.id === milestoneId)) return null;
    return { milestones: list.filter(m => m.id !== milestoneId) };
};

// 의존성 한 건 제거 계획. holderId 는 의존성을 **보유한** 엔티티(작업/기간/마일스톤),
// dependencyId 는 그 목록에서 뺄 id 다. 보유자 종류마다 갱신할 필드가 달라서
// (dependencies / timeRanges[].dependencies / milestones[].dependencies) 그 분기를
// 여기 한 곳에 모은다. 반환: { taskId, updates } 또는 null(보유자를 못 찾음).
export const planDependencyRemoval = (flatList, holderId, dependencyId) => {
    const owner = findOwnerOfEntity(flatList, holderId);
    if (!owner) return null;

    const strip = (deps) => (deps || []).filter(id => id !== dependencyId);

    if (owner.kind === 'task') {
        return { taskId: holderId, updates: { dependencies: strip(owner.task.dependencies) } };
    }
    if (owner.kind === 'range') {
        return {
            taskId: owner.task.id,
            updates: {
                timeRanges: owner.task.timeRanges.map(r =>
                    r.id === holderId ? { ...r, dependencies: strip(r.dependencies) } : r),
            },
        };
    }
    return {
        taskId: owner.task.id,
        updates: {
            milestones: owner.task.milestones.map(m =>
                m.id === holderId ? { ...m, dependencies: strip(m.dependencies) } : m),
        },
    };
};
