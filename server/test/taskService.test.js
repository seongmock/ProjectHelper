// 작업 도메인 로직 테스트.
//
// 이 로직들은 실사 시점에 라우트 안에 박혀 있어 HTTP를 띄우지 않으면 테스트할 수 없었고,
// 실제로 커버리지가 0이었다. Service 계층 분리(P2-4) 후 store만 주입하면 직접 호출된다.
//
// PH_DATA_DIR 을 require 전에 설정해야 한다 — store.js 는 로드 시점에 경로를 확정한다.
// (`node --test` 는 파일마다 별도 프로세스로 돌기 때문에 다른 테스트에 새지 않는다.)
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-svc-test-'));
process.env.PH_DATA_DIR = tmpRoot;

const store = require('../lib/store');
const svc = require('../services/taskService');
const { AppError } = require('../lib/errors');

let s;
let seq = 0;

before(() => { /* tmpRoot 는 모듈 로드 시점에 이미 생성됨 */ });
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// 테스트마다 새 프로젝트를 써서 상태 누수를 막는다
beforeEach(() => {
    s = store.getProjectStore(`svc-${++seq}`);
    s.writeTasks([]);
});

// AppError 를 상태코드와 메시지 조각으로 단언하는 헬퍼
const assertFails = (fn, status, messagePart) => {
    assert.throws(fn, (err) => {
        assert.ok(err instanceof AppError, `AppError 가 아니다: ${err}`);
        assert.equal(err.status, status);
        if (messagePart) assert.match(err.message, new RegExp(messagePart));
        return true;
    });
};

describe('createTask', () => {
    test('최상위 작업을 만들고 리비전을 올린다', () => {
        const before = s.readMeta().revision;
        const { task, revision } = svc.createTask(s, { name: '기획' });
        assert.equal(task.name, '기획');
        assert.equal(revision, before + 1);
        assert.deepEqual(s.readTasks().map(t => t.name), ['기획']);
    });

    test('parentId 로 자식으로 붙이고 부모를 펼친다', () => {
        const { task: parent } = svc.createTask(s, { name: '부모' });
        svc.createTask(s, { name: '자식', parentId: parent.id });

        const [root] = s.readTasks();
        assert.deepEqual(root.children.map(t => t.name), ['자식']);
        assert.equal(root.expanded, true);
    });

    test('position 으로 삽입 위치를 지정한다', () => {
        svc.createTask(s, { name: 'a' });
        svc.createTask(s, { name: 'c' });
        svc.createTask(s, { name: 'b', position: 1 });
        assert.deepEqual(s.readTasks().map(t => t.name), ['a', 'b', 'c']);
    });

    test('범위를 벗어난 position 은 끝으로 클램프된다', () => {
        svc.createTask(s, { name: 'a' });
        svc.createTask(s, { name: 'z', position: 999 });
        svc.createTask(s, { name: 'first', position: -5 });
        assert.deepEqual(s.readTasks().map(t => t.name), ['first', 'a', 'z']);
    });

    test('없는 부모면 404이고 트리는 그대로다', () => {
        svc.createTask(s, { name: 'a' });
        const revBefore = s.readMeta().revision;
        assertFails(() => svc.createTask(s, { name: 'x', parentId: 'ghost' }), 404, 'parent task');
        // 실패한 쓰기가 리비전을 올리면 클라이언트의 If-Match 가 잘못 깨진다
        assert.equal(s.readMeta().revision, revBefore);
        assert.equal(s.readTasks().length, 1);
    });

    test('name 이 없으면 400', () => {
        assertFails(() => svc.createTask(s, {}), 400, 'missing required field: name');
    });

    test('시작일과 종료일은 함께 와야 한다', () => {
        assertFails(() => svc.createTask(s, { name: 'a', startDate: '2026-01-01' }), 400, 'together');
    });

    test('종료일이 시작일보다 앞서면 400', () => {
        assertFails(
            () => svc.createTask(s, { name: 'a', startDate: '2026-03-01', endDate: '2026-01-01' }),
            400, 'endDate must be >='
        );
    });

    test('알 수 없는 필드는 거부한다 (오타로 조용히 유실되는 것 방지)', () => {
        assertFails(() => svc.createTask(s, { name: 'a', startdate: '2026-01-01' }), 400, 'unknown field');
    });
});

describe('updateTask', () => {
    test('필드를 부분 갱신한다', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        const { task: updated } = svc.updateTask(s, task.id, { name: 'b', progress: 50 });
        assert.equal(updated.name, 'b');
        assert.equal(updated.progress, 50);
    });

    test('빈 갱신은 400', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        assertFails(() => svc.updateTask(s, task.id, {}), 400, 'empty update');
    });

    test('progress 범위를 강제한다', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        assertFails(() => svc.updateTask(s, task.id, { progress: 101 }), 400, 'progress must be 0-100');
        assertFails(() => svc.updateTask(s, task.id, { progress: -1 }), 400, 'progress must be 0-100');
    });

    test('없는 작업은 404이고 리비전이 변하지 않는다', () => {
        const revBefore = s.readMeta().revision;
        assertFails(() => svc.updateTask(s, 'ghost', { name: 'x' }), 404);
        assert.equal(s.readMeta().revision, revBefore);
    });
});

