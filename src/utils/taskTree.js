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

// 바로 위 형제의 id. 없으면(목록의 첫 항목이거나 찾지 못하면) null.
export const findPrevSiblingId = (tasks, taskId) => {
    const found = findTaskAndParent(tasks, taskId);
    if (!found || found.index <= 0) return null;
    return found.list[found.index - 1].id;
};

// 들여쓰기: 작업을 바로 위 형제의 자식으로 이동.
//
// **누가 "바로 위 형제"인지는 화면이 정한다.** 검색 중에는 질의에 걸리지 않는 형제가
// 걸러져 있어서, 저장된 트리의 이전 형제와 사용자가 보고 있는 이전 형제가 다르다 —
// 트리 기준으로 넣으면 **보이지도 않던 작업의 자식**이 되고, 그 부모가 조상으로
// 딸려 나오면서 화면에 없던 행이 나타난다. 그래서 대상은 `viewTasks`(= 화면에 그려진
// 목록) 에서 고르고, 이동 자체는 실제 트리에 한다. 검색 중이 아니면 둘은 같은 트리다.
export const indentTask = (items, taskId, viewTasks = items) => {
    const targetId = findPrevSiblingId(viewTasks, taskId);
    if (!targetId) return items; // 화면에서 첫 항목이면 들여쓰기 불가
    return indentUnder(items, taskId, targetId);
};

