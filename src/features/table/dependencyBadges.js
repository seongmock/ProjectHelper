// 표(TableView)의 행 하나가 "의존성을 몇 개, 어느 방향으로 갖는가"로 간선을 해석한다.
// 순수 함수만 — React 도 DOM 도 모른다.
//
// 지금까지 표에는 의존성 표현이 **하나도 없었다**. 연결은 타임라인 화살표와 인스펙터에만
// 있어서, 표만 쓰는 사용자에게는 연결이 존재한다는 사실 자체가 보이지 않았다 — 작업을
// 하나씩 선택해 인스펙터를 열어 봐야만 알 수 있었고, 그래서 일정을 옮기다 선행/후행을
// 모르고 깨뜨려도 화면이 아무 말을 하지 않았다.
//
// 간선의 방향은 판정과 같다: 보유자 H 의 dependencies 에 P 가 있으면 **P(선행) → H(후행)**.
// 그래서 H 의 행에는 "선행 1", P 의 행에는 "후행 1" 이 선다.
//
// 화면에 행이 없는 작업의 간선은 **버리지 않는다**(타임라인 화살표와 같은 규칙,
// features/timeline/dependencyLinks.js). 접힌 가지 안의 작업은 가장 가까운 보이는 조상의
// 행으로 **끌어올린다** — 가지를 접었다고 연결이 없어지는 것이 아니고, 없어진 것처럼
// 보이는 것이 이 표의 가장 조용한 거짓말이 된다. 끌어올린 것은 상대 이름과 함께
// `rolledUp` 으로 표시해 툴팁이 "숨은 하위의 연결"임을 말한다.
import { flattenAll, dependencyEdgeKey } from '../../utils/taskTree';

// 작업 id → 그 작업이 앉는 **보이는 행**의 id. 자기 행이 있으면 자신, 없으면 가장 가까운
// 보이는 조상, 조상까지 전부 화면에 없으면(검색 필터 밖) null — 얹을 행이 없다.
const buildRowMap = (allTasks, visibleIds) => {
    const rowOf = new Map();
    const walk = (items, host) => {
        (items || []).forEach(task => {
            const row = visibleIds.has(task.id) ? task.id : host;
            rowOf.set(task.id, row);
            walk(task.children, row);
        });
    };
    walk(allTasks, null);
    return rowOf;
};

// 의존성을 걸 수 있는 id 전부에 대해 소유 작업과 표시 이름을 모은다.
// 이름 규칙은 타임라인 툴팁(dependencyLinks)과 같다 — 같은 연결을 두 화면이 다른 이름으로
// 부르면 대조할 수 없다.
const buildEntityIndex = (flat) => {
    const ownerOf = new Map();
    const nameOf = new Map();
    flat.forEach(task => {
        ownerOf.set(task.id, task.id);
        nameOf.set(task.id, task.name);
        (task.timeRanges || []).forEach((r, i) => {
            if (!r.id) return;
            ownerOf.set(r.id, task.id);
            nameOf.set(r.id, r.label || `${task.name} (기간 ${i + 1})`);
        });
        (task.milestones || []).forEach(m => {
            ownerOf.set(m.id, task.id);
            nameOf.set(m.id, m.label || task.name);
        });
    });
    return { ownerOf, nameOf };
};

// 행 하나의 심각도. 순환(구조 결함) > 일정 위반 > 끊어진 참조.
// 인스펙터 배지·타임라인 화살표와 같은 우선순위다.
const worstIssue = (entry) => {
    const all = [...entry.predecessors, ...entry.successors].map(e => e.issue);
    if (all.includes('cycle')) return 'cycle';
    if (all.includes('overlap')) return 'overlap';
    return entry.broken > 0 ? 'broken' : null;
};

/**
 * @param allTasks   필터·접기를 거치지 않은 전체 트리(TableView 의 tasks 는 필터를 거친 것이다)
 * @param visibleIds Set<taskId> — 지금 표가 실제로 그리는 행들
 * @param dependencyIssues findDependencyIssues(allTasks) 의 결과. 간선 목록(successors)과
 *                   판정(edgeIssues·dangling)을 여기서 다시 계산하지 않는다 — 두 곳에서
 *                   계산하면 표와 인스펙터가 다른 말을 하게 된다.
 * @returns Map<rowTaskId, { predecessors, successors, broken, issue }>
 *   predecessors/successors [{ name, via, issue }] — 상대의 표시 이름, via = 이 행이 아니라
 *     **숨은 하위**가 들고 있는 연결일 때 그 하위의 이름(아니면 null), issue = 그 간선의 문제.
 *   broken  이 행(과 그 숨은 하위)이 들고 있는 끊어진 참조 수.
 *   연결이 하나도 없는 행은 **항목 자체가 없다** — 화면이 "—" 를 그린다.
 */