describe('deleteTask', () => {
    test('서브트리째 삭제한다', () => {
        const { task: parent } = svc.createTask(s, { name: '부모' });
        svc.createTask(s, { name: '자식', parentId: parent.id });
        svc.deleteTask(s, parent.id);
        assert.deepEqual(s.readTasks(), []);
    });

    test('없는 작업은 404', () => {
        assertFails(() => svc.deleteTask(s, 'ghost'), 404);
    });
});

describe('moveTask', () => {
    test('다른 부모 밑으로 옮긴다', () => {
        const { task: a } = svc.createTask(s, { name: 'a' });
        const { task: b } = svc.createTask(s, { name: 'b' });
        svc.moveTask(s, b.id, { parentId: a.id });

        const tasks = s.readTasks();
        assert.equal(tasks.length, 1);
        assert.deepEqual(tasks[0].children.map(t => t.name), ['b']);
    });

    test('최상위로 되돌린다', () => {
        const { task: a } = svc.createTask(s, { name: 'a' });
        const { task: child } = svc.createTask(s, { name: 'child', parentId: a.id });
        svc.moveTask(s, child.id, { parentId: null, position: 0 });
        assert.deepEqual(s.readTasks().map(t => t.name), ['child', 'a']);
    });

    test('자기 자신의 서브트리로는 옮길 수 없다 (트리 소실 방지)', () => {
        const { task: a } = svc.createTask(s, { name: 'a' });
        const { task: child } = svc.createTask(s, { name: 'child', parentId: a.id });
        assertFails(() => svc.moveTask(s, a.id, { parentId: child.id }), 400, 'own subtree');
        // 실패해도 노드를 잃지 않아야 한다
        assert.equal(s.readTasks()[0].children.length, 1);
    });

    test('자기 자신을 부모로 지정할 수 없다', () => {
        const { task: a } = svc.createTask(s, { name: 'a' });
        assertFails(() => svc.moveTask(s, a.id, { parentId: a.id }), 400, 'own subtree');
    });

    test('parentId 는 필수다 (누락 시 최상위 이동으로 오해되면 안 된다)', () => {
        const { task: a } = svc.createTask(s, { name: 'a' });
        assertFails(() => svc.moveTask(s, a.id, {}), 400, 'missing required field: parentId');
    });
});

describe('timeRange CRUD', () => {
    // createNewTask 는 항상 기본 30일 기간을 하나 만든다(오늘 기준). 테스트가 오늘 날짜에
    // 흔들리지 않도록 명시적 날짜로 작업을 만들어 기간을 고정한다.
    const seeded = () => svc.createTask(s, {
        name: 'a', startDate: '2026-02-01', endDate: '2026-02-10',
    }).task;

    test('추가하면 작업의 시작/종료일이 재계산된다', () => {
        const task = seeded();
        svc.addTimeRange(s, task.id, { startDate: '2026-01-01', endDate: '2026-03-31' });

        const [t] = s.readTasks();
        assert.equal(t.timeRanges.length, 2);
        assert.equal(t.startDate, '2026-01-01');
        assert.equal(t.endDate, '2026-03-31');
    });

    test('여러 기간의 최소/최대로 경계가 잡힌다', () => {
        const task = seeded();
        svc.addTimeRange(s, task.id, { startDate: '2026-01-01', endDate: '2026-03-31' });
        svc.addTimeRange(s, task.id, { startDate: '2025-11-01', endDate: '2026-06-30' });

        const [t] = s.readTasks();
        assert.equal(t.startDate, '2025-11-01');
        assert.equal(t.endDate, '2026-06-30');
    });

    test('수정 후에도 경계가 다시 계산된다', () => {
        const task = seeded();
        const { timeRange } = svc.addTimeRange(s, task.id, { startDate: '2026-01-01', endDate: '2026-03-31' });
        svc.updateTimeRange(s, task.id, timeRange.id, { endDate: '2026-12-31' });
        assert.equal(s.readTasks()[0].endDate, '2026-12-31');
    });

    test('수정 결과가 역전된 날짜가 되면 400이고 원본이 온전하다', () => {
        const task = seeded();
        const { timeRange } = svc.addTimeRange(s, task.id, { startDate: '2026-01-01', endDate: '2026-03-31' });
        assertFails(
            () => svc.updateTimeRange(s, task.id, timeRange.id, { endDate: '2025-01-01' }),
            400, 'endDate must be >='
        );
        const stored = s.readTasks()[0].timeRanges.find(r => r.id === timeRange.id);
        assert.equal(stored.endDate, '2026-03-31');
    });

    test('삭제하면 남은 기간 기준으로 경계가 좁혀진다', () => {
        const task = seeded(); // 2026-02-01 ~ 2026-02-10
        const { timeRange: wide } = svc.addTimeRange(s, task.id, { startDate: '2025-01-01', endDate: '2027-12-31' });
        assert.equal(s.readTasks()[0].startDate, '2025-01-01');

        svc.deleteTimeRange(s, task.id, wide.id);
        const [t] = s.readTasks();
        assert.equal(t.timeRanges.length, 1);
        assert.equal(t.startDate, '2026-02-01');
        assert.equal(t.endDate, '2026-02-10');
    });

    test('없는 기간은 404 (작업 404와 구분된다)', () => {
        const task = seeded();
        assertFails(() => svc.deleteTimeRange(s, task.id, 'ghost'), 404, 'timeRange');
        assertFails(() => svc.deleteTimeRange(s, 'ghost', 'ghost'), 404, 'task');
    });

    test('날짜 형식은 YYYY-MM-DD 만 허용', () => {
        const task = seeded();
        assertFails(
            () => svc.addTimeRange(s, task.id, { startDate: '2026/01/01', endDate: '2026-03-31' }),
            400, 'valid date'
        );
    });
});