// 들여쓰기 실행부: taskId 를 같은 목록 안의 targetId 자식(마지막)으로 옮긴다.
const indentUnder = (items, taskId, targetId) => {
    const i = items.findIndex(t => t.id === taskId);
    if (i >= 0) {
        // 화면에서 고른 형제가 실제 트리에서도 같은 부모 아래여야 한다
        if (!items.some(t => t.id === targetId)) return items;

        const taskToMove = items[i];
        const newItems = [...items];
        newItems.splice(i, 1);

        const targetIndex = newItems.findIndex(t => t.id === targetId);
        newItems[targetIndex] = {
            ...newItems[targetIndex],
            children: [...(newItems[targetIndex].children || []), taskToMove],
            expanded: true, // 부모가 되면 자동 확장
        };
        return newItems;
    }

    for (let k = 0; k < items.length; k++) {
        if (items[k].children && items[k].children.length > 0) {
            const updatedChildren = indentUnder(items[k].children, taskId, targetId);
            if (updatedChildren !== items[k].children) {
                return items.map((item, index) =>
                    index === k ? { ...item, children: updatedChildren } : item
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

// 가져오기 병합 시 ID 재생성 (충돌 방지).
//
// 새 id 는 작업뿐 아니라 **기간·마일스톤에도** 발급한다 — 의존성이 사는 곳이 기간·마일스톤
// 이라(dataModel 참조) 작업 id 만 갈면 같은 파일을 두 번 병합했을 때 기간 id 가 겹치고,
// 그때 findOwnerOfEntity/patchRange 는 먼저 걸린 쪽을 고른다.
//
// 그리고 **가져온 묶음 안에서 완결되는 의존성은 새 id 로 다시 잇는다.** 밖을 가리키던
// 참조는 버린다 — 이어 줄 상대가 없다. 옛 id 를 그대로 두면 둘 중 하나가 된다:
// 그 id 가 없으면 끊어진 참조, 있으면(= 원본이 같은 트리에 있으면) **사본의 화살표가
// 원본에 가서 붙는다.** 사용자가 그리지 않은 연결이다.
export const regenerateIds = (items) => {
    // 새 id 는 객체마다 발급한다(맵이 아니라) — 파일 안에 같은 id 가 두 번 있어도 갈라진다.
    // oldId → newId 맵은 의존성을 다시 잇는 데만 쓰고, 중복은 처음 것을 따른다.
    const newIdOf = new Map();
    const byOldId = new Map();

    const assign = (holder) => {
        const id = generateId();
        newIdOf.set(holder, id);
        if (!byOldId.has(holder.id)) byOldId.set(holder.id, id);
    };
    const scan = (nodes) => (nodes || []).forEach(task => {
        assign(task);
        (task.timeRanges || []).forEach(assign);
        (task.milestones || []).forEach(assign);
        scan(task.children);
    });
    scan(items);

    // dependencies 가 없던 보유자에게 빈 배열을 새로 만들어 주지 않는다(pruneDependencies 와 같은 규약).
    const relink = (holder) => holder.dependencies
        ? { dependencies: holder.dependencies.map(id => byOldId.get(id)).filter(Boolean) }
        : {};

    const rebuild = (nodes) => (nodes || []).map(task => ({
        ...task,
        ...relink(task),
        id: newIdOf.get(task),
        timeRanges: (task.timeRanges || []).map(r => ({ ...r, ...relink(r), id: newIdOf.get(r) })),
        milestones: (task.milestones || []).map(ms => ({ ...ms, ...relink(ms), id: newIdOf.get(ms) })),
        children: rebuild(task.children),
    }));
    return rebuild(items);
};

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
// 두 규칙 다 "무엇이 어디에 어떤 순서로 보이는가"에 대한 판단이므로 **화면에 그려진
// 목록**(`viewTasks`) 을 본다. 검색 중에는 이것이 저장된 트리와 다르다: 필터가 일치를
// 드러내려고 조상을 강제로 펼치므로, 트리에서는 접혀 있어 `flattenTasks` 에 나오지도
// 않는 작업이 화면에서는 멀쩡히 드래그된다 — 트리 기준으로 판정하면 그 드래그는
// **조용히 아무것도 하지 않는다**(끌어다 놓았는데 제자리). 이동 자체는 실제 트리에 한다.
// 검색 중이 아니면 둘은 같은 트리다.
//
// App.jsx 안에 인라인으로 있던 것을 옮겨 왔다. 앱에서 가장 버그가 잦은 로직인데
// 컴포넌트 안에 있어 테스트가 불가능했다.
export const moveTaskInTree = (tasks, activeId, overId, viewTasks = tasks) => {
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
    const flatList = flattenTasks(viewTasks);
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
    // 펼쳐졌는지·자식이 있는지는 **화면 기준**이다(검색 중에는 트리의 expanded 와 다르다).
    const isDroppingOnExpandedParent =
        isMovingDown &&
        overFlatItem.expanded &&
        overFlatItem.children && overFlatItem.children.length > 0 &&
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

// 이 작업 하나가 질의에 걸리는가(조상·자손은 보지 않는다). 질의가 비면 필터가 없는
// 것이므로 참이다. 필터가 무엇을 남기는지 판단하는 곳이 둘이면 갈라진다 —
// `filterTasksByQuery` 와, "방금 추가한 작업이 지금 화면에 나타나는가"를 묻는 App 이 함께 쓴다.
export const taskMatchesQuery = (task, query) => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;
    return (task?.name || '').toLowerCase().includes(q)
        || (task?.description || '').toLowerCase().includes(q);
};

// 검색 필터 — 이름·설명이 질의를 포함하는 작업과 **그 조상 사슬**을 남긴다.
//
// 남은 노드 중 자식이 있는 것은 결과 트리에서 **펼친 상태로** 돌려준다. 화면이 쓰는
// `flattenTasks` 가 `expanded` 를 보기 때문에, 이게 없으면 접힌 부모 아래의 일치는
// 필터를 통과하고도 그려지지 않는다 — 검색해도 안 나오고, 대신 이름이 일치하지도 않는
// 부모 행만 남아 왜 걸렸는지 읽을 수 없었다.
//
// **실제 트리는 건드리지 않는다**(`expandAncestors` 와 다른 점). 검색은 조회일 뿐인데
// 저장 데이터의 `expanded` 를 바꾸면 타이핑만으로 문서가 dirty 가 되고 서버에 저장된다.
//
// `collapsedIds` 는 **검색 중에 사용자가 직접 접은 노드**다(화면에만 사는 상태 — uiStore).
// 이게 없으면 접기 토글이 화면에 반영되지 않는다: 위의 강제 펼침이 매번 이겨서 화살표가
// ▼ 에 머무르고, 눌린 값은 저장 데이터에만 조용히 들어간다. 저장된 `expanded` 로는
// "검색 전부터 접혀 있던 것"(일치를 가리므로 펼쳐야 한다)과 "지금 사용자가 접은 것"
// (존중해야 한다)을 구분할 수 없다 — 그래서 후자만 여기 별도로 받는다.
//
// 질의가 비면 원본 배열을 **그대로** 돌려준다(참조 동일 — 불필요한 재렌더를 만들지 않는다).
export const filterTasksByQuery = (tasks, query, collapsedIds = null) => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return tasks;
    const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds || []);

    const walk = (items) => (items || []).reduce((acc, item) => {
        const children = walk(item.children);
        if (!taskMatchesQuery(item, q) && children.length === 0) return acc;
        acc.push(children.length > 0
            ? { ...item, children, expanded: !collapsed.has(item.id) }
            : { ...item, children });
        return acc;
    }, []);

    return walk(tasks);
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

// 마일스톤을 날짜순으로 정렬해 돌려준다(원본은 건드리지 않는다).
// 표의 미리보기와 인스펙터의 카드 목록이 **같은 순서**를 써야 한다 — 표에서 미리보기를
// 눌렀을 때 포커스되는 "첫 마일스톤"이 인스펙터 첫 카드와 다르면 무엇을 지목했는지
// 화면에서 읽을 수 없다.
export const milestonesInDateOrder = (task) =>
    [...(task?.milestones || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));

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
    const milestones = milestonesInDateOrder(task);

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

// 시작·종료의 역전(종료 < 시작)을 막는다. 되돌리는 것은 **방금 편집한 쪽뿐**이다 —
// 손대지 않은 날짜까지 함께 옮기면 사용자가 요청하지 않은 변경이 된다.
// 마우스 리사이즈는 경계에서 멈추고(TimelineBar), 키보드는 종료일을 시작일로 맞추고
// (shiftTaskDates), 서버는 400 으로 거부하는데(taskService), **타이핑만 그대로 통과했다.**
// 통과한 결과는 화면에서 보이지 않는다 — getDuration 이 역전 구간을 0 으로 돌려
// 바의 폭이 0px 이 된다. 방금 입력한 기간이 흔적 없이 사라지는 것처럼 보인다.
// 반환은 patch 이고, 되돌릴 것이 없으면 **받은 patch 를 그대로**(참조 동일) 돌려준다.
export const orderRangeDates = (range, patch) => {
    const touchesStart = 'startDate' in patch;
    const touchesEnd = 'endDate' in patch;
    if (!touchesStart && !touchesEnd) return patch;

    const startDate = touchesStart ? patch.startDate : range?.startDate;
    const endDate = touchesEnd ? patch.endDate : range?.endDate;
    // 한쪽이 비어 있으면 역전인지 판정할 근거가 없다 — 그대로 둔다
    if (!startDate || !endDate || startDate <= endDate) return patch;

    // 양쪽을 함께 준 경우(드래그·가져오기)는 편집한 쪽을 가릴 수 없다 → 시작일을 따른다
    if (touchesStart && touchesEnd) return { ...patch, endDate: startDate };
    return touchesStart ? { ...patch, startDate: endDate } : { ...patch, endDate: startDate };
};

export const patchRange = (task, rangeId, patch) => {
    const ranges = task.timeRanges || [];
    const target = ranges.find(r => r.id === rangeId);
    if (!target) return null;
    const ordered = orderRangeDates(target, patch);
    const timeRanges = ranges.map(r => (r.id === rangeId ? { ...r, ...ordered } : r));
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

// ── 삭제가 남기는 참조 정리 ────────────────────────────────────────────────
// 무언가를 지우면 그것을 가리키던 상대의 dependencies 에 존재하지 않는 id 가 남는다.
// 그 끊어진 참조는 findDependencyIssues 가 진단해 주지만, **애초에 만들지 않는 편이
// 낫다** — 진단은 사람이 보고 눌러야 사라지고, 그 사이 화면은 없는 상대를 가리킨다.
//
// 정리는 삭제 경로에서만 조합한다. deleteFromTree 자체에 넣지 않는 이유는 moveTask 가
// "제거 후 재삽입"에 그 함수를 쓰기 때문이다 — 거기서 참조를 걷어내면 작업을 옮기는 것만으로
// 의존성이 사라진다.

// 작업 하나가 (자손까지 포함해) 소유한 엔티티 id 전부 — 작업·기간·마일스톤.
// 그 작업을 지우면 이 id 들을 가리키던 참조가 모두 끊어진 참조가 된다.
export const collectOwnedIds = (task) => {
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

// removedIds 를 가리키는 dependencies 를 트리 전체(작업·기간·마일스톤)에서 걷어낸다.
export const pruneDependencies = (tasks, removedIds) => {
    const gone = removedIds instanceof Set ? removedIds : new Set(removedIds);
    if (gone.size === 0) return tasks;

    // 걷어낼 것이 없는 보유자는 원본을 그대로 돌려준다 — 없던 dependencies 필드가
    // 빈 배열로 새로 생기지 않고, 참조가 유지되어 불필요한 리렌더도 줄어든다.
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

// ── 의존성 정합성 ──────────────────────────────────────────────────────────
// 지금까지 의존성은 **그려지기만 했다**. 순환(A→B→A)을 만들 수 있었고, 후행이 선행보다
// 먼저 시작해도 아무도 말해 주지 않았고, 작업을 지우면 상대의 dependencies 에 존재하지
// 않는 id 가 남았다. 그 세 가지를 여기서 판정한다. (끊어진 참조는 이제 삭제 경로가
// pruneDependencies 로 스스로 정리하므로, 여기 걸리는 것은 그 경로를 거치지 않은
// 쓰기 — blob POST /api/data·가져오기·과거 데이터 — 가 남긴 것이다.)
//
// 간선의 방향: 보유자 H 의 dependencies 에 P 가 들어 있으면 **P(선행) → H(후행)** 이다.
// 화면(DependencyLayer)이 그리는 화살표와 같은 방향이다.

export const dependencyEdgeKey = (fromId, toId) => `${fromId}>${toId}`;

// 엔티티가 차지하는 날짜 구간. 마일스톤은 한 점(시작=종료)이다.
// 날짜가 없으면 **null** — 판정할 근거가 없는 간선은 위반으로 세지 않는다.
const entityWindow = (entity) => {
    if (!entity) return null;
    if (entity.type === 'milestone') {
        return entity.date ? { start: entity.date, end: entity.date } : null;
    }
    // 작업의 실제 날짜는 기간 묶음이다(startDate/endDate 는 그 캐시라 어긋날 수 있다).
    // 기간이 없는 작업만 레거시 필드를 본다.
    const bounds = entity.type !== 'range' && (entity.timeRanges || []).length > 0
        ? recalcTaskBoundsSafe(entity.timeRanges)
        : { startDate: entity.startDate, endDate: entity.endDate };
    if (!bounds.startDate) return null;
    return { start: bounds.startDate, end: bounds.endDate || bounds.startDate };
};

// startId 에서 goalId 까지 후행 방향으로 내려가는 경로(BFS, 최단). 없으면 null.
// 반환에는 양끝이 모두 들어간다: [startId, ..., goalId].
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

// 같은 순환을 어느 간선에서 발견하든 한 번만 보고하기 위한 정규화 —
// 가장 작은 id 가 앞에 오도록 회전시킨다.
const cycleKey = (ids) => {
    let pivot = 0;
    ids.forEach((id, i) => { if (id < ids[pivot]) pivot = i; });
    return [...ids.slice(pivot), ...ids.slice(0, pivot)].join('>');
};

// 트리 전체의 의존성 문제를 한 번에 판정한다.
// 반환:
//   successors  Map<선행id, 후행id[]> — wouldCreateDependencyCycle 이 쓰는 인접 목록
//   edgeIssues  { [dependencyEdgeKey]: 'cycle' | 'overlap' } — 화살표 색을 정할 때
//   cycles      [{ ids, names }] — 순환 사슬(마지막 → 첫 번째로 닫힌다)
//   overlaps    [{ fromId, toId, fromName, toName, fromEnd, toStart, days }]
//   dangling    [{ holderId, holderName, missingId }] — 지워진 상대를 가리키는 참조
export const findDependencyIssues = (tasks) => {
    const entities = collectEntities(flattenAll(tasks));
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
        // 후행에서 선행으로 되돌아오는 경로가 이미 있으면 이 간선이 순환을 닫는다.
        const back = fromId === toId ? [] : findDependencyPath(successors, toId, fromId);
        if (fromId === toId || back) {
            edgeIssues[dependencyEdgeKey(fromId, toId)] = 'cycle';
            // back 은 [toId, ..., fromId] 라 끝의 fromId 를 떼면 사슬이 중복 없이 닫힌다.
            const ids = fromId === toId ? [fromId] : [fromId, ...back.slice(0, -1)];
            const key = cycleKey(ids);
            if (!seenCycles.has(key)) {
                seenCycles.add(key);
                cycles.push({ ids, names: ids.map(nameOf) });
            }
            return; // 순환은 구조 결함이라 일정 위반보다 앞선다 — 한 간선에 하나만 붙인다
        }

        const from = entityWindow(byId.get(fromId));
        const to = entityWindow(byId.get(toId));
        if (!from || !to) return;
        // 'YYYY-MM-DD' 는 문자열 비교가 곧 날짜 비교다.
        // 같은 날 인계(to.start === from.end)는 정상 계획으로 보고 세지 않는다 —
        // 오탐이 섞이면 경고 자체가 무시된다.
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
// successors 는 findDependencyIssues 가 돌려준 인접 목록이다(연결 전 상태).
export const wouldCreateDependencyCycle = (successors, sourceId, targetId) => {
    if (!sourceId || !targetId) return false;
    if (sourceId === targetId) return true;
    return findDependencyPath(successors || new Map(), targetId, sourceId) !== null;
};
