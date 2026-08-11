// 트리 조작 순수함수 단위 테스트.
//
// 왜 이 파일이 최우선인가: 이 함수들은 undo/redo 히스토리에 들어가는 트리를 만든다.
// 여기서 불변성이 깨지거나 노드를 잃으면 사용자 데이터가 조용히 손상된다.
// 실사 시점에 이 모듈의 테스트는 0건이었고, Phase 2의 대규모 리팩토링은
// 이 테스트가 안전망으로 존재해야 착수할 수 있다.
import { describe, it, expect } from 'vitest';
import {
    updateTaskInTree,
    deleteFromTree,
    addToParent,
    findTaskAndParent,
    isDescendant,
    indentTask,
    outdentTask,
    regenerateIds,
    recalcTaskBounds,
    recalcTaskBoundsSafe,
    isTaskOverdue,
    getTaskStatus,
    shiftTaskDates,
    findOwnerOfEntity,
    moveTaskInTree,
    flattenAll,
    collectEntities,
    summarizeTask,
    orderRangeDates,
    patchRange,
    appendRange,
    removeRange,
    patchMilestone,
    removeMilestone,
    milestonesInDateOrder,
    planDependencyRemoval,
    expandAncestors,
    filterTasksByQuery,
    taskMatchesQuery,
    findDependencyIssues,
    wouldCreateDependencyCycle,
    dependencyEdgeKey,
    collectOwnedIds,
    pruneDependencies,
} from '../../src/utils/taskTree.js';

// 테스트용 트리 빌더 — children 은 항상 배열로 채운다 (정규화된 데이터 형태)
const node = (id, extra = {}) => ({
    id,
    name: id,
    children: [],
    timeRanges: [],
    milestones: [],
    ...extra,
});

const sampleTree = () => [
    node('a', {
        expanded: true,
        children: [node('a1'), node('a2', { children: [node('a2x')], expanded: true })],
    }),
    node('b'),
    node('c'),
];

describe('updateTaskInTree', () => {
    it('중첩된 노드를 갱신한다', () => {
        const next = updateTaskInTree(sampleTree(), 'a2x', { name: '변경됨' });
        expect(next[0].children[1].children[0].name).toBe('변경됨');
    });

    it('원본 트리를 변경하지 않는다 (불변성)', () => {
        const tree = sampleTree();
        const snapshot = structuredClone(tree);
        updateTaskInTree(tree, 'a1', { name: 'x' });
        expect(tree).toEqual(snapshot);
    });

    it('없는 id면 트리를 그대로 둔다', () => {
        const tree = sampleTree();
        expect(updateTaskInTree(tree, 'nope', { name: 'x' })).toEqual(tree);
    });
});

describe('deleteFromTree', () => {
    it('최상위 노드를 삭제한다', () => {
        const next = deleteFromTree(sampleTree(), 'b');
        expect(next.map(t => t.id)).toEqual(['a', 'c']);
    });

    it('하위 노드를 서브트리째 삭제한다', () => {
        const next = deleteFromTree(sampleTree(), 'a2');
        expect(next[0].children.map(t => t.id)).toEqual(['a1']);
    });

    it('children 이 없는 노드가 섞여 있어도 죽지 않는다', () => {
        // 가져오기(import) 경로는 migrateTaskData 를 거치지 않는 분기가 있어
        // children 이 없는 노드가 트리에 들어올 수 있다.
        const tree = [{ id: 'x', name: 'x' }, node('y')];
        expect(() => deleteFromTree(tree, 'y')).not.toThrow();
        expect(deleteFromTree(tree, 'y').map(t => t.id)).toEqual(['x']);
    });
});

describe('addToParent', () => {
    it('부모의 children 끝에 추가하고 부모를 펼친다', () => {
        const next = addToParent(sampleTree(), 'a', node('a3'));
        expect(next[0].children.map(t => t.id)).toEqual(['a1', 'a2', 'a3']);
        expect(next[0].expanded).toBe(true);
    });

    it('children 이 없는 부모에도 추가할 수 있다', () => {
        const tree = [{ id: 'p', name: 'p' }];
        expect(() => addToParent(tree, 'p', node('c1'))).not.toThrow();
        expect(addToParent(tree, 'p', node('c1'))[0].children.map(t => t.id)).toEqual(['c1']);
    });
});

describe('findTaskAndParent', () => {
    it('부모와 인덱스를 함께 반환한다', () => {
        const found = findTaskAndParent(sampleTree(), 'a2');
        expect(found.task.id).toBe('a2');
        expect(found.parent.id).toBe('a');
        expect(found.index).toBe(1);
    });

    it('최상위 노드는 parent 가 null 이다', () => {
        expect(findTaskAndParent(sampleTree(), 'b').parent).toBeNull();
    });

    it('없으면 null', () => {
        expect(findTaskAndParent(sampleTree(), 'zzz')).toBeNull();
    });
});

describe('isDescendant', () => {
    it('직계/간접 자손을 모두 찾는다', () => {
        const a = sampleTree()[0];
        expect(isDescendant(a, 'a1')).toBe(true);
        expect(isDescendant(a, 'a2x')).toBe(true);
    });

    it('자손이 아니면 false', () => {
        expect(isDescendant(sampleTree()[0], 'b')).toBe(false);
    });
});

describe('indentTask', () => {
    it('바로 위 형제의 자식으로 이동시킨다', () => {
        const next = indentTask(sampleTree(), 'b');
        expect(next.map(t => t.id)).toEqual(['a', 'c']);
        expect(next[0].children.map(t => t.id)).toEqual(['a1', 'a2', 'b']);
    });

    it('첫 번째 항목은 들여쓸 수 없다', () => {
        const tree = sampleTree();
        expect(indentTask(tree, 'a')).toBe(tree); // 동일 참조 = 변경 없음
    });

    it('하위 레벨에서도 동작한다', () => {
        const next = indentTask(sampleTree(), 'a2');
        expect(next[0].children.map(t => t.id)).toEqual(['a1']);
        expect(next[0].children[0].children.map(t => t.id)).toEqual(['a2']);
    });

    it('노드를 잃지 않는다', () => {
        const count = (items) =>
            items.reduce((n, t) => n + 1 + count(t.children || []), 0);
        const before = count(sampleTree());
        expect(count(indentTask(sampleTree(), 'b'))).toBe(before);
    });
});

describe('outdentTask', () => {
    it('부모의 다음 형제로 이동시킨다', () => {
        const next = outdentTask(sampleTree(), 'a1');
        expect(next.map(t => t.id)).toEqual(['a', 'a1', 'b', 'c']);
        expect(next[0].children.map(t => t.id)).toEqual(['a2']);
    });

    it('최상위 노드는 내어쓸 수 없다', () => {
        const tree = sampleTree();
        expect(outdentTask(tree, 'b')).toBe(tree);
    });

    it('항상 배열을 반환한다', () => {
        expect(Array.isArray(outdentTask(sampleTree(), 'a'))).toBe(true);
        expect(Array.isArray(outdentTask(sampleTree(), 'a2x'))).toBe(true);
    });

    it('indent 후 outdent 하면 원래 구조로 돌아온다', () => {
        const ids = (items) => items.map(t => [t.id, ids(t.children || [])]);
        const tree = sampleTree();
        const round = outdentTask(indentTask(tree, 'b'), 'b');
        expect(ids(round)).toEqual(ids(tree));
    });
});

