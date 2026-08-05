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
    findOwnerOfEntity,
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
