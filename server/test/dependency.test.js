// 의존성 정합성 — 라이브러리 판정(클라이언트 미러)과 서비스 계층의 쓰기 차단.
//
// 판정 규칙은 `src/utils/taskTree.js` 와 **동작 호환**이어야 한다. 여기 케이스들은
// `tests/unit/taskTree.test.js` 의 findDependencyIssues 블록과 짝을 이룬다 —
// 한쪽만 고치면 화면과 API 가 다른 말을 하게 된다.
//
// PH_DATA_DIR 을 require 전에 설정해야 한다 (store.js 는 로드 시점에 경로를 확정한다).
const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-dep-test-'));
process.env.PH_DATA_DIR = tmpRoot;

const tree = require('../lib/taskTree');
const store = require('../lib/store');
const svc = require('../services/taskService');
const { AppError } = require('../lib/errors');

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ── 픽스처 ───────────────────────────────────────────
// 간선 방향: 보유자의 dependencies 에 들어 있는 id 가 **선행**이다.
// 즉 { id:'r2', dependencies:['r1'] } 은 r1 → r2 를 뜻한다.
const range = (id, startDate, endDate, dependencies = []) =>
    ({ id, startDate, endDate, dependencies });

const node = (id, extra = {}) =>
    ({ id, name: id, children: [], timeRanges: [], milestones: [], dependencies: [], ...extra });

// a(r1: 1/1~1/10) → b(r2: 1/11~1/20) — 정상 계획
const linearTree = () => [
    node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
    node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
];

