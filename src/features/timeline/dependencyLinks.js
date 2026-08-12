// 의존성 간선을 "지금 화면에 어떻게 그릴 수 있는가"로 해석한다. 순수 함수만 — React 도,
// DOM 도, 픽셀도 모른다(좌표는 timelineGeometry.itemAnchor 가 낸다).
//
// 화살표의 양 끝은 **화면의 행**에 앉는다(itemAnchor 가 index 로 y 를 정한다). 그래서 한쪽
// 끝이 화면에 없으면 그릴 좌표가 없다. 예전에는 그런 간선을 **조용히 버렸다** — 가지 하나를
// 접거나 검색을 걸면 화살표가 그냥 사라졌고, "연결이 있는데 지금 보이지 않는다"를 사용자가
// 알 방법이 전혀 없었다(인스펙터 배지는 선택한 작업 하나만 말한다). 연결을 지운 것과
// 화면 밖으로 나간 것이 똑같아 보이는 것이 이 화면의 가장 조용한 거짓말이었다.
//
// 끝이 화면에서 사라지는 두 경우는 성질이 다르고, 그래서 결과도 다르다:
//   ① 보이는 조상이 있다(대개 접힌 가지 안) — 그 조상 행이 그 가지를 대표한다. 그 행으로
//      **끌어올려 그린다**(rolled up). x 는 숨은 항목 자신의 날짜라 시간 위치는 정확하고,
//      y 만 대표 행으로 온다. 접었을 때 요약 막대에 의존성이 모이는 것은 간트의 통상 동작이다.
//   ② 조상까지 전부 화면에 없다(검색 필터 밖) — 끌어올릴 행이 없다. 그리지 않고, **보이는
//      쪽 끝에 "여기서 화면 밖으로 나가는 연결이 있다"는 표식**을 남긴다.
// 어느 쪽이든 상대의 이름을 함께 돌려준다 — 화면이 그것을 툴팁에 싣는다. 끌어올린 선이
// 어느 자손의 것인지는 이름으로만 읽을 수 있다.
import { flattenAll } from '../../utils/taskTree';
import { taskItemEntries } from './timelineGeometry';

// 화면에 행이 없는 항목을 "가장 가까운 보이는 조상의 행"으로 끌어올린 해석 맵.
// itemMap(보이는 것) 을 복사해 시작하므로 보이는 항목의 좌표는 그대로다.
const buildResolutionMap = (itemMap, allTasks) => {
    const resolved = new Map(itemMap);

    const walk = (items, hostIndex) => {
        (items || []).forEach(task => {
            const visible = itemMap.get(task.id);
            if (visible) {
                walk(task.children, visible.index);
                return;
            }
            // 보이는 조상이 하나도 없으면(hostIndex === null) 끌어올릴 행이 없다 — ② 로 간다.
            if (hostIndex !== null) {
                taskItemEntries(task, hostIndex).forEach(([id, item]) => {
                    if (!resolved.has(id)) resolved.set(id, { ...item, rolledUp: true });
                });
            }
            walk(task.children, hostIndex);
        });
    };

    walk(allTasks, null);
    return resolved;
};

// 항목이 실제로 어느 행에 그려지는가 — 마일스톤만 parentIndex 를 쓴다(itemAnchor 와 같은 규칙).
const rowOf = (item) => (item.type === 'milestone' ? item.parentIndex : item.index);

/**
 * @param itemMap  buildItemMap(flatTasks) — **화면에 행이 있는** 항목만
 * @param allTasks 필터·접기를 거치지 않은 전체 트리(TimelineView 의 tasks 는 필터를 거친 것이다)
 * @returns {{ links, hiddenEdges }}
 *   links       [{ source, target, rolledUpNames }] — 그릴 수 있는 간선. rolledUpNames 가
 *               비어 있지 않으면 그 이름들이 끌어올려진 끝이다.
 *   hiddenEdges [{ item, edge, names }] — 보이는 쪽 끝 하나와, 그 끝에서 화면 밖으로
 *               나가는 상대들의 이름. edge 는 'end'(보이는 쪽이 선행) | 'start'(후행).
 */
export const resolveDependencyLinks = (itemMap, allTasks) => {
    const flat = flattenAll(allTasks || []);
    const resolved = buildResolutionMap(itemMap, allTasks || []);

    // 상대의 이름 — 끌어올린 선과 표식의 툴팁이 쓴다. 여기 없는 id 는 **끊어진 참조**이고
    // 그것은 findDependencyIssues 가 진단한다. 없는 상대를 "화면 밖에 있다"고 말하지 않는다.
    const nameById = new Map();
    flat.forEach(task => {
        nameById.set(task.id, task.name);
        (task.timeRanges || []).forEach((r, i) => {
            if (r.id) nameById.set(r.id, r.label || `${task.name} (기간 ${i + 1})`);
        });
        (task.milestones || []).forEach(m => nameById.set(m.id, m.label || task.name));
    });

    const links = [];
    const hidden = new Map();

    const markHidden = (item, edge, counterpartId) => {
        const key = `${item.data.id}:${edge}`;
        if (!hidden.has(key)) hidden.set(key, { item, edge, names: [] });
        hidden.get(key).names.push(nameById.get(counterpartId));
    };

    // 간선을 모으는 범위는 예전 그대로다 — 기간·마일스톤이 보유한 dependencies 만.
    // 작업 단위 dependencies 는 레거시라 이 화면이 후행으로 그린 적이 없고, 여기서 새로
    // 그리기 시작하면 이번 수정과 무관한 화살표가 늘어난다(진단은 이미 그것도 본다).
    // 달라진 것은 **보이는 작업이 아니라 전체 트리**를 훑는다는 것뿐이다: 보유자가 숨어 있고
    // 상대가 보이는 간선은 예전에는 아예 열거되지도 않았다.
    const addEdge = (dependencies, holderId) => {
        (dependencies || []).forEach(depId => {
            const source = resolved.get(depId);
            const target = resolved.get(holderId);

            if (source && target) {
                // 양쪽 다 끌어올려져 같은 행에 앉으면 그리지 않는다 — 그 선은 어느 자손
                // 사이의 연결인지 말해 주지 못하고 대표 막대 위에 겹칠 뿐이다. 그 행은
                // 화면에 있으므로 펼치면 바로 드러난다(감춰진 것이 아니다).
                if (source.rolledUp && target.rolledUp && rowOf(source) === rowOf(target)) return;
                const rolledUpNames = [
                    ...(source.rolledUp ? [nameById.get(depId)] : []),
                    ...(target.rolledUp ? [nameById.get(holderId)] : []),
                ];
                links.push({ source, target, rolledUpNames });
                return;
            }
            if (source && nameById.has(holderId)) markHidden(source, 'end', holderId);
            if (target && nameById.has(depId)) markHidden(target, 'start', depId);
        });
    };

    flat.forEach(task => {
        (task.timeRanges || []).forEach(range => addEdge(range.dependencies, range.id));
        (task.milestones || []).forEach(ms => addEdge(ms.dependencies, ms.id));
    });

    return { links, hiddenEdges: [...hidden.values()] };
};