describe('마일스톤', () => {
    test('기본값이 채워져 추가된다', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        const { milestone } = svc.addMilestone(s, task.id, { date: '2026-02-01' });
        assert.equal(milestone.shape, 'diamond');
        assert.equal(milestone.color, '#5CB85C');
        assert.ok(milestone.id);
    });

    test('허용되지 않은 shape 은 거부', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        assertFails(
            () => svc.addMilestone(s, task.id, { date: '2026-02-01', shape: 'hexagon' }),
            400, 'must be one of'
        );
    });

    test('삭제', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        const { milestone } = svc.addMilestone(s, task.id, { date: '2026-02-01' });
        svc.deleteMilestone(s, task.id, milestone.id);
        assert.deepEqual(s.readTasks()[0].milestones, []);
    });

    test('없는 마일스톤은 404', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        assertFails(() => svc.deleteMilestone(s, task.id, 'ghost'), 404, 'milestone');
    });
});

describe('If-Match 리비전 (낙관적 동시성)', () => {
    test('일치하면 통과한다', () => {
        const rev = s.readMeta().revision;
        assert.doesNotThrow(() => svc.createTask(s, { name: 'a' }, String(rev)));
    });

    test('불일치하면 409이고 쓰기가 일어나지 않는다', () => {
        svc.createTask(s, { name: 'a' });
        const stale = s.readMeta().revision - 1;
        assertFails(() => svc.createTask(s, { name: 'b' }, String(stale)), 409, 'revision mismatch');
        assert.equal(s.readTasks().length, 1);
    });

    test('헤더가 없으면 검사를 건너뛴다 (하위호환)', () => {
        assert.doesNotThrow(() => svc.createTask(s, { name: 'a' }, undefined));
    });

    test('모든 변경 연산이 리비전을 검사한다', () => {
        const { task } = svc.createTask(s, { name: 'a' });
        const stale = String(s.readMeta().revision - 1);
        assertFails(() => svc.updateTask(s, task.id, { name: 'x' }, stale), 409);
        assertFails(() => svc.deleteTask(s, task.id, stale), 409);
        assertFails(() => svc.moveTask(s, task.id, { parentId: null }, stale), 409);
        assertFails(() => svc.addTimeRange(s, task.id, { startDate: '2026-01-01', endDate: '2026-01-02' }, stale), 409);
        assertFails(() => svc.addMilestone(s, task.id, { date: '2026-01-01' }, stale), 409);
    });
});

describe('조회', () => {
    test('listTasks 는 트리 그대로 반환한다', () => {
        const { task: p } = svc.createTask(s, { name: 'p' });
        svc.createTask(s, { name: 'c', parentId: p.id });
        const { tasks } = svc.listTasks(s);
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].children.length, 1);
    });

    test('flat=true 는 평탄화하고 계산된 날짜를 붙인다', () => {
        const { task: p } = svc.createTask(s, { name: 'p' });
        svc.createTask(s, {
            name: 'c', parentId: p.id, startDate: '2026-01-01', endDate: '2026-02-01',
        });

        const { tasks } = svc.listTasks(s, { flat: true });
        assert.equal(tasks.length, 2);
        const child = tasks.find(t => t.name === 'c');
        assert.equal(child.level, 1);
        assert.equal(child.parentId, p.id);
        assert.equal(child.startDate, '2026-01-01');
        assert.equal(child.endDate, '2026-02-01');
    });

    test('getTask 는 부모 id 를 함께 준다', () => {
        const { task: p } = svc.createTask(s, { name: 'p' });
        const { task: c } = svc.createTask(s, { name: 'c', parentId: p.id });

        assert.equal(svc.getTask(s, c.id).parentId, p.id);
        assert.equal(svc.getTask(s, p.id).parentId, null);
    });

    test('없는 작업 조회는 404', () => {
        assertFails(() => svc.getTask(s, 'ghost'), 404);
    });
});