describe('findDependencyIssues (클라이언트 판정 미러)', () => {
    test('정상 계획에는 아무 문제도 없다', () => {
        const issues = tree.findDependencyIssues(linearTree());
        assert.deepEqual(issues.cycles, []);
        assert.deepEqual(issues.overlaps, []);
        assert.deepEqual(issues.dangling, []);
        assert.deepEqual(issues.edgeIssues, {});
    });

    test('후행이 선행 종료보다 먼저 시작하면 overlap 이다', () => {
        const t = linearTree();
        t[1].timeRanges[0].startDate = '2026-01-06';
        const issues = tree.findDependencyIssues(t);
        assert.equal(issues.overlaps.length, 1);
        const [o] = issues.overlaps;
        assert.equal(o.fromId, 'r1');
        assert.equal(o.toId, 'r2');
        assert.equal(o.fromEnd, '2026-01-10');
        assert.equal(o.toStart, '2026-01-06');
        assert.equal(o.days, 4);
        assert.equal(issues.edgeIssues[tree.dependencyEdgeKey('r1', 'r2')], 'overlap');
    });

    test('같은 날 인계(후행 시작 = 선행 종료)는 위반이 아니다 — 오탐을 만들지 않는다', () => {
        const t = linearTree();
        t[1].timeRanges[0].startDate = '2026-01-10';
        assert.deepEqual(tree.findDependencyIssues(t).overlaps, []);
    });

    test('날짜가 없는 쪽이 있으면 판정 근거가 없으므로 건너뛴다', () => {
        const t = linearTree();
        t[0].timeRanges = [];
        assert.deepEqual(tree.findDependencyIssues(t).overlaps, []);
    });

    test('마일스톤은 한 점으로 다룬다', () => {
        const t = [
            node('a', { milestones: [{ id: 'm1', date: '2026-01-10', label: 'M1' }] }),
            node('b', { timeRanges: [range('r2', '2026-01-09', '2026-01-20', ['m1'])] }),
        ];
        assert.equal(tree.findDependencyIssues(t).overlaps.length, 1);
        t[1].timeRanges[0].startDate = '2026-01-10';
        assert.deepEqual(tree.findDependencyIssues(t).overlaps, []);
    });

    test('순환을 찾아내고 그 간선 전부에 cycle 을 붙인다', () => {
        const t = [
            node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r3'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
            node('c', { timeRanges: [range('r3', '2026-01-21', '2026-01-30', ['r2'])] }),
        ];
        const issues = tree.findDependencyIssues(t);
        assert.equal(issues.cycles.length, 1);
        assert.deepEqual([...issues.cycles[0].ids].sort(), ['r1', 'r2', 'r3']);
        assert.deepEqual(Object.values(issues.edgeIssues), ['cycle', 'cycle', 'cycle']);
    });

    test('같은 순환을 여러 간선에서 발견해도 한 번만 보고한다', () => {
        const t = [
            node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r2'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
        ];
        assert.equal(tree.findDependencyIssues(t).cycles.length, 1);
    });

    test('자기 자신을 가리키는 참조도 순환이다', () => {
        const t = [node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10', ['r1'])] })];
        assert.deepEqual(tree.findDependencyIssues(t).cycles[0].ids, ['r1']);
    });

    test('순환인 간선에는 overlap 을 함께 붙이지 않는다 — 구조 결함이 앞선다', () => {
        const t = [
            node('a', { timeRanges: [range('r1', '2026-01-11', '2026-01-20', ['r2'])] }),
            node('b', { timeRanges: [range('r2', '2026-01-01', '2026-01-10', ['r1'])] }),
        ];
        const issues = tree.findDependencyIssues(t);
        assert.deepEqual(issues.overlaps, []);
        assert.equal(issues.edgeIssues[tree.dependencyEdgeKey('r1', 'r2')], 'cycle');
    });

    test('지워진 상대를 가리키는 참조는 dangling 이다', () => {
        const issues = tree.findDependencyIssues(tree.deleteFromTree(linearTree(), 'a'));
        assert.equal(issues.dangling.length, 1);
        assert.equal(issues.dangling[0].holderId, 'r2');
        assert.equal(issues.dangling[0].missingId, 'r1');
        assert.deepEqual(issues.edgeIssues, {}); // 그릴 화살표 자체가 없다
    });

    test('하위 작업 안의 의존성도 본다', () => {
        const t = [
            node('p', {
                children: [
                    node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
                    node('b', { timeRanges: [range('r2', '2026-01-05', '2026-01-20', ['r1'])] }),
                ],
            }),
        ];
        assert.equal(tree.findDependencyIssues(t).overlaps.length, 1);
    });

    test('레거시 작업 단위 의존성도 간선으로 센다', () => {
        const t = [
            node('a', { startDate: '2026-01-01', endDate: '2026-01-10' }),
            node('b', { startDate: '2026-01-05', endDate: '2026-01-20', dependencies: ['a'] }),
        ];
        const issues = tree.findDependencyIssues(t);
        assert.equal(issues.overlaps.length, 1);
        assert.equal(issues.overlaps[0].fromId, 'a');
        assert.equal(issues.overlaps[0].toId, 'b');
    });

    test('빈 트리에서도 죽지 않는다', () => {
        const issues = tree.findDependencyIssues([]);
        assert.deepEqual(issues.cycles, []);
        assert.equal(issues.successors.size, 0);
    });
});

describe('wouldCreateDependencyCycle', () => {
    const chain = () => tree.findDependencyIssues([
        node('a', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
        node('b', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
        node('c', { timeRanges: [range('r3', '2026-01-21', '2026-01-30', ['r2'])] }),
    ]).successors;

    test('후행에서 선행으로 되돌리는 연결은 순환이다', () => {
        assert.equal(tree.wouldCreateDependencyCycle(chain(), 'r3', 'r1'), true);
    });

    test('사슬을 더 잇는 연결은 순환이 아니다', () => {
        assert.equal(tree.wouldCreateDependencyCycle(chain(), 'r3', 'r4'), false);
    });

    test('자기 자신으로의 연결은 순환이다', () => {
        assert.equal(tree.wouldCreateDependencyCycle(chain(), 'r1', 'r1'), true);
    });
});

// ── 서비스 계층: 쓰기 전 차단 ────────────────────────
describe('의존성 쓰기 차단 (REST/MCP 경로)', () => {
    let s;
    let seq = 0;

    // a(r1) → b(r2) 사슬을 서비스로 만들어 두고 시작한다.
    let a, b, r1, r2;
    beforeEach(() => {
        s = store.getProjectStore(`dep-${++seq}`);
        s.writeTasks([]);
        a = svc.createTask(s, { name: 'a', startDate: '2026-01-01', endDate: '2026-01-10' }).task;
        b = svc.createTask(s, { name: 'b', startDate: '2026-01-11', endDate: '2026-01-20' }).task;
        r1 = a.timeRanges[0].id;
        r2 = b.timeRanges[0].id;
        svc.updateTimeRange(s, b.id, r2, { dependencies: [r1] });
    });

    const assertFails = (fn, status, messagePart) => {
        assert.throws(fn, (err) => {
            assert.ok(err instanceof AppError, `AppError 가 아니다: ${err}`);
            assert.equal(err.status, status);
            if (messagePart) assert.match(err.message, new RegExp(messagePart));
            return true;
        });
    };

    test('존재하지 않는 id 를 가리키는 의존성은 400 이고 아무것도 쓰이지 않는다', () => {
        const before = s.readMeta().revision;
        assertFails(() => svc.updateTimeRange(s, a.id, r1, { dependencies: ['없는-id'] }),
            400, 'unknown dependency id');
        assert.equal(s.readMeta().revision, before);
        assert.deepEqual(tree.findTask(s.readTasks(), a.id).timeRanges[0].dependencies, []);
    });

    test('순환을 닫는 의존성은 400 이다 (r1 → r2 가 이미 있는데 r2 → r1)', () => {
        const before = s.readMeta().revision;
        assertFails(() => svc.updateTimeRange(s, a.id, r1, { dependencies: [r2] }),
            400, 'would create a cycle');
        assert.equal(s.readMeta().revision, before);
    });

    test('자기 자신을 가리키는 의존성도 400 이다', () => {
        assertFails(() => svc.updateTimeRange(s, a.id, r1, { dependencies: [r1] }),
            400, 'would create a cycle');
    });

    test('사슬을 더 잇는 정상 의존성은 통과한다', () => {
        const c = svc.createTask(s, { name: 'c', startDate: '2026-01-21', endDate: '2026-01-30' }).task;
        const { timeRange } = svc.updateTimeRange(s, c.id, c.timeRanges[0].id, { dependencies: [r2] });
        assert.deepEqual(timeRange.dependencies, [r2]);
    });

    test('addTimeRange 로 들어온 의존성도 같은 검사를 받는다', () => {
        assertFails(() => svc.addTimeRange(s, a.id, {
            startDate: '2026-02-01', endDate: '2026-02-10', dependencies: ['없는-id'],
        }), 400, 'unknown dependency id');

        const { timeRange } = svc.addTimeRange(s, a.id, {
            startDate: '2026-02-01', endDate: '2026-02-10', dependencies: [r2],
        });
        assert.deepEqual(timeRange.dependencies, [r2]);
    });

    test('마일스톤 id 도 유효한 선행이다', () => {
        const { milestone } = svc.addMilestone(s, a.id, { date: '2026-01-05', label: 'M' });
        const { timeRange } = svc.updateTimeRange(s, b.id, r2, { dependencies: [milestone.id] });
        assert.deepEqual(timeRange.dependencies, [milestone.id]);
    });
});

// ── 서비스 계층: 조회 ────────────────────────────────
describe('getDependencyIssues', () => {
    let s;
    let seq = 0;
    beforeEach(() => {
        s = store.getProjectStore(`depq-${++seq}`);
        s.writeTasks([]);
    });

    test('정상 트리는 빈 목록 세 개와 현재 리비전을 돌려준다', () => {
        s.writeTasks(linearTree());
        const res = svc.getDependencyIssues(s);
        assert.deepEqual(res.cycles, []);
        assert.deepEqual(res.overlaps, []);
        assert.deepEqual(res.dangling, []);
        assert.equal(res.revision, s.readMeta().revision);
    });

    test('쓰기 차단이 막지 못하는 것들(일정 위반·끊어진 참조)을 보고한다', () => {
        const t = linearTree();
        t[1].timeRanges[0].startDate = '2026-01-06'; // 일정 위반
        t.push(node('c', { timeRanges: [range('r3', '2026-02-01', '2026-02-10', ['사라진-id'])] }));
        s.writeTasks(t);

        const res = svc.getDependencyIssues(s);
        assert.equal(res.overlaps.length, 1);
        assert.equal(res.overlaps[0].fromId, 'r1');
        assert.equal(res.overlaps[0].toId, 'r2');
        assert.equal(res.overlaps[0].days, 4);
        assert.equal(res.dangling.length, 1);
        assert.equal(res.dangling[0].holderId, 'r3');
        assert.equal(res.dangling[0].missingId, '사라진-id');
    });

    // 여기 남는 dangling 은 이 서비스를 거치지 않은 쓰기(blob POST /api/data, 손으로 넣은
    // 데이터, 2026-08-10 이전에 만들어진 것)가 원인이다 — 삭제 경로 자체는 더 이상 만들지 않는다.
    test('삭제가 남긴 끊어진 참조는 이제 없다 — 삭제 시점에 함께 정리된다', () => {
        const a = svc.createTask(s, { name: 'a', startDate: '2026-01-01', endDate: '2026-01-10' }).task;
        const b = svc.createTask(s, { name: 'b', startDate: '2026-01-11', endDate: '2026-01-20' }).task;
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });
        assert.deepEqual(svc.getDependencyIssues(s).dangling, []);

        svc.deleteTask(s, a.id);
        assert.deepEqual(svc.getDependencyIssues(s).dangling, []);
        assert.deepEqual(svc.getTask(s, b.id).task.timeRanges[0].dependencies, []);
    });
});

// 삭제가 상대의 dependencies 를 정리하지 않으면 존재하지 않는 id 를 가리키는 참조가
// 남는다. 화면에는 인스펙터의 정리 버튼이 있지만, REST/MCP 로 지운 것까지 사람이 화면을
// 열어 눌러 줄 것을 기대할 수 없다 — 만들지 않는 편이 낫다.
describe('삭제 시 참조 정리 (작업/기간/마일스톤)', () => {
    let s;
    let seq = 0;
    beforeEach(() => {
        s = store.getProjectStore(`depdel-${++seq}`);
        s.writeTasks([]);
    });

    // a(지울 대상) ← b 가 참조. 반환: { a, b, depOn(id 를 b 의 기간 의존성으로 건다) }
    const pair = () => {
        const a = svc.createTask(s, { name: 'a', startDate: '2026-01-01', endDate: '2026-01-10' }).task;
        const b = svc.createTask(s, { name: 'b', startDate: '2026-01-11', endDate: '2026-01-20' }).task;
        const depOn = (id) => svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [id] });
        const bDeps = () => svc.getTask(s, b.id).task.timeRanges[0].dependencies;
        return { a, b, depOn, bDeps };
    };

    test('작업을 지우면 그 작업의 기간을 가리키던 참조도 사라진다', () => {
        const { a, depOn, bDeps } = pair();
        depOn(a.timeRanges[0].id);
        svc.deleteTask(s, a.id);
        assert.deepEqual(bDeps(), []);
    });

    test('자손이 소유한 id 를 가리키던 참조도 사라진다 — 지우는 것은 가지 전체다', () => {
        const { a, depOn, bDeps } = pair();
        const child = svc.createTask(s, {
            name: 'child', parentId: a.id, startDate: '2026-01-02', endDate: '2026-01-05',
        }).task;
        depOn(child.timeRanges[0].id);
        svc.deleteTask(s, a.id);
        assert.deepEqual(bDeps(), []);
    });

    test('기간 하나만 지워도 그 기간을 가리키던 참조가 사라진다', () => {
        const { a, depOn, bDeps } = pair();
        const extra = svc.addTimeRange(s, a.id, { startDate: '2026-03-01', endDate: '2026-03-05' }).timeRange;
        depOn(extra.id);
        svc.deleteTimeRange(s, a.id, extra.id);
        assert.deepEqual(bDeps(), []);
    });

    test('마일스톤을 지워도 그것을 가리키던 참조가 사라진다', () => {
        const { a, depOn, bDeps } = pair();
        const m = svc.addMilestone(s, a.id, { date: '2026-01-05', label: 'M' }).milestone;
        depOn(m.id);
        svc.deleteMilestone(s, a.id, m.id);
        assert.deepEqual(bDeps(), []);
    });

    test('관계 없는 의존성은 건드리지 않는다', () => {
        const { a, b, depOn, bDeps } = pair();
        const c = svc.createTask(s, { name: 'c', startDate: '2026-02-01', endDate: '2026-02-10' }).task;
        depOn(c.timeRanges[0].id);
        svc.deleteTask(s, a.id);
        assert.deepEqual(bDeps(), [c.timeRanges[0].id]);
        assert.equal(svc.getTask(s, b.id).task.id, b.id);
    });

    // moveTask 도 deleteFromTree 를 쓴다(제거 후 재삽입). 거기에 정리를 걸면 작업을
    // 옮기는 것만으로 의존성이 사라진다 — 그래서 정리는 삭제 경로에만 조합돼 있다.
    test('작업을 옮기는 것은 의존성을 지우지 않는다', () => {
        const { a, depOn, bDeps } = pair();
        depOn(a.timeRanges[0].id);
        const parent = svc.createTask(s, { name: 'parent' }).task;
        svc.moveTask(s, a.id, { parentId: parent.id, position: 0 });
        assert.deepEqual(bDeps(), [a.timeRanges[0].id]);
    });
});