describe('regenerateIds', () => {
    // 기간에 의존성을 실은 작업 둘 — 병합 가져오기가 실제로 다루는 모양이다
    const linkedPair = () => [
        node('a', {
            timeRanges: [{ id: 'ra', startDate: '2026-03-01', endDate: '2026-03-05', dependencies: [] }],
            milestones: [{ id: 'm1', label: 'M', date: '2026-03-05', dependencies: ['ra'] }],
        }),
        node('b', {
            timeRanges: [{ id: 'rb', startDate: '2026-03-06', endDate: '2026-03-10', dependencies: ['ra'] }],
        }),
    ];

    it('모든 id 를 새로 만들고 묶음 밖을 가리키는 의존성은 버린다', () => {
        const tree = [
            node('a', {
                children: [node('a1')],
                milestones: [{ id: 'm1', label: 'M' }],
                dependencies: ['b'],
            }),
        ];
        const next = regenerateIds(tree);
        expect(next[0].id).not.toBe('a');
        expect(next[0].children[0].id).not.toBe('a1');
        expect(next[0].milestones[0].id).not.toBe('m1');
        expect(next[0].dependencies).toEqual([]);
    });

    it('생성된 id 는 서로 중복되지 않는다', () => {
        const tree = Array.from({ length: 30 }, (_, i) => node(`n${i}`));
        const ids = regenerateIds(tree).map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('기간 id 도 새로 발급한다 — 같은 파일을 두 번 병합해도 겹치지 않는다', () => {
        const [first, second] = [regenerateIds(linkedPair()), regenerateIds(linkedPair())];
        const rangeIds = [...first, ...second].flatMap(t => t.timeRanges.map(r => r.id));
        expect(rangeIds).not.toContain('ra');
        expect(new Set(rangeIds).size).toBe(rangeIds.length);
    });

    it('묶음 안에서 완결되는 의존성은 새 id 로 다시 잇는다', () => {
        const [a, b] = regenerateIds(linkedPair());
        // 사본 b 의 기간은 **사본 a** 의 기간을 가리킨다 (원본 'ra' 가 아니라)
        expect(b.timeRanges[0].dependencies).toEqual([a.timeRanges[0].id]);
        // 마일스톤이 보유한 의존성도 같은 규칙을 따른다
        expect(a.milestones[0].dependencies).toEqual([a.timeRanges[0].id]);
    });

    it('dependencies 가 없던 보유자에게 빈 배열을 만들지 않는다', () => {
        const [a] = regenerateIds([
            node('a', { timeRanges: [{ id: 'ra', startDate: '2026-03-01', endDate: '2026-03-05' }] }),
        ]);
        expect('dependencies' in a.timeRanges[0]).toBe(false);
    });

    it('원본 트리를 변경하지 않는다 (불변성)', () => {
        const tree = linkedPair();
        const snapshot = structuredClone(tree);
        regenerateIds(tree);
        expect(tree).toEqual(snapshot);
    });

    it('같은 id 가 두 번 들어 있어도 서로 다른 id 로 갈라 준다', () => {
        const next = regenerateIds([node('dup'), node('dup')]);
        expect(next[0].id).not.toBe(next[1].id);
    });
});

describe('recalcTaskBounds', () => {
    it('여러 기간의 최소 시작일과 최대 종료일을 구한다', () => {
        const bounds = recalcTaskBounds([
            { startDate: '2026-03-01', endDate: '2026-03-31' },
            { startDate: '2026-01-15', endDate: '2026-02-10' },
        ]);
        expect(bounds).toEqual({ startDate: '2026-01-15', endDate: '2026-03-31' });
    });

    it('기간이 없으면 null', () => {
        expect(recalcTaskBounds([])).toBeNull();
        expect(recalcTaskBounds(null)).toBeNull();
    });
});

describe('recalcTaskBoundsSafe', () => {
    it('잘못된 날짜는 무시한다', () => {
        const bounds = recalcTaskBoundsSafe([
            { startDate: 'not-a-date', endDate: 'nope' },
            { startDate: '2026-05-01', endDate: '2026-05-31' },
        ]);
        expect(bounds).toEqual({ startDate: '2026-05-01', endDate: '2026-05-31' });
    });

    it('계산 불가면 빈 문자열 (기존 시맨틱 유지)', () => {
        expect(recalcTaskBoundsSafe([])).toEqual({ startDate: '', endDate: '' });
        expect(recalcTaskBoundsSafe(undefined)).toEqual({ startDate: '', endDate: '' });
    });
});

describe('isTaskOverdue', () => {
    const today = '2026-08-05';

    it('종료일이 과거이고 미완료면 지연', () => {
        const task = node('t', { timeRanges: [{ startDate: '2026-01-01', endDate: '2026-07-01' }] });
        expect(isTaskOverdue(task, today)).toBe(true);
    });

    it('progress 100 이면 지연이 아니다', () => {
        const task = node('t', {
            progress: 100,
            timeRanges: [{ startDate: '2026-01-01', endDate: '2026-07-01' }],
        });
        expect(isTaskOverdue(task, today)).toBe(false);
    });

    it('종료일이 미래면 지연이 아니다', () => {
        const task = node('t', { timeRanges: [{ startDate: '2026-09-01', endDate: '2026-09-30' }] });
        expect(isTaskOverdue(task, today)).toBe(false);
    });

    it('오늘이 종료일이면 지연이 아니다 (경계값)', () => {
        const task = node('t', { timeRanges: [{ startDate: '2026-08-01', endDate: today }] });
        expect(isTaskOverdue(task, today)).toBe(false);
    });

    it('기간이 없으면 지연이 아니다', () => {
        expect(isTaskOverdue(node('t'), today)).toBe(false);
    });
});

describe('getTaskStatus', () => {
    const today = '2026-08-05';
    const ranges = (startDate, endDate) => ({ timeRanges: [{ startDate, endDate }] });

    it('progress 100 이면 날짜와 무관하게 완료', () => {
        const task = node('t', { progress: 100, ...ranges('2026-01-01', '2026-07-01') });
        expect(getTaskStatus(task, today)).toBe('done');
    });

    it('종료일이 과거이고 미완료면 지연', () => {
        expect(getTaskStatus(node('t', ranges('2026-01-01', '2026-07-01')), today)).toBe('overdue');
    });

    it('시작일이 미래면 예정', () => {
        expect(getTaskStatus(node('t', ranges('2026-09-01', '2026-09-30')), today)).toBe('upcoming');
    });

    it('오늘이 기간 안이면 진행중', () => {
        expect(getTaskStatus(node('t', ranges('2026-08-01', '2026-08-31')), today)).toBe('active');
    });

    it('경계값: 오늘이 시작일/종료일이면 진행중', () => {
        expect(getTaskStatus(node('t', ranges(today, '2026-08-31')), today)).toBe('active');
        expect(getTaskStatus(node('t', ranges('2026-01-01', today)), today)).toBe('active');
    });

    it('여러 기간은 전체 범위로 판정한다', () => {
        const task = node('t', {
            timeRanges: [
                { startDate: '2026-01-01', endDate: '2026-02-01' },
                { startDate: '2026-12-01', endDate: '2026-12-31' },
            ],
        });
        expect(getTaskStatus(task, today)).toBe('active');
    });

    it('기간이 없으면 none — 칠할 바가 없다', () => {
        expect(getTaskStatus(node('t'), today)).toBe('none');
    });
});

describe('shiftTaskDates', () => {
    const withRanges = (...pairs) => node('t', {
        timeRanges: pairs.map(([startDate, endDate], i) => ({ id: `r${i}`, startDate, endDate })),
    });

    it('모든 기간을 통째로 옮기고 상위 경계를 다시 계산한다', () => {
        const patch = shiftTaskDates(withRanges(['2026-03-01', '2026-03-10'], ['2026-04-01', '2026-04-05']), 1);
        expect(patch.timeRanges.map(r => [r.startDate, r.endDate])).toEqual([
            ['2026-03-02', '2026-03-11'],
            ['2026-04-02', '2026-04-06'],
        ]);
        expect(patch).toMatchObject({ startDate: '2026-03-02', endDate: '2026-04-06' });
    });

    it('음수면 앞당긴다 — 월 경계를 넘어도 정확하다', () => {
        const patch = shiftTaskDates(withRanges(['2026-03-01', '2026-03-10']), -1);
        expect(patch.timeRanges[0]).toMatchObject({ startDate: '2026-02-28', endDate: '2026-03-09' });
    });

    it('윤년 2/29 를 건너뛰지 않는다', () => {
        const patch = shiftTaskDates(withRanges(['2028-02-28', '2028-02-28']), 1);
        expect(patch.timeRanges[0].startDate).toBe('2028-02-29');
    });

    it('resize 는 종료일만 움직인다', () => {
        const patch = shiftTaskDates(withRanges(['2026-03-01', '2026-03-10']), 3, 'resize');
        expect(patch.timeRanges[0]).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-13' });
    });

    it('resize 로 하루 미만이 되지는 않는다', () => {
        const patch = shiftTaskDates(withRanges(['2026-03-01', '2026-03-01']), -1, 'resize');
        expect(patch).toBeNull(); // 이미 최소 길이 — 바뀔 것이 없다
    });

    it('기간이 없거나 0일 이동이면 null (히스토리를 더럽히지 않는다)', () => {
        expect(shiftTaskDates(node('t'), 1)).toBeNull();
        expect(shiftTaskDates(withRanges(['2026-03-01', '2026-03-10']), 0)).toBeNull();
    });

    it('원본 작업을 변경하지 않는다 (불변성)', () => {
        const task = withRanges(['2026-03-01', '2026-03-10']);
        const snapshot = structuredClone(task);
        shiftTaskDates(task, 7);
        expect(task).toEqual(snapshot);
    });

    it('기간의 다른 필드(색·의존성)는 보존한다', () => {
        const task = node('t', {
            timeRanges: [{ id: 'r1', startDate: '2026-03-01', endDate: '2026-03-10', color: '#abc', dependencies: ['x'] }],
        });
        expect(shiftTaskDates(task, 1).timeRanges[0]).toMatchObject({ id: 'r1', color: '#abc', dependencies: ['x'] });
    });
});

describe('findOwnerOfEntity', () => {
    const flat = [
        node('t1', { timeRanges: [{ id: 'r1' }], milestones: [{ id: 'm1' }] }),
        node('t2'),
    ];

    it('작업 자신을 찾는다', () => {
        expect(findOwnerOfEntity(flat, 't2')).toEqual({ task: flat[1], kind: 'task' });
    });

    it('기간의 소유 작업을 찾는다', () => {
        const owner = findOwnerOfEntity(flat, 'r1');
        expect(owner.kind).toBe('range');
        expect(owner.task.id).toBe('t1');
    });

    it('마일스톤의 소유 작업을 찾는다', () => {
        const owner = findOwnerOfEntity(flat, 'm1');
        expect(owner.kind).toBe('milestone');
        expect(owner.task.id).toBe('t1');
    });

    it('없으면 null', () => {
        expect(findOwnerOfEntity(flat, 'ghost')).toBeNull();
    });
});

// ── moveTaskInTree (드래그 앤 드롭 재배치) ────────────────────────────────
//
// App.jsx 안에 인라인 클로저로 있어서 테스트가 0건이던 로직. 앱에서 사용자가 가장
// 자주 만지고 가장 자주 깨지는 부분이라 불변식(노드 총량 보존, 순환 금지)을 함께 검증한다.
describe('moveTaskInTree', () => {
    // 모든 id 를 깊이 우선으로 수집 — 이동이 노드를 잃거나 복제하지 않았는지 확인용
    const allIds = (items) =>
        items.flatMap(t => [t.id, ...allIds(t.children || [])]).sort();

    const flatTree = () => [node('a'), node('b'), node('c'), node('d')];

    const ordered = (items) => items.map(t => t.id);

    describe('같은 레벨 순서 변경', () => {
        it('아래로 이동하면 대상의 뒤에 놓인다', () => {
            const result = moveTaskInTree(flatTree(), 'a', 'c');
            expect(ordered(result)).toEqual(['b', 'c', 'a', 'd']);
        });

        it('위로 이동하면 대상의 앞에 놓인다', () => {
            const result = moveTaskInTree(flatTree(), 'd', 'b');
            expect(ordered(result)).toEqual(['a', 'd', 'b', 'c']);
        });

        it('바로 아래 이웃과 교환된다', () => {
            expect(ordered(moveTaskInTree(flatTree(), 'a', 'b'))).toEqual(['b', 'a', 'c', 'd']);
        });

        it('노드를 잃거나 복제하지 않는다', () => {
            const before = flatTree();
            const after = moveTaskInTree(before, 'a', 'c');
            expect(allIds(after)).toEqual(allIds(before));
        });
    });

    describe('이동 불가 조건 — 원본 참조를 그대로 반환한다', () => {
        it('자기 자신 위로', () => {
            const tree = flatTree();
            expect(moveTaskInTree(tree, 'a', 'a')).toBe(tree);
        });

        it('존재하지 않는 active', () => {
            const tree = flatTree();
            expect(moveTaskInTree(tree, 'ghost', 'a')).toBe(tree);
        });

        it('존재하지 않는 over', () => {
            const tree = flatTree();
            expect(moveTaskInTree(tree, 'a', 'ghost')).toBe(tree);
        });

        it('자기 서브트리 안으로 (순환 참조)', () => {
            const tree = [
                node('p', { expanded: true, children: [node('c1'), node('c2')] }),
                node('z'),
            ];
            expect(moveTaskInTree(tree, 'p', 'c1')).toBe(tree);
            expect(moveTaskInTree(tree, 'p', 'c2')).toBe(tree);
        });

        it('접힌(collapsed) 자손 안으로도 막는다', () => {
            const tree = [node('p', { children: [node('c1')] }), node('z')];
            expect(moveTaskInTree(tree, 'p', 'c1')).toBe(tree);
        });
    });

    describe('불변성', () => {
        it('원본 트리를 변경하지 않는다', () => {
            const tree = flatTree();
            const snapshot = JSON.stringify(tree);
            moveTaskInTree(tree, 'a', 'c');
            expect(JSON.stringify(tree)).toBe(snapshot);
        });

        it('반환된 트리는 원본과 노드 객체를 공유하지 않는다', () => {
            const tree = flatTree();
            const result = moveTaskInTree(tree, 'a', 'c');
            expect(result.find(t => t.id === 'a')).not.toBe(tree.find(t => t.id === 'a'));
        });
    });

    describe('(A) 최상위 → 하위 위로 드래그: 최상위 조상으로 매핑', () => {
        // 최상위 항목이 우연히 남의 자식이 되어 화면에서 사라지는 것을 막는 규칙
        const tree = () => [
            node('g', { expanded: true, children: [node('g1'), node('g2')] }),
            node('x'),
        ];

        it('아래 방향: 그룹의 하위 위에 놓으면 그룹 뒤 형제가 된다', () => {
            const result = moveTaskInTree([node('x'), ...tree().slice(0, 1)], 'x', 'g1');
            // x(0) → g1 의 최상위 조상 g(1) 로 매핑, 아래 방향이므로 g 뒤
            expect(ordered(result)).toEqual(['g', 'x']);
            expect(result[0].children.map(t => t.id)).toEqual(['g1', 'g2']);
        });

        it('위 방향: 그룹의 하위 위에 놓으면 그룹 앞 형제가 된다', () => {
            const result = moveTaskInTree(tree(), 'x', 'g2');
            expect(ordered(result)).toEqual(['x', 'g']);
            expect(result[1].children.map(t => t.id)).toEqual(['g1', 'g2']);
        });

        it('하위 항목은 매핑되지 않는다 (하위끼리는 그대로 순서 변경)', () => {
            const t = [node('g', { expanded: true, children: [node('g1'), node('g2')] })];
            const result = moveTaskInTree(t, 'g1', 'g2');
            expect(result[0].children.map(c => c.id)).toEqual(['g2', 'g1']);
        });
    });

    describe('(B) 펼쳐진 그룹 위로 아래 방향 드래그 → 첫 자식으로', () => {
        const tree = () => [
            node('x'),
            node('g', { expanded: true, children: [node('g1'), node('g2')] }),
        ];

        it('자식이 있고 펼쳐져 있으면 첫 자식이 된다', () => {
            const result = moveTaskInTree(tree(), 'x', 'g');
            expect(ordered(result)).toEqual(['g']);
            expect(result[0].children.map(t => t.id)).toEqual(['x', 'g1', 'g2']);
        });

        it('접혀 있으면 자식으로 넣지 않고 뒤 형제가 된다', () => {
            const t = [node('x'), node('g', { expanded: false, children: [node('g1')] })];
            const result = moveTaskInTree(t, 'x', 'g');
            expect(ordered(result)).toEqual(['g', 'x']);
        });

        it('빈 작업은 Leaf 로 취급한다 (안에 넣으려면 들여쓰기 제스처를 쓴다)', () => {
            const t = [node('x'), node('empty', { expanded: true, children: [] })];
            const result = moveTaskInTree(t, 'x', 'empty');
            expect(ordered(result)).toEqual(['empty', 'x']);
        });

        it('위 방향 드래그는 자식으로 넣지 않는다 (앞 형제가 된다)', () => {
            const t = [
                node('g', { expanded: true, children: [node('g1')] }),
                node('x'),
            ];
            const result = moveTaskInTree(t, 'x', 'g');
            expect(ordered(result)).toEqual(['x', 'g']);
            expect(result[1].children.map(c => c.id)).toEqual(['g1']);
        });
    });

    describe('부모 간 이동', () => {
        const tree = () => [
            node('p1', { expanded: true, children: [node('a1'), node('a2')] }),
            node('p2', { expanded: true, children: [node('b1')] }),
        ];

        it('다른 부모의 자식 위로 이동하면 그 부모로 옮겨간다', () => {
            const result = moveTaskInTree(tree(), 'a1', 'b1');
            expect(result[0].children.map(t => t.id)).toEqual(['a2']);
            expect(result[1].children.map(t => t.id)).toEqual(['b1', 'a1']);
        });

        it('서브트리를 통째로 데려간다', () => {
            const t = [
                node('p1', { expanded: true, children: [node('a1', { children: [node('deep')] })] }),
                node('p2', { expanded: true, children: [node('b1')] }),
            ];
            const result = moveTaskInTree(t, 'a1', 'b1');
            const moved = result[1].children.find(c => c.id === 'a1');
            expect(moved.children.map(c => c.id)).toEqual(['deep']);
            expect(allIds(result)).toEqual(allIds(t));
        });
    });
});

// ── 인스펙터 패널이 쓰는 파생 계산 ───────────────────────────────
// 화면이 아니라 여기서 계산하는 이유가 곧 이 테스트의 존재 이유다.

describe('flattenAll', () => {
    it('접힌 가지까지 전부 내려간다 (flattenTasks 와 다른 점)', () => {
        const tree = [node('a', { expanded: false, children: [node('a1', { children: [node('a1x')] })] })];
        expect(flattenAll(tree).map(t => t.id)).toEqual(['a', 'a1', 'a1x']);
    });

    it('깊이를 level 로 붙인다', () => {
        const tree = [node('a', { children: [node('a1', { children: [node('a1x')] })] })];
        expect(flattenAll(tree).map(t => t.level)).toEqual([0, 1, 2]);
    });

    it('children 이 없는 노드에서도 죽지 않는다', () => {
        expect(flattenAll([{ id: 'x' }]).map(t => t.id)).toEqual(['x']);
        expect(flattenAll(undefined)).toEqual([]);
    });
});

describe('collectEntities', () => {
    const flat = [
        node('t1', {
            name: '작업1',
            timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05' }],
            milestones: [{ id: 'm1', date: '2026-01-03', label: '킥오프' }],
        }),
    ];

    it('작업·마일스톤·기간을 한 배열로 모은다', () => {
        expect(collectEntities(flat).map(e => e.id)).toEqual(['t1', 'm1', 'r1']);
    });

    it('라벨이 없으면 표시용 이름을 만들어 준다', () => {
        const entities = collectEntities(flat);
        expect(entities.find(e => e.id === 'r1').name).toBe('작업1 (Period 1)');
        expect(entities.find(e => e.id === 'm1').name).toBe('킥오프');
    });

    it('마일스톤·기간에 소유 작업 id 를 붙인다', () => {
        const entities = collectEntities(flat);
        expect(entities.find(e => e.id === 'r1').parentId).toBe('t1');
        expect(entities.find(e => e.id === 'm1').type).toBe('milestone');
    });
});

describe('summarizeTask', () => {
    const TODAY = '2026-06-15';

    const tree = () => [
        node('parent', {
            name: '상위',
            expanded: true,
            children: [
                node('child', {
                    name: '자식',
                    progress: 40,
                    timeRanges: [
                        { id: 'r2', startDate: '2026-06-10', endDate: '2026-06-20' },
                        { id: 'r1', startDate: '2026-06-01', endDate: '2026-06-05', dependencies: ['other'] },
                    ],
                    milestones: [
                        { id: 'm2', date: '2026-06-18', label: '중간' },
                        { id: 'm1', date: '2026-06-02', label: '시작' },
                    ],
                }),
                node('child2', { progress: 100 }),
            ],
        }),
        node('other', { name: '다른 작업', dependencies: [] }),
        node('follower', { name: '따라오는 작업', dependencies: ['child'] }),
    ];

    it('없는 id 나 빈 선택이면 null', () => {
        expect(summarizeTask(tree(), 'nope', TODAY)).toBeNull();
        expect(summarizeTask(tree(), null, TODAY)).toBeNull();
    });

    it('접힌 가지 안의 작업도 찾는다', () => {
        const collapsed = [node('a', { expanded: false, children: [node('hidden')] })];
        expect(summarizeTask(collapsed, 'hidden', TODAY).task.id).toBe('hidden');
    });

    it('전체 기간·소요 일수를 양끝 포함으로 계산한다', () => {
        const s = summarizeTask(tree(), 'child', TODAY);
        expect([s.startDate, s.endDate]).toEqual(['2026-06-01', '2026-06-20']);
        expect(s.durationDays).toBe(20);
    });

    it('남은 일수는 오늘부터 종료일까지고, 지났으면 음수다', () => {
        expect(summarizeTask(tree(), 'child', TODAY).daysToEnd).toBe(5);
        expect(summarizeTask(tree(), 'child', '2026-06-25').daysToEnd).toBe(-5);
    });

    it('날짜가 없으면 기간 관련 값이 전부 null 이다', () => {
        const s = summarizeTask(tree(), 'other', TODAY);
        expect(s.durationDays).toBeNull();
        expect(s.daysToEnd).toBeNull();
        expect(s.status).toBe('none');
    });

    it('기간과 마일스톤을 날짜순으로 정렬해 돌려준다', () => {
        const s = summarizeTask(tree(), 'child', TODAY);
        expect(s.ranges.map(r => r.id)).toEqual(['r1', 'r2']);
        expect(s.milestones.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    it('원본 작업의 배열을 제자리에서 정렬하지 않는다 (불변성)', () => {
        const t = tree();
        const before = structuredClone(t);
        summarizeTask(t, 'child', TODAY);
        expect(t).toEqual(before);
    });

    it('하위 진행률은 자손 평균이고, 자손이 없으면 null 이다', () => {
        expect(summarizeTask(tree(), 'parent', TODAY).rollupProgress).toBe(70); // (40 + 100) / 2
        expect(summarizeTask(tree(), 'child', TODAY).rollupProgress).toBeNull();
        expect(summarizeTask(tree(), 'parent', TODAY).descendantCount).toBe(2);
        expect(summarizeTask(tree(), 'parent', TODAY).childCount).toBe(2);
    });

    it('기간에 걸린 의존성도 선행으로 잡는다 (작업 id 만 보면 놓친다)', () => {
        const s = summarizeTask(tree(), 'child', TODAY);
        expect(s.predecessors.map(e => e.id)).toEqual(['other']);
    });

    it('자신을 참조하는 쪽을 후행으로 잡는다', () => {
        const s = summarizeTask(tree(), 'child', TODAY);
        expect(s.successors.map(e => e.id)).toEqual(['follower']);
    });

    it('자기 자신이 앞뒤 목록에 들어가지 않는다', () => {
        const selfDep = [node('x', {
            dependencies: ['x-r1'],
            timeRanges: [{ id: 'x-r1', startDate: '2026-06-01', endDate: '2026-06-02' }],
        })];
        const s = summarizeTask(selfDep, 'x', TODAY);
        expect(s.predecessors).toEqual([]);
        expect(s.successors).toEqual([]);
    });

    it('부모 이름을 알려 주고, 최상위면 null 이다', () => {
        expect(summarizeTask(tree(), 'child', TODAY).parentName).toBe('상위');
        expect(summarizeTask(tree(), 'other', TODAY).parentName).toBeNull();
    });

    it('상태 판정은 getTaskStatus 와 같은 값을 쓴다', () => {
        const s = summarizeTask(tree(), 'child', TODAY);
        expect(s.status).toBe(getTaskStatus(s.task, TODAY));
        expect(s.status).toBe('active');
    });
});

// 역전된 기간(종료 < 시작)은 화면에서 폭 0 이라 **아무것도 보이지 않는다**.
// 마우스 리사이즈는 경계에서 멈추고 키보드는 종료일을 맞추고 서버는 400 으로 거부하는데,
// 타이핑(인스펙터·표의 date 입력)만 그대로 통과하고 있었다.
describe('orderRangeDates', () => {
    const range = { id: 'r', startDate: '2026-06-10', endDate: '2026-06-20' };

    it('순서가 맞으면 받은 patch 를 그대로 돌려준다 (참조 동일 — 헛 객체를 만들지 않는다)', () => {
        const patch = { endDate: '2026-06-25' };
        expect(orderRangeDates(range, patch)).toBe(patch);
    });

    it('날짜를 건드리지 않는 patch 는 판정 대상이 아니다', () => {
        const patch = { label: '설계', color: '#fff' };
        expect(orderRangeDates(range, patch)).toBe(patch);
    });

    it('종료일만 편집해 역전되면 **종료일만** 시작일로 되돌린다', () => {
        // 손대지 않은 시작일까지 옮기면 사용자가 요청하지 않은 변경이 된다
        expect(orderRangeDates(range, { endDate: '2026-06-01' })).toEqual({ endDate: '2026-06-10' });
    });

    it('시작일만 편집해 역전되면 **시작일만** 종료일로 되돌린다', () => {
        expect(orderRangeDates(range, { startDate: '2026-06-30' })).toEqual({ startDate: '2026-06-20' });
    });

    it('양쪽을 함께 준 역전은 편집한 쪽을 가릴 수 없으므로 시작일을 따른다', () => {
        expect(orderRangeDates(range, { startDate: '2026-07-01', endDate: '2026-06-01' }))
            .toEqual({ startDate: '2026-07-01', endDate: '2026-07-01' });
    });

    it('한쪽이 비어 있으면 역전인지 판정할 근거가 없다 — 그대로 둔다', () => {
        const patch = { endDate: '2026-06-01' };
        expect(orderRangeDates({ id: 'r' }, patch)).toBe(patch);
        expect(orderRangeDates(range, { startDate: '' })).toEqual({ startDate: '' });
    });

    it('같은 날(시작 = 종료)은 역전이 아니다', () => {
        const patch = { endDate: '2026-06-10' };
        expect(orderRangeDates(range, patch)).toBe(patch);
    });

    it('되돌린 결과를 한 번 더 통과시켜도 그대로다 (patchRange 가 두 번 적용해도 안전)', () => {
        const once = orderRangeDates(range, { endDate: '2026-06-01' });
        expect(orderRangeDates(range, once)).toBe(once);
    });
});

// 인스펙터가 기간을 고치는 유일한 경로 (v2 에서 TimelineBarPopover 를 흡수하며 추출).
// 팝오버 시절에는 호출부마다 map + bounds 재계산을 손으로 썼고, 라벨·색 변경 경로는
// 재계산을 아예 빠뜨리고 있었다.
describe('patchRange / appendRange / removeRange', () => {
    const task = () => node('t', {
        color: '#111111',
        timeRanges: [
            { id: 'r1', startDate: '2026-06-01', endDate: '2026-06-05' },
            { id: 'r2', startDate: '2026-06-10', endDate: '2026-06-20' },
        ],
    });

    it('patchRange 는 지정 기간만 고치고 전체 bounds 를 재계산한다', () => {
        const patch = patchRange(task(), 'r2', { endDate: '2026-06-30' });
        expect(patch.timeRanges.map(r => r.endDate)).toEqual(['2026-06-05', '2026-06-30']);
        expect(patch).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-30' });
    });

    it('patchRange 는 날짜가 아닌 속성을 바꿀 때도 bounds 를 함께 돌려준다', () => {
        const patch = patchRange(task(), 'r1', { label: '설계', barHeight: 24 });
        expect(patch.timeRanges[0]).toMatchObject({ label: '설계', barHeight: 24 });
        expect(patch).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-20' });
    });

    it('patchRange 대상 기간이 없으면 null (빈 undo 항목을 만들지 않는다)', () => {
        expect(patchRange(task(), 'nope', { label: 'x' })).toBeNull();
        expect(patchRange(node('empty'), 'r1', { label: 'x' })).toBeNull();
    });

    it('patchRange 는 원본을 제자리에서 바꾸지 않는다', () => {
        const t = task();
        const before = structuredClone(t);
        patchRange(t, 'r1', { label: '설계' });
        expect(t).toEqual(before);
    });

    it('patchRange 는 종료일을 시작일보다 앞으로 보내면 시작일로 되돌린다', () => {
        const patch = patchRange(task(), 'r2', { endDate: '2026-06-01' });
        // 편집한 종료일만 경계로 되돌아가고 시작일은 그대로다
        expect(patch.timeRanges[1]).toMatchObject({ startDate: '2026-06-10', endDate: '2026-06-10' });
        expect(patch).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-10' });
    });

    it('patchRange 는 시작일을 종료일보다 뒤로 보내면 종료일로 되돌린다', () => {
        const patch = patchRange(task(), 'r1', { startDate: '2026-06-30' });
        expect(patch.timeRanges[0]).toMatchObject({ startDate: '2026-06-05', endDate: '2026-06-05' });
    });

    it('appendRange 는 하루짜리 기간을 붙이고 bounds 를 넓힌다', () => {
        const patch = appendRange(task(), '2026-07-01');
        expect(patch.timeRanges).toHaveLength(3);
        expect(patch.timeRanges[2]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-01' });
        expect(patch.endDate).toBe('2026-07-01');
    });

    it('appendRange 는 기간이 없고 레거시 날짜가 남아 있으면 그것을 먼저 기간으로 승격한다', () => {
        const legacy = node('l', { startDate: '2026-05-01', endDate: '2026-05-10' });
        const patch = appendRange(legacy, '2026-06-01');
        expect(patch.timeRanges).toHaveLength(2);
        expect(patch.timeRanges[0]).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-10' });
        // 승격하지 않으면 여기서 레거시 날짜가 조용히 사라진다
        expect(patch).toMatchObject({ startDate: '2026-05-01', endDate: '2026-06-01' });
    });

    it('appendRange 는 날짜가 아예 없는 작업에는 기간 하나만 만든다', () => {
        const patch = appendRange(node('n'), '2026-06-01');
        expect(patch.timeRanges).toHaveLength(1);
        expect(patch).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-01' });
    });

    it('removeRange 는 남은 기간으로 bounds 를 다시 계산한다', () => {
        const patch = removeRange(task(), 'r2');
        expect(patch.timeRanges.map(r => r.id)).toEqual(['r1']);
        expect(patch).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-05' });
    });

    it('removeRange 로 마지막 기간이 사라지면 bounds 는 빈 문자열이다 (바가 남지 않게)', () => {
        const one = node('o', { timeRanges: [{ id: 'r1', startDate: '2026-06-01', endDate: '2026-06-05' }] });
        expect(removeRange(one, 'r1')).toEqual({ timeRanges: [], startDate: '', endDate: '' });
    });

    it('removeRange 대상이 없으면 null', () => {
        expect(removeRange(task(), 'nope')).toBeNull();
    });
});

describe('patchMilestone / removeMilestone', () => {
    const task = () => node('t', {
        timeRanges: [{ id: 'r1', startDate: '2026-06-01', endDate: '2026-06-05' }],
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        milestones: [
            { id: 'm1', date: '2026-06-03', label: '중간', color: '#5CB85C', shape: 'circle' },
            { id: 'm2', date: '2026-06-20', label: '최종', color: '#D9534F', shape: 'diamond' },
        ],
    });

    it('patchMilestone 은 지정 마일스톤만 고친다', () => {
        const patch = patchMilestone(task(), 'm2', { label: '릴리즈', shape: 'star' });
        expect(patch.milestones[1]).toMatchObject({ id: 'm2', label: '릴리즈', shape: 'star', date: '2026-06-20' });
        expect(patch.milestones[0]).toMatchObject({ id: 'm1', label: '중간' });
    });

    it('patchMilestone 은 bounds 를 건드리지 않는다 — 마일스톤은 기간이 아니다', () => {
        // 기간 밖(2026-06-20)의 마일스톤을 옮겨도 작업의 시작·종료일은 그대로여야 한다.
        // 여기서 recalc 를 돌리면 기간이 없는 작업의 bounds 가 빈 문자열로 덮인다.
        const patch = patchMilestone(task(), 'm2', { date: '2026-07-01' });
        expect(patch).toEqual({ milestones: patch.milestones });
        expect(patch.startDate).toBeUndefined();
        expect(patch.endDate).toBeUndefined();
    });

    it('patchMilestone 대상이 없으면 null (빈 undo 항목을 만들지 않는다)', () => {
        expect(patchMilestone(task(), 'nope', { label: 'x' })).toBeNull();
        expect(patchMilestone(node('empty'), 'm1', { label: 'x' })).toBeNull();
    });

    it('patchMilestone 은 원본을 제자리에서 바꾸지 않는다', () => {
        const t = task();
        const before = structuredClone(t);
        patchMilestone(t, 'm1', { label: '바뀜' });
        expect(t).toEqual(before);
    });

    it('removeMilestone 은 해당 건만 빼고 나머지를 보존한다', () => {
        const patch = removeMilestone(task(), 'm1');
        expect(patch.milestones.map(m => m.id)).toEqual(['m2']);
    });

    it('removeMilestone 대상이 없으면 null', () => {
        expect(removeMilestone(task(), 'nope')).toBeNull();
        expect(removeMilestone(node('empty'), 'm1')).toBeNull();
    });
});

// 표의 미리보기와 인스펙터의 카드 목록은 같은 순서여야 한다 — 표에서 미리보기를 누르면
// "첫 마일스톤"이 포커스되는데, 두 목록의 1번이 다르면 무엇을 지목했는지 읽을 수 없다.
describe('milestonesInDateOrder', () => {
    it('날짜 오름차순으로 정렬한다 (입력 순서와 무관)', () => {
        const task = node('t', {
            milestones: [
                { id: 'm2', date: '2026-06-20' },
                { id: 'm1', date: '2026-06-03' },
                { id: 'm3', date: '2026-12-01' },
            ],
        });
        expect(milestonesInDateOrder(task).map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('summarizeTask 의 마일스톤 순서와 일치한다', () => {
        const task = node('t', {
            milestones: [
                { id: 'm2', date: '2026-06-20' },
                { id: 'm1', date: '2026-06-03' },
            ],
        });
        const summary = summarizeTask([task], 't', '2026-06-10');
        expect(summary.milestones.map(m => m.id)).toEqual(milestonesInDateOrder(task).map(m => m.id));
    });

    it('마일스톤이 없거나 task 가 없어도 빈 배열', () => {
        expect(milestonesInDateOrder(node('t'))).toEqual([]);
        expect(milestonesInDateOrder(undefined)).toEqual([]);
        expect(milestonesInDateOrder(null)).toEqual([]);
    });

    it('원본 배열을 제자리에서 정렬하지 않는다', () => {
        const task = node('t', {
            milestones: [{ id: 'm2', date: '2026-06-20' }, { id: 'm1', date: '2026-06-03' }],
        });
        milestonesInDateOrder(task);
        expect(task.milestones.map(m => m.id)).toEqual(['m2', 'm1']);
    });

    it('날짜가 없는 마일스톤도 떨어뜨리지 않는다', () => {
        const task = node('t', {
            milestones: [{ id: 'm1', date: '2026-06-03' }, { id: 'm2' }],
        });
        expect(milestonesInDateOrder(task)).toHaveLength(2);
    });
});

describe('planDependencyRemoval', () => {
    const tree = () => [
        node('holder', {
            dependencies: ['dep', 'keep'],
            timeRanges: [
                { id: 'hr1', startDate: '2026-06-01', endDate: '2026-06-02', dependencies: ['dep'] },
                { id: 'hr2', startDate: '2026-06-03', endDate: '2026-06-04', dependencies: ['dep'] },
            ],
            milestones: [{ id: 'hm1', date: '2026-06-05', dependencies: ['dep', 'keep'] }],
        }),
        node('dep'),
    ];
    const flat = () => flattenAll(tree());

    it('작업이 보유한 의존성은 dependencies 를 갱신한다', () => {
        expect(planDependencyRemoval(flat(), 'holder', 'dep'))
            .toEqual({ taskId: 'holder', updates: { dependencies: ['keep'] } });
    });

    it('기간이 보유한 의존성은 그 기간만 갱신한다', () => {
        const plan = planDependencyRemoval(flat(), 'hr1', 'dep');
        expect(plan.taskId).toBe('holder');
        expect(plan.updates.timeRanges.map(r => r.dependencies)).toEqual([[], ['dep']]);
    });

    it('마일스톤이 보유한 의존성은 milestones 를 갱신한다', () => {
        const plan = planDependencyRemoval(flat(), 'hm1', 'dep');
        expect(plan.taskId).toBe('holder');
        expect(plan.updates.milestones[0].dependencies).toEqual(['keep']);
    });

    it('보유자를 못 찾으면 null', () => {
        expect(planDependencyRemoval(flat(), 'ghost', 'dep')).toBeNull();
    });
});

// 앞뒤 목록에서 연결을 제거하려면 "누가 의존성을 들고 있는지"를 알아야 한다.
describe('summarizeTask — 의존성 제거용 상대 정보', () => {
    const TODAY = '2026-06-15';

    it('선행에는 내 쪽 보유자(holderId)가 붙는다 — 기간이 들고 있으면 기간 id', () => {
        const tree = [
            node('me', {
                dependencies: ['viaTask'],
                timeRanges: [{ id: 'r1', startDate: '2026-06-01', endDate: '2026-06-02', dependencies: ['viaRange'] }],
                milestones: [{ id: 'm1', date: '2026-06-03', dependencies: ['viaMs'] }],
            }),
            node('viaTask'), node('viaRange'), node('viaMs'),
        ];
        const holders = Object.fromEntries(
            summarizeTask(tree, 'me', TODAY).predecessors.map(p => [p.id, p.holderId]));
        expect(holders).toEqual({ viaTask: 'me', viaRange: 'r1', viaMs: 'm1' });
    });

    it('후행에는 상대가 참조하는 내 쪽 id(depId)가 붙는다', () => {
        const tree = [
            node('me', { timeRanges: [{ id: 'r1', startDate: '2026-06-01', endDate: '2026-06-02' }] }),
            node('afterTask', { dependencies: ['me'] }),
            node('afterRange', { dependencies: ['r1'] }),
        ];
        const deps = Object.fromEntries(
            summarizeTask(tree, 'me', TODAY).successors.map(s => [s.id, s.depId]));
        expect(deps).toEqual({ afterTask: 'me', afterRange: 'r1' });
    });

    it('상대 정보를 얹어도 원본 엔티티를 오염시키지 않는다', () => {
        const tree = [node('me', { dependencies: ['p'] }), node('p')];
        const before = structuredClone(tree);
        summarizeTask(tree, 'me', TODAY);
        expect(tree).toEqual(before);
    });
});

describe('expandAncestors', () => {
    // 접힌 부모 아래 숨은 작업으로 명령 팔레트가 이동할 때 쓴다.
    const collapsedTree = () => [
        node('a', {
            expanded: false,
            children: [node('a1', { expanded: false, children: [node('a1x')] })],
        }),
        node('b'),
    ];

    it('조상 사슬을 전부 펼친다', () => {
        const next = expandAncestors(collapsedTree(), 'a1x');
        expect(next[0].expanded).toBe(true);
        expect(next[0].children[0].expanded).toBe(true);
    });

    it('대상 작업 자신은 펼치지 않는다 — 접어 둔 자식은 접힌 채로 둔다', () => {
        const next = expandAncestors(collapsedTree(), 'a1');
        expect(next[0].expanded).toBe(true);
        expect(next[0].children[0].expanded).toBe(false);
    });

    it('이미 다 펼쳐져 있으면 null (빈 상태 변경을 만들지 않는다)', () => {
        expect(expandAncestors(sampleTree(), 'a2x')).toBeNull();
    });

    it('최상위 작업이거나 없는 작업이면 null', () => {
        expect(expandAncestors(collapsedTree(), 'b')).toBeNull();
        expect(expandAncestors(collapsedTree(), '없음')).toBeNull();
    });

    it('형제 가지는 건드리지 않고 원본도 바꾸지 않는다', () => {
        const tree = collapsedTree();
        const before = structuredClone(tree);
        const next = expandAncestors(tree, 'a1x');
        expect(tree).toEqual(before);
        expect(next[1]).toBe(tree[1]);
    });
});

// 필터가 무엇을 남기는지의 판정. 두 곳이 이걸 쓴다 — filterTasksByQuery 와,
// "방금 추가한 작업이 지금 화면에 나타나는가"를 묻는 App.handleAddTask.
describe('taskMatchesQuery', () => {
    it('이름·설명 어느 쪽이든 포함하면 참', () => {
        expect(taskMatchesQuery(node('요구사항 분석'), '요구사항')).toBe(true);
        expect(taskMatchesQuery(node('a', { description: '고객 인터뷰' }), '인터뷰')).toBe(true);
    });

    it('대소문자를 구분하지 않는다', () => {
        expect(taskMatchesQuery(node('API 구현'), 'api')).toBe(true);
    });

    it('걸리지 않으면 거짓', () => {
        expect(taskMatchesQuery(node('설계'), '없는말')).toBe(false);
    });

    // 질의가 비면 필터가 없는 것이다 — 새 작업은 그대로 보이므로 검색을 해제할 이유가 없다
    it('질의가 비면 참 (필터 없음)', () => {
        expect(taskMatchesQuery(node('새 작업'), '')).toBe(true);
        expect(taskMatchesQuery(node('새 작업'), '   ')).toBe(true);
        expect(taskMatchesQuery(node('새 작업'), undefined)).toBe(true);
    });

    it('이름·설명이 없는 작업도 처리한다', () => {
        expect(taskMatchesQuery({ id: 'x' }, '무엇')).toBe(false);
        expect(taskMatchesQuery(null, '무엇')).toBe(false);
    });

    // createNewTask 의 기본 이름이라 질의에 걸릴 수도 있다 — 그때는 검색을 유지한다
    it('기본 이름 "새 작업"이 질의에 걸리는 경우를 구분한다', () => {
        expect(taskMatchesQuery(node('새 작업'), '작업')).toBe(true);
        expect(taskMatchesQuery(node('새 작업'), '설계')).toBe(false);
    });
});

describe('filterTasksByQuery', () => {
    // 접힌 부모 아래에 일치가 숨어 있는 트리 — 이 함수가 생긴 이유다.
    const tree = () => [
        node('설계', {
            expanded: false,
            children: [
                node('요구사항 분석', { description: '고객 인터뷰' }),
                node('와이어프레임'),
            ],
        }),
        node('개발', { expanded: true, children: [node('API 구현')] }),
    ];

    it('질의가 비면 원본 배열을 그대로 돌려준다 (참조 동일)', () => {
        const t = tree();
        expect(filterTasksByQuery(t, '')).toBe(t);
        expect(filterTasksByQuery(t, '   ')).toBe(t);
        expect(filterTasksByQuery(t, undefined)).toBe(t);
    });

    it('이름이 일치하는 작업과 그 조상만 남긴다', () => {
        const next = filterTasksByQuery(tree(), '요구사항');
        expect(next.map(t => t.id)).toEqual(['설계']);
        expect(next[0].children.map(t => t.id)).toEqual(['요구사항 분석']);
    });

    it('설명도 본다', () => {
        const next = filterTasksByQuery(tree(), '인터뷰');
        expect(next[0].children.map(t => t.id)).toEqual(['요구사항 분석']);
    });

    it('대소문자를 구분하지 않는다', () => {
        expect(filterTasksByQuery(tree(), 'api')[0].children.map(t => t.id)).toEqual(['API 구현']);
    });

    it('일치가 없으면 빈 배열', () => {
        expect(filterTasksByQuery(tree(), '없는말')).toEqual([]);
    });

    // 이게 이 함수의 핵심이다: 접힌 조상을 결과 트리에서 펼치지 않으면
    // flattenTasks 가 자식을 건너뛰어, 필터를 통과한 일치가 화면에 그려지지 않는다.
    it('일치를 가리고 있던 접힌 조상을 결과 트리에서 펼친다', () => {
        const next = filterTasksByQuery(tree(), '요구사항');
        expect(next[0].expanded).toBe(true);
    });

    it('자식이 남지 않은 노드의 expanded 는 손대지 않는다', () => {
        const next = filterTasksByQuery(tree(), '설계');
        expect(next[0].children).toEqual([]);
        expect(next[0].expanded).toBe(false);
    });

    it('실제 트리의 expanded 를 바꾸지 않는다 (검색은 문서를 더럽히지 않는다)', () => {
        const t = tree();
        const before = structuredClone(t);
        filterTasksByQuery(t, '요구사항');
        expect(t).toEqual(before);
    });

    it('children 이 없는 노드도 처리한다', () => {
        const raw = [{ id: 'x', name: '이름만' }];
        expect(filterTasksByQuery(raw, '이름')[0].children).toEqual([]);
    });

    // 검색 중 접기 — 강제 펼침이 사용자의 접기까지 이기면 토글이 죽은 버튼이 된다.
    // 저장된 expanded 로는 "검색 전부터 접혀 있던 것"과 구분할 수 없어 따로 받는다.
    describe('collapsedIds (검색 중에 사용자가 접은 것)', () => {
        it('집합에 든 노드는 접힌 채로 돌려준다', () => {
            const next = filterTasksByQuery(tree(), '요구사항', new Set(['설계']));
            expect(next[0].expanded).toBe(false);
        });

        it('접어도 그 노드 자체는 결과에 남는다 (다시 펼칠 행이 있어야 한다)', () => {
            const next = filterTasksByQuery(tree(), '요구사항', new Set(['설계']));
            expect(next.map(t => t.id)).toEqual(['설계']);
            expect(next[0].children.map(t => t.id)).toEqual(['요구사항 분석']);
        });

        it('집합에 없는 노드는 그대로 펼친다', () => {
            const next = filterTasksByQuery(tree(), '요구사항', new Set(['개발']));
            expect(next[0].expanded).toBe(true);
        });

        it('배열로 줘도 된다', () => {
            expect(filterTasksByQuery(tree(), '요구사항', ['설계'])[0].expanded).toBe(false);
        });

        it('생략·빈 집합이면 이전과 같다 (전부 펼침)', () => {
            expect(filterTasksByQuery(tree(), '요구사항', new Set())[0].expanded).toBe(true);
            expect(filterTasksByQuery(tree(), '요구사항', null)[0].expanded).toBe(true);
        });

        it('접기도 실제 트리를 바꾸지 않는다', () => {
            const t = tree();
            const before = structuredClone(t);
            filterTasksByQuery(t, '요구사항', new Set(['설계']));
            expect(t).toEqual(before);
        });
    });
});

describe('collectOwnedIds', () => {
    it('작업 자신 + 기간 + 마일스톤 + 자손의 것까지 모은다', () => {
        const task = node('a', {
            timeRanges: [{ id: 'r1' }],
            milestones: [{ id: 'm1' }],
            children: [node('b', { timeRanges: [{ id: 'r2' }], milestones: [{ id: 'm2' }] })],
        });
        expect([...collectOwnedIds(task)].sort()).toEqual(['a', 'b', 'm1', 'm2', 'r1', 'r2']);
    });

    it('정규화되지 않은 노드(필드 없음)도 견딘다', () => {
        expect([...collectOwnedIds({ id: 'a' })]).toEqual(['a']);
    });
});

describe('pruneDependencies', () => {
    // 보유자 세 종류(작업/기간/마일스톤)가 모두 'gone' 을 가리키는 트리
    const holdersTree = () => [
        node('a', { dependencies: ['gone', 'keep'] }),
        node('b', { timeRanges: [{ id: 'r1', dependencies: ['gone'] }] }),
        node('c', { children: [node('d', { milestones: [{ id: 'm1', dependencies: ['keep', 'gone'] }] })] }),
    ];

    it('세 종류의 보유자 모두에서 지운 id 를 걷어낸다', () => {
        const pruned = pruneDependencies(holdersTree(), ['gone']);
        expect(pruned[0].dependencies).toEqual(['keep']);
        expect(pruned[1].timeRanges[0].dependencies).toEqual([]);
        expect(pruned[2].children[0].milestones[0].dependencies).toEqual(['keep']);
    });

    it('원본을 변경하지 않는다', () => {
        const tree = holdersTree();
        pruneDependencies(tree, ['gone']);
        expect(tree[0].dependencies).toEqual(['gone', 'keep']);
    });

    it('지울 것이 없으면 트리를 그대로 돌려준다', () => {
        const tree = holdersTree();
        expect(pruneDependencies(tree, [])).toBe(tree);
    });

    it('dependencies 필드가 없던 보유자에 빈 배열을 새로 만들지 않는다', () => {
        const tree = [node('a', { timeRanges: [{ id: 'r1' }] })];
        const pruned = pruneDependencies(tree, ['gone']);
        expect(pruned[0].timeRanges[0]).not.toHaveProperty('dependencies');
    });

    it('Set 도 배열과 똑같이 받는다', () => {
        const pruned = pruneDependencies(holdersTree(), new Set(['gone', 'keep']));
        expect(pruned[0].dependencies).toEqual([]);
    });

    // 이 조합이 곧 앱의 삭제 경로다 (useTaskActions.deleteTask / 서버 taskService.deleteTask).
    it('삭제 + 정리를 조합하면 끊어진 참조가 남지 않는다', () => {
        const tree = [
            node('a', { timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-10' }] }),
            node('b', { timeRanges: [{ id: 'r2', startDate: '2026-01-11', endDate: '2026-01-20', dependencies: ['r1'] }] }),
        ];
        const gone = collectOwnedIds(tree[0]);
        expect(findDependencyIssues(deleteFromTree(tree, 'a')).dangling).toHaveLength(1);
        expect(findDependencyIssues(pruneDependencies(deleteFromTree(tree, 'a'), gone)).dangling).toEqual([]);
    });
});

describe('findDependencyIssues', () => {
    // 의존성 간선의 방향: 보유자의 dependencies 에 들어 있는 id 가 **선행**이다.
    // 즉 { id:'r2', dependencies:['r1'] } 은 r1 → r2 를 뜻한다.
    const range = (id, startDate, endDate, dependencies = []) =>
        ({ id, startDate, endDate, dependencies });

    // a(r1: 1/1~1/10) → b(r2: 1/11~1/20) — 정상 계획
    const linearTree = () => [
        node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
        node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
    ];

    it('정상 계획에는 아무 문제도 없다', () => {
        const issues = findDependencyIssues(linearTree());
        expect(issues.cycles).toEqual([]);
        expect(issues.overlaps).toEqual([]);
        expect(issues.dangling).toEqual([]);
        expect(issues.edgeIssues).toEqual({});
    });

    it('후행이 선행 종료보다 먼저 시작하면 overlap 이다', () => {
        const tree = linearTree();
        tree[1].timeRanges[0].startDate = '2026-01-06';
        const issues = findDependencyIssues(tree);
        expect(issues.overlaps).toHaveLength(1);
        expect(issues.overlaps[0]).toMatchObject({
            fromId: 'r1', toId: 'r2', fromEnd: '2026-01-10', toStart: '2026-01-06', days: 4,
        });
        expect(issues.edgeIssues[dependencyEdgeKey('r1', 'r2')]).toBe('overlap');
    });

    it('같은 날 인계(후행 시작 = 선행 종료)는 위반이 아니다 — 오탐을 만들지 않는다', () => {
        const tree = linearTree();
        tree[1].timeRanges[0].startDate = '2026-01-10';
        expect(findDependencyIssues(tree).overlaps).toEqual([]);
    });

    it('날짜가 없는 쪽이 있으면 판정 근거가 없으므로 건너뛴다', () => {
        const tree = linearTree();
        tree[0].timeRanges = [];
        expect(findDependencyIssues(tree).overlaps).toEqual([]);
    });

    it('마일스톤은 한 점으로 다룬다 — 그 날 이전에 시작하는 후행만 위반이다', () => {
        const tree = [
            node('a', { milestones: [{ id: 'm1', date: '2026-01-10', label: 'M1' }] }),
            node('b', { timeRanges: [range('r2', '2026-01-09', '2026-01-20', ['m1'])] }),
        ];
        expect(findDependencyIssues(tree).overlaps).toHaveLength(1);
        tree[1].timeRanges[0].startDate = '2026-01-10';
        expect(findDependencyIssues(tree).overlaps).toEqual([]);
    });

    it('순환을 찾아내고 그 간선 전부에 cycle 을 붙인다', () => {
        const tree = [
            node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r3'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
            node('c', { timeRanges: [range('r3', '2026-01-21', '2026-01-30', ['r2'])] }),
        ];
        const issues = findDependencyIssues(tree);
        expect(issues.cycles).toHaveLength(1);
        expect([...issues.cycles[0].ids].sort()).toEqual(['r1', 'r2', 'r3']);
        expect(Object.values(issues.edgeIssues)).toEqual(['cycle', 'cycle', 'cycle']);
    });

    it('같은 순환을 여러 간선에서 발견해도 한 번만 보고한다', () => {
        const tree = [
            node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r2'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
        ];
        expect(findDependencyIssues(tree).cycles).toHaveLength(1);
    });

    it('자기 자신을 가리키는 참조도 순환이다', () => {
        const tree = [node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r1'])] })];
        const issues = findDependencyIssues(tree);
        expect(issues.cycles).toEqual([{ ids: ['r1'], names: [expect.any(String)] }]);
    });

    it('순환인 간선에는 overlap 을 함께 붙이지 않는다 — 구조 결함이 앞선다', () => {
        const tree = [
            node('a', { timeRanges: [range('r1', '2026-01-11', '2026-01-20', ['r2'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-01', '2026-01-10', ['r1'])] }),
        ];
        const issues = findDependencyIssues(tree);
        expect(issues.overlaps).toEqual([]);
        expect(issues.edgeIssues[dependencyEdgeKey('r1', 'r2')]).toBe('cycle');
    });

    it('지워진 상대를 가리키는 참조는 dangling 이다 (deleteFromTree 가 남긴다)', () => {
        const tree = linearTree();
        const pruned = deleteFromTree(tree, 'a');
        const issues = findDependencyIssues(pruned);
        expect(issues.dangling).toEqual([{ holderId: 'r2', holderName: expect.any(String), missingId: 'r1' }]);
        expect(issues.edgeIssues).toEqual({}); // 그릴 화살표 자체가 없다
    });

    it('접힌 가지 안의 의존성도 본다', () => {
        const tree = [
            node('p', {
                expanded: false,
                children: [
                    node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
                    node('b', { timeRanges: [range('r2', '2026-01-05', '2026-01-20', ['r1'])] }),
                ],
            }),
        ];
        expect(findDependencyIssues(tree).overlaps).toHaveLength(1);
    });

    it('레거시 작업 단위 의존성도 간선으로 센다', () => {
        const tree = [
            node('a', { startDate: '2026-01-01', endDate: '2026-01-10' }),
            node('b', { startDate: '2026-01-05', endDate: '2026-01-20', dependencies: ['a'] }),
        ];
        const issues = findDependencyIssues(tree);
        expect(issues.overlaps).toHaveLength(1);
        expect(issues.overlaps[0]).toMatchObject({ fromId: 'a', toId: 'b' });
    });

    it('빈 트리에서도 죽지 않는다', () => {
        const issues = findDependencyIssues([]);
        expect(issues.cycles).toEqual([]);
        expect(issues.successors.size).toBe(0);
    });
});

describe('wouldCreateDependencyCycle', () => {
    // r1 → r2 → r3 사슬
    const chain = () => findDependencyIssues([
        node('a', { timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-10', dependencies: [] }] }),
        node('b', { timeRanges: [{ id: 'r2', startDate: '2026-01-11', endDate: '2026-01-20', dependencies: ['r1'] }] }),
        node('c', { timeRanges: [{ id: 'r3', startDate: '2026-01-21', endDate: '2026-01-30', dependencies: ['r2'] }] }),
    ]).successors;

    it('후행에서 선행으로 되돌리는 연결은 순환이다', () => {
        expect(wouldCreateDependencyCycle(chain(), 'r3', 'r1')).toBe(true);
    });

    it('사슬을 더 잇는 연결은 순환이 아니다', () => {
        expect(wouldCreateDependencyCycle(chain(), 'r3', 'r4')).toBe(false);
    });

    it('자기 자신으로의 연결은 순환이다', () => {
        expect(wouldCreateDependencyCycle(chain(), 'r1', 'r1')).toBe(true);
    });

    it('한쪽이 비어 있으면 false (판정할 것이 없다)', () => {
        expect(wouldCreateDependencyCycle(chain(), null, 'r1')).toBe(false);
        expect(wouldCreateDependencyCycle(undefined, 'r1', 'r2')).toBe(false);
    });
});
