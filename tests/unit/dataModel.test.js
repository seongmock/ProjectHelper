// `dataModel` — 트리의 모양을 정하는 곳. 특히 `migrateTaskData` 는 **모든 로드 경로에서
// 무조건 호출된다**(서버 응답·localStorage 폴백·가져오기·샘플 데이터). 여기서 필드 하나를
// 흘리면 화면에는 아무 오류도 뜨지 않고 그 데이터가 그대로 저장돼 덮어써진다 — 조용한 소실이다.
import { describe, it, expect } from 'vitest';
import {
    createNewTask, generateId, formatDate, flattenTasks, migrateTaskData, getSampleData,
} from '../../src/utils/dataModel.js';

describe('createNewTask — 작업은 반드시 이 함수로 만든다', () => {
    it('필수 필드를 모두 갖춘 채로 나온다', () => {
        const task = createNewTask();
        expect(task).toMatchObject({
            name: '새 작업',
            children: [],
            expanded: true,
            progress: 0,
            milestones: [],
            dependencies: [],
            labels: [],
            parentId: null,
        });
        expect(task.divider).toMatchObject({ enabled: false });
    });

    it('기간 하나를 들고 나오고, 그 기간도 id 와 dependencies 를 갖는다', () => {
        const [range] = createNewTask().timeRanges;
        expect(range.id).toBeTruthy();
        expect(range.dependencies).toEqual([]);
        expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('기본 기간은 역전되지 않는다 (역전된 기간은 0px 막대가 된다)', () => {
        const [range] = createNewTask().timeRanges;
        expect(range.startDate <= range.endDate).toBe(true);
    });

    it('작업 id 와 기간 id 는 서로 다르다', () => {
        const task = createNewTask();
        expect(task.id).not.toBe(task.timeRanges[0].id);
    });

    it('이름과 부모를 받는다', () => {
        expect(createNewTask('설계', 'task-1')).toMatchObject({ name: '설계', parentId: 'task-1' });
    });
});

describe('generateId', () => {
    it('연달아 만들어도 겹치지 않는다', () => {
        const ids = new Set(Array.from({ length: 2000 }, generateId));
        expect(ids.size).toBe(2000);
    });
});

describe('formatDate', () => {
    it('문자열은 그대로 통과한다', () => {
        expect(formatDate('2026-08-19')).toBe('2026-08-19');
    });

    it('Date 를 저장 형식으로 만든다', () => {
        expect(formatDate(new Date(2026, 7, 9))).toBe('2026-08-09');
    });
});

describe('flattenTasks — 화면에 그려지는 행은 이것이 정한다', () => {
    const tree = [{
        id: 'a', name: 'A', expanded: true, children: [
            { id: 'a1', name: 'A1', expanded: false, children: [{ id: 'a1x', name: 'A1X', children: [] }] },
            { id: 'a2', name: 'A2', children: [] },
        ],
    }, { id: 'b', name: 'B', children: [] }];

    it('깊이를 level 로 실어 준다', () => {
        expect(flattenTasks(tree).map(t => [t.id, t.level]))
            .toEqual([['a', 0], ['a1', 1], ['a2', 1], ['b', 0]]);
    });

    it('접힌 가지의 자손은 행이 없다 — 요약 막대가 필요해지는 이유다', () => {
        expect(flattenTasks(tree).find(t => t.id === 'a1x')).toBeUndefined();
    });

    it('원본을 건드리지 않는다 (히스토리가 트리를 통째로 들고 있다)', () => {
        const before = structuredClone(tree);
        flattenTasks(tree);
        expect(tree).toEqual(before);
    });

    it('빈 트리는 빈 배열', () => {
        expect(flattenTasks([])).toEqual([]);
    });
});

describe('migrateTaskData — 모든 로드가 통과하는 관문', () => {
    it('배열이 아니면 빈 배열이다 (깨진 저장물이 앱을 세우지 않는다)', () => {
        expect(migrateTaskData(null)).toEqual([]);
        expect(migrateTaskData(undefined)).toEqual([]);
        expect(migrateTaskData({ tasks: [] })).toEqual([]);
        expect(migrateTaskData('[]')).toEqual([]);
    });

    it('레거시 startDate/endDate 를 timeRanges 로 옮긴다', () => {
        const [task] = migrateTaskData([
            { id: 't1', name: '옛 작업', startDate: '2026-01-01', endDate: '2026-01-31', children: [] },
        ]);
        expect(task.timeRanges).toHaveLength(1);
        expect(task.timeRanges[0]).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-31', dependencies: [] });
        expect(task.timeRanges[0].id).toBeTruthy();
    });

    it('날짜가 아예 없으면 빈 timeRanges 다 (없는 일정을 지어내지 않는다)', () => {
        expect(migrateTaskData([{ id: 't1', name: '그룹', children: [] }])[0].timeRanges).toEqual([]);
    });

    it('id 나 dependencies 가 빠진 기간을 보완한다', () => {
        const [task] = migrateTaskData([
            { id: 't1', timeRanges: [{ startDate: '2026-01-01', endDate: '2026-01-02' }], children: [] },
        ]);
        expect(task.timeRanges[0].id).toBeTruthy();
        expect(task.timeRanges[0].dependencies).toEqual([]);
    });

    it('작업 레벨 dependencies 를 첫 기간으로 옮기고 원래 자리는 비운다', () => {
        const [task] = migrateTaskData([{
            id: 't2',
            dependencies: ['r-1', 'r-2'],
            timeRanges: [{ id: 'r-9', startDate: '2026-01-01', endDate: '2026-01-02', dependencies: ['r-2'] }],
            children: [],
        }]);
        // 이미 있던 것과 합치되 중복은 남기지 않는다
        expect(task.timeRanges[0].dependencies.sort()).toEqual(['r-1', 'r-2']);
        expect(task.dependencies).toEqual([]);
    });

    it('기간이 없는 작업의 작업 레벨 dependencies 는 갈 곳이 없으므로 버린다', () => {
        const [task] = migrateTaskData([{ id: 't3', dependencies: ['r-1'], children: [] }]);
        expect(task.dependencies).toEqual([]);
        expect(task.timeRanges).toEqual([]);
    });

    it('progress 를 0~100 으로 클램프하고 정수가 아니면 0 으로 되돌린다', () => {
        const tasks = migrateTaskData([
            { id: 'a', progress: 150, children: [] },
            { id: 'b', progress: -20, children: [] },
            { id: 'c', progress: 42, children: [] },
            { id: 'd', progress: '80', children: [] },
            { id: 'e', progress: 33.3, children: [] },
            { id: 'f', children: [] },
        ]);
        expect(tasks.map(t => t.progress)).toEqual([100, 0, 42, 0, 0, 0]);
    });

    it('children 이 없으면 빈 배열을 보장한다 (트리 재귀가 전부 이것을 전제한다)', () => {
        expect(migrateTaskData([{ id: 'a' }])[0].children).toEqual([]);
    });

    it('자손까지 재귀적으로 적용된다', () => {
        const [root] = migrateTaskData([{
            id: 'root',
            children: [{ id: 'kid', startDate: '2026-02-01', endDate: '2026-02-05', progress: 999 }],
        }]);
        expect(root.children[0].timeRanges[0].startDate).toBe('2026-02-01');
        expect(root.children[0].progress).toBe(100);
        expect(root.children[0].children).toEqual([]);
    });

    it('입력을 제자리에서 고치지 않는다', () => {
        const input = [{ id: 't', dependencies: ['x'], timeRanges: [{ id: 'r', dependencies: [] }], children: [] }];
        const before = structuredClone(input);
        migrateTaskData(input);
        expect(input).toEqual(before);
    });

    it('멱등하다 — 두 번 돌려도 결과가 같다 (매 로드마다 호출된다)', () => {
        const once = migrateTaskData(getSampleData());
        const twice = migrateTaskData(once);
        expect(twice).toEqual(once);
    });
});

describe('getSampleData', () => {
    it('이미 정규화된 상태로 나온다', () => {
        const sample = getSampleData();
        expect(Array.isArray(sample)).toBe(true);
        expect(sample.length).toBeGreaterThan(0);
        const walk = (nodes) => nodes.forEach(n => {
            expect(Array.isArray(n.timeRanges)).toBe(true);
            expect(Array.isArray(n.children)).toBe(true);
            n.timeRanges.forEach(r => expect(r.id).toBeTruthy());
            walk(n.children);
        });
        walk(sample);
    });

    it('id 가 트리 전체에서 유일하다', () => {
        const ids = [];
        const walk = (nodes) => nodes.forEach(n => {
            ids.push(n.id, ...n.timeRanges.map(r => r.id), ...(n.milestones || []).map(m => m.id));
            walk(n.children);
        });
        walk(getSampleData());
        expect(new Set(ids).size).toBe(ids.length);
    });
});