export const summarizeRowDependencies = (allTasks, visibleIds, dependencyIssues) => {
    const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds || []);
    const flat = flattenAll(allTasks || []);
    const { ownerOf, nameOf } = buildEntityIndex(flat);
    const rowOf = buildRowMap(allTasks || [], visible);

    const rows = new Map();
    const entryFor = (rowId) => {
        if (!rows.has(rowId)) rows.set(rowId, { predecessors: [], successors: [], broken: 0, issue: null });
        return rows.get(rowId);
    };
    const rowFor = (entityId) => rowOf.get(ownerOf.get(entityId)) || null;

    (dependencyIssues?.successors || new Map()).forEach((holders, depId) => {
        holders.forEach(holderId => {
            const fromRow = rowFor(depId);
            const toRow = rowFor(holderId);
            // 양 끝이 같은 행으로 모이면 세지 않는다(대개 한 작업 안의 기간끼리, 또는 접힌
            // 가지 안에서 닫힌 연결). 그 행에 "선행 1 후행 1" 을 세우면 자기 자신과 연결된
            // 것처럼 읽히고, 펼치면 바로 드러나므로 감춰진 것도 아니다.
            if (fromRow && toRow && fromRow === toRow) return;
            const issue = dependencyIssues?.edgeIssues?.[dependencyEdgeKey(depId, holderId)] || null;
            // via = 이 연결을 실제로 들고 있는 **숨은 자손** 쪽 이름. 행이 자기 것을 들고
            // 있으면 null 이다. 이름 없이 "하위의 연결"이라고만 하면 어느 자손인지 읽을 수
            // 없어서, 결국 펼쳐 보기 전에는 아무것도 모르는 것과 같다.
            if (toRow) {
                entryFor(toRow).predecessors.push({
                    name: nameOf.get(depId),
                    via: ownerOf.get(holderId) === toRow ? null : nameOf.get(holderId),
                    issue,
                });
            }
            if (fromRow) {
                entryFor(fromRow).successors.push({
                    name: nameOf.get(holderId),
                    via: ownerOf.get(depId) === fromRow ? null : nameOf.get(depId),
                    issue,
                });
            }
        });
    });

    // 끊어진 참조는 상대가 없어 방향을 그릴 수 없다 — 수만 센다(정리는 인스펙터에서).
    (dependencyIssues?.dangling || []).forEach(({ holderId }) => {
        const row = rowFor(holderId);
        if (row) entryFor(row).broken += 1;
    });

    rows.forEach(entry => { entry.issue = worstIssue(entry); });
    return rows;
};

const ISSUE_TEXT = {
    cycle: '순환 의존성',
    overlap: '일정 위반 — 후행이 선행 종료보다 먼저 시작한다',
    broken: '끊어진 참조 — 삭제된 항목을 가리킨다',
};

// 배지의 툴팁. 이름을 싣지 않으면 "무언가 걸려 있다"까지만 말하는 셈이라,
// 인스펙터를 열지 않고는 상대를 알 수 없다 — 표에 배지를 다는 이유가 절반 사라진다.
export const describeRowDependencies = (entry) => {
    if (!entry) return '';
    const line = ({ name, via }) => (via ? `${name} (하위 ${via})` : name);
    const parts = [];
    if (entry.predecessors.length > 0) parts.push(`선행: ${entry.predecessors.map(line).join(', ')}`);
    if (entry.successors.length > 0) parts.push(`후행: ${entry.successors.map(line).join(', ')}`);
    if (entry.broken > 0) parts.push(`끊어진 참조 ${entry.broken}건`);
    if (entry.issue) parts.push(ISSUE_TEXT[entry.issue]);
    parts.push('클릭하면 인스펙터에서 본다');
    return parts.join('\n');
};
