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
    findOwnerOfEntity,
    moveTaskInTree,
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
    it('모든 id 를 새로 만들고 의존성을 비운다', () => {
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
