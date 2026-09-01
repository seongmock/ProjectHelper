// 이번 사이클에 새로 생긴 네 가지의 테스트: 마일스톤 수정 · 일괄 적용(batch) ·
// 캐스케이드 이동 · 임계경로/여유.
//
// PH_DATA_DIR 을 require 전에 설정해야 한다 — store.js 는 로드 시점에 경로를 확정한다.
const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sched-test-'));
process.env.PH_DATA_DIR = tmpRoot;

const store = require('../lib/store');
const svc = require('../services/taskService');
const schedule = require('../lib/schedule');
const { AppError } = require('../lib/errors');

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let s;
let seq = 0;
beforeEach(() => {
    s = store.getProjectStore(`sched-${++seq}`);
    s.writeTasks([]);
});

const assertFails = (fn, status, messagePart) => {
    assert.throws(fn, (err) => {
        assert.ok(err instanceof AppError, `AppError 가 아니다: ${err}`);
        assert.equal(err.status, status);
        if (messagePart) assert.match(err.message, new RegExp(messagePart));
        return true;
    });
};

// 기간 하나를 가진 작업을 만든다
const mkTask = (name, startDate, endDate) =>
    svc.createTask(s, { name, startDate, endDate }).task;

// ── 날짜 산술 (순수) ─────────────────────────────────
describe('schedule 날짜 산술', () => {
    test('addDays 는 월/연 경계를 넘는다', () => {
        assert.equal(schedule.addDays('2026-01-31', 1), '2026-02-01');
        assert.equal(schedule.addDays('2026-12-31', 1), '2027-01-01');
        assert.equal(schedule.addDays('2026-03-01', -1), '2026-02-28');
    });

    // UTC 로 파싱하지 않으면 서버 타임존에 따라 하루가 밀리고, 그 하루는 간트에서 한 칸이다
    test('diffDays 는 타임존과 무관하다', () => {
        assert.equal(schedule.diffDays('2026-01-01', '2026-01-08'), 7);
        assert.equal(schedule.diffDays('2026-01-08', '2026-01-01'), -7);
        assert.equal(schedule.diffDays('bad', '2026-01-01'), null);
    });

    test('nextWorkday 는 주말만 다음 평일로 민다', () => {
        assert.equal(schedule.nextWorkday('2026-08-29'), '2026-08-31'); // 토 → 월
        assert.equal(schedule.nextWorkday('2026-08-30'), '2026-08-31'); // 일 → 월
        assert.equal(schedule.nextWorkday('2026-08-31'), '2026-08-31'); // 월 그대로
    });

    test('diffWorkdays 는 주말을 세지 않는다', () => {
        assert.equal(schedule.diffWorkdays('2026-08-24', '2026-08-31'), 5); // 월→월 = 평일 5
        assert.equal(schedule.diffWorkdays('2026-08-28', '2026-08-31'), 1); // 금→월 = 1
    });

    // 예전에는 하루씩 세면서 매 반복 Date 를 새로 만들었다. criticalPath 는 이 함수를
    // **노드마다** 부르고 구간은 프로젝트 종료일까지라, 마일스톤 하나에 '9999-12-31'
    // (TBD 자리표시자로 흔하다)이 든 20작업 프로젝트가 GET 한 번으로 이벤트 루프를
    // 3분 세웠다 — 그동안 /api/health 도 안 나간다. 산술로 접었으니 그 사실을 잰다.
    test('diffWorkdays 는 구간 길이와 무관하게 즉시 답한다', () => {
        const t0 = Date.now();
        assert.equal(schedule.diffWorkdays('2026-01-01', '9999-12-31'), 2080316);
        assert.ok(Date.now() - t0 < 100, `${Date.now() - t0}ms — 하루씩 세고 있다`);
    });

    test('diffWorkdays 는 하루씩 세던 옛 구현과 같은 답을 낸다', () => {
        const slow = (a, b) => {
            const total = schedule.diffDays(a, b);
            const step = total >= 0 ? 1 : -1;
            let count = 0;
            let cur = a;
            for (let i = 0; i < Math.abs(total); i++) {
                cur = schedule.addDays(cur, step);
                if (!schedule.isWeekend(cur)) count += step;
            }
            return count;
        };
        for (let i = 0; i < 200; i++) {
            const a = schedule.addDays('2026-01-01', Math.floor(Math.random() * 800) - 400);
            const b = schedule.addDays(a, Math.floor(Math.random() * 200) - 100);
            assert.equal(schedule.diffWorkdays(a, b), slow(a, b), `${a} → ${b}`);
        }
    });

    // toISOString().slice(0,10) 은 네 자리 연도만 전제한다. 밖으로 나가면 ISO 가
    // '+010000-01-01' 을 내놓고 slice 가 가운데를 잘라 '+010000-01' 이 저장됐다 —
    // 그 문자열은 이후 어떤 date 검증도 통과하지 못해 그 기간이 영구히 잠긴다.
    test('addDays 는 YYYY-MM-DD 규약 밖으로 나가지 않는다', () => {
        assert.equal(schedule.addDays('9999-12-31', 1), '9999-12-31');
        assert.equal(schedule.addDays('9999-12-01', 40), '9999-12-31');
        assert.equal(schedule.addDays('0001-01-01', -400), '0001-01-01');
        assert.equal(schedule.addDays('2026-01-01', 1e12), '9999-12-31'); // RangeError 였다
    });

    test('nextWorkday 는 상한에서 멈춘다 — 포화한 addDays 로 영원히 돌지 않는다', () => {
        assert.equal(schedule.nextWorkday('9999-12-31'), '9999-12-31');
    });
});

// ── 마일스톤 수정 ────────────────────────────────────
describe('마일스톤 수정', () => {
    test('날짜/라벨/도형/라벨위치를 고쳐도 id 가 유지된다', () => {
        const task = mkTask('설계', '2026-01-01', '2026-01-31');
        const { milestone } = svc.addMilestone(s, task.id, { date: '2026-01-15', label: '중간' });

        const res = svc.updateMilestone(s, task.id, milestone.id, {
            date: '2026-01-20', label: '중간 검토', shape: 'flag', labelPosition: 'top',
        });

        assert.equal(res.milestone.id, milestone.id, 'id 가 바뀌면 이것을 가리키던 연결이 끊긴다');
        assert.equal(res.milestone.date, '2026-01-20');
        assert.equal(res.milestone.label, '중간 검토');
        assert.equal(res.milestone.shape, 'flag');
        assert.equal(res.milestone.labelPosition, 'top');
    });

    // 삭제+재생성으로 날짜를 고치던 동안, 이 연결은 pruneDependencies 가 (정상 동작으로)
    // 지웠다. 수정 경로가 있어야 하는 이유가 그것이다.
    test('수정은 이 마일스톤을 가리키던 연결을 지우지 않는다', () => {
        const a = mkTask('선행', '2026-01-01', '2026-01-10');
        const b = mkTask('후행', '2026-02-01', '2026-02-10');
        const { milestone } = svc.addMilestone(s, a.id, { date: '2026-01-10', label: '완료' });
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [milestone.id] });

        svc.updateMilestone(s, a.id, milestone.id, { date: '2026-01-12' });

        const { edges } = svc.getDependencyIssues(s);
        assert.equal(edges.length, 1);
        assert.equal(edges[0].fromId, milestone.id);
    });

    test('마일스톤에 의존성을 직접 쓸 수 있다 — 순환과 미지의 id 는 400', () => {
        const a = mkTask('선행', '2026-01-01', '2026-01-10');
        const { milestone } = svc.addMilestone(s, a.id, { date: '2026-02-01' });

        const ok = svc.updateMilestone(s, a.id, milestone.id, {
            dependencies: [a.timeRanges[0].id],
        });
        assert.deepEqual(ok.milestone.dependencies, [a.timeRanges[0].id]);

        assertFails(() => svc.updateMilestone(s, a.id, milestone.id, { dependencies: ['nope'] }),
            400, 'unknown dependency id');
        assertFails(() => svc.updateMilestone(s, a.id, milestone.id, { dependencies: [milestone.id] }),
            400, 'cycle');
    });

    test('없는 마일스톤은 404, 빈 수정은 400, 모르는 필드는 400', () => {
        const task = mkTask('설계', '2026-01-01', '2026-01-31');
        assertFails(() => svc.updateMilestone(s, task.id, 'nope', { label: 'x' }), 404, 'milestone');
        assertFails(() => svc.updateMilestone(s, task.id, 'nope', {}), 400, 'empty update');
        const { milestone } = svc.addMilestone(s, task.id, { date: '2026-01-15' });
        assertFails(() => svc.updateMilestone(s, task.id, milestone.id, { nope: 1 }), 400, 'unknown field');
        assertFails(() => svc.updateMilestone(s, task.id, milestone.id, { labelPosition: 'diagonal' }),
            400, 'labelPosition');
    });

    test('추가 시에도 labelPosition/dependencies 를 받는다 (기본값은 auto/빈 배열)', () => {
        const task = mkTask('설계', '2026-01-01', '2026-01-31');
        const plain = svc.addMilestone(s, task.id, { date: '2026-01-05' }).milestone;
        assert.equal(plain.labelPosition, 'auto');
        assert.deepEqual(plain.dependencies, []);

        const fancy = svc.addMilestone(s, task.id, {
            date: '2026-01-20', labelPosition: 'bottom', dependencies: [task.timeRanges[0].id],
        }).milestone;
        assert.equal(fancy.labelPosition, 'bottom');
        assert.deepEqual(fancy.dependencies, [task.timeRanges[0].id]);
    });
});

// ── 일괄 적용 ────────────────────────────────────────
describe('일괄 적용(batch)', () => {
    test('여러 op 이 리비전 하나만 올린다', () => {
        const before = s.readMeta().revision;
        const res = svc.applyBatch(s, {
            ops: [
                { op: 'create-task', body: { name: '설계', startDate: '2026-01-01', endDate: '2026-01-31' } },
                { op: 'create-task', body: { name: '개발', startDate: '2026-02-01', endDate: '2026-03-31' } },
                { op: 'create-task', body: { name: '검증', startDate: '2026-04-01', endDate: '2026-04-30' } },
            ],
        });
        assert.equal(res.applied, 3);
        assert.equal(res.revision, before + 1, '3번 왕복하면 리비전이 3 올랐다 — 그게 고치려던 것이다');
        assert.equal(s.readTasks().length, 3);
    });

    test('ref 로 앞선 op 이 만든 부모·기간을 가리킨다', () => {
        const res = svc.applyBatch(s, {
            ops: [
                { op: 'create-task', ref: 'top', body: { name: '설계', startDate: '2026-01-01', endDate: '2026-01-31' } },
                { op: 'create-task', body: { name: '요구사항', parentId: '@top', startDate: '2026-01-01', endDate: '2026-01-10' } },
                { op: 'create-task', ref: 'dev', body: { name: '개발', startDate: '2026-02-01', endDate: '2026-03-31' } },
                // '@top:range' = top 작업이 자동으로 갖게 된 첫 기간의 id
                { op: 'update-time-range', taskId: '@dev', rangeId: '@dev:range', body: { dependencies: ['@top:range'] } },
            ],
        });
        assert.equal(res.applied, 4);

        const tasks = s.readTasks();
        assert.equal(tasks.length, 2, '두 번째 op 은 자식으로 들어갔어야 한다');
        assert.equal(tasks[0].children.length, 1);
        const { edges } = svc.getDependencyIssues(s);
        assert.equal(edges.length, 1, 'ref 로 만든 연결이 실제 id 로 저장돼야 한다');
    });

    test('모르는 ref 는 400 이고 아무것도 쓰이지 않는다', () => {
        const before = s.readMeta().revision;
        assertFails(() => svc.applyBatch(s, {
            ops: [
                { op: 'create-task', body: { name: 'A' } },
                { op: 'create-task', body: { name: 'B', parentId: '@nope' } },
            ],
        }), 400, 'unknown ref');
        assert.equal(s.readTasks().length, 0, '전부 아니면 전무여야 한다');
        assert.equal(s.readMeta().revision, before);
    });

    // 중간 op 이 실패했을 때 앞선 op 이 남으면, AI 는 "실패"를 받고도 절반 지어진
    // 트리를 갖게 된다 — 되돌릴 방법 없이.
    test('중간 op 실패는 앞선 op 까지 되돌린다', () => {
        const before = s.readMeta().revision;
        assertFails(() => svc.applyBatch(s, {
            ops: [
                { op: 'create-task', body: { name: 'A' } },
                { op: 'update-task', taskId: 'no-such-task', body: { name: 'B' } },
            ],
        }), 404);
        assert.equal(s.readTasks().length, 0);
        assert.equal(s.readMeta().revision, before);
    });

    test('형식 오류는 리비전 검사보다 먼저 400 이다', () => {
        assertFails(() => svc.applyBatch(s, { ops: [{ op: 'nope' }] }), 400, 'ops\\[0\\].op');
        assertFails(() => svc.applyBatch(s, { ops: [{ op: 'update-task', body: {} }] }), 400, 'taskId is required');
        assertFails(() => svc.applyBatch(s, { ops: [{ op: 'delete-task', taskId: 'x', body: { name: 'y' } }] }),
            400, 'not allowed');
        assertFails(() => svc.applyBatch(s, { ops: [{ op: 'create-task', body: { name: 'A' }, junk: 1 }] }),
            400, 'unknown field');
        assertFails(() => svc.applyBatch(s, { ops: [] }), 400, 'must not be empty');
        assertFails(() => svc.applyBatch(s, {}), 400, 'must be an array');
        assertFails(() => svc.applyBatch(s, {
            ops: Array.from({ length: svc.BATCH_MAX + 1 }, () => ({ op: 'create-task', body: { name: 'x' } })),
        }), 400, 'too many ops');
    });

    // OPS['constructor'] 는 truthy 다 — 존재 검사를 `OPS[raw.op]` 로 하던 동안 그 이름은
    // 통과해 `op.ids` 에서 TypeError 가 났고, 클라이언트 잘못이 500 으로 나갔다.
    test('Object.prototype 의 이름은 op 가 아니다 — 500 이 아니라 400', () => {
        for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
            assertFails(() => svc.applyBatch(s, { ops: [{ op: name }] }), 400, 'must be one of');
        }
    });

    // 같은 ref 이름을 두 번 쓰면 조용히 뒤엣것으로 덮였다 — 200 op 짜리 계획에서 첫 노드에
    // 붙어야 할 자식이 오류 없이 다른 노드로 간다. 화면에도 응답에도 아무 흔적이 없다.
    test('같은 ref 이름을 두 번 쓰면 400 — 조용히 덮어쓰지 않는다', () => {
        assertFails(() => svc.applyBatch(s, {
            ops: [
                { op: 'create-task', ref: 'x', body: { name: 'A' } },
                { op: 'create-task', ref: 'x', body: { name: 'B' } },
            ],
        }), 400, 'already used');
        assert.equal(s.readTasks().length, 0);
    });

    // batch 200 op 으로 깊이 200 트리를 만들 수 있었고, 그 순간부터 그 프로젝트를 열고
    // 있는 브라우저의 자동저장(POST /api/data)이 영구히 400 이 됐다 — 구제 수단인
    // 스냅샷 생성도 같은 검증을 지나므로 함께 막힌다. AI 의 한 번의 200 응답이 사람의
    // 모든 쓰기를 잠그는 자리다. 상한은 트리를 만드는 **모든** 경로가 봐야 한다.
    test('batch 도 트리 상한(깊이)을 넘지 못한다 — 사람의 저장을 잠그던 구멍', () => {
        const before = s.readMeta().revision;
        const ops = [{ op: 'create-task', ref: 'n0', body: { name: 'n0' } }];
        for (let i = 1; i <= 25; i++) {
            ops.push({ op: 'create-task', ref: `n${i}`, body: { name: `n${i}`, parentId: `@n${i - 1}` } });
        }
        assertFails(() => svc.applyBatch(s, { ops }), 400, 'max depth');
        assert.equal(s.readTasks().length, 0, '전부 아니면 전무여야 한다');
        assert.equal(s.readMeta().revision, before);
    });

    test('단건 쓰기도 같은 상한을 본다 — batch 만 막으면 30번 나눠 보내면 된다', () => {
        let parentId;
        let blocked = false;
        for (let i = 0; i < 30; i++) {
            try {
                parentId = svc.createTask(s, { name: `d${i}`, parentId }).task.id;
            } catch (err) {
                assert.equal(err.status, 400);
                assert.match(err.message, /max depth/);
                blocked = true;
                break;
            }
        }
        assert.ok(blocked, '30단계를 그대로 만들 수 있었다');
    });

    test('If-Match 불일치는 409 — 하나도 적용되지 않는다', () => {
        assertFails(() => svc.applyBatch(s, { ops: [{ op: 'create-task', body: { name: 'A' } }] }, '9999'), 409);
        assert.equal(s.readTasks().length, 0);
    });

    test('batch 도 단건과 같은 순환 차단을 받는다', () => {
        assertFails(() => svc.applyBatch(s, {
            ops: [
                { op: 'create-task', ref: 'a', body: { name: 'A', startDate: '2026-01-01', endDate: '2026-01-10' } },
                { op: 'update-time-range', taskId: '@a', rangeId: '@a:range', body: { dependencies: ['@a:range'] } },
            ],
        }), 400, 'cycle');
        assert.equal(s.readTasks().length, 0);
    });

    test('감사 로그에 한 줄만 남는다', () => {
        const audited = store.getProjectStore(`sched-audit-${++seq}`, { actor: 'ai', op: 'batch' });
        audited.writeTasks([]);
        const before = audited.readEvents ? audited.readEvents().length : 0;
        svc.applyBatch(audited, {
            ops: Array.from({ length: 5 }, (_, i) => ({ op: 'create-task', body: { name: `T${i}` } })),
        });
        // 조건 안에 넣으면 readEvents 가 사라지는 날 단언이 통째로 없어진다.
        assert.ok(audited.readEvents, '감사 로그를 읽을 수 없으면 이 테스트는 아무것도 보증하지 않는다');
        assert.equal(audited.readEvents().length, before + 1);
    });
});

// ── 캐스케이드 ───────────────────────────────────────
describe('캐스케이드 이동', () => {
    // A(range) → B(range) → C(range) 사슬을 만든다
    const chain = () => {
        const a = mkTask('A', '2026-01-05', '2026-01-09');
        const b = mkTask('B', '2026-01-12', '2026-01-16');
        const c = mkTask('C', '2026-01-19', '2026-01-23');
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });
        svc.updateTimeRange(s, c.id, c.timeRanges[0].id, { dependencies: [b.timeRanges[0].id] });
        return { a, b, c };
    };

    const rangeOf = (taskId) => {
        const { task } = svc.getTask(s, taskId);
        return task.timeRanges[0];
    };

    test('cascade 없이는 후행이 그대로 있다 (기본값이 안전한 쪽)', () => {
        const { a, b } = chain();
        svc.updateTimeRange(s, a.id, a.timeRanges[0].id, { endDate: '2026-01-14' });
        assert.equal(rangeOf(b.id).startDate, '2026-01-12');
    });

    test('cascade=true 는 후행 전체를 밀린 일수만큼 민다', () => {
        const { a, b, c } = chain();
        const res = svc.updateTimeRange(s, a.id, a.timeRanges[0].id,
            { endDate: '2026-01-14' }, undefined, { cascade: true });

        assert.equal(res.cascadeDays, 5);
        assert.equal(res.cascaded.length, 2, 'B 와 C 의 기간 둘');
        assert.equal(rangeOf(b.id).startDate, '2026-01-17');
        assert.equal(rangeOf(b.id).endDate, '2026-01-21');
        assert.equal(rangeOf(c.id).startDate, '2026-01-24', '전이적 후행까지 따라가야 한다');
    });

    test('앞당김은 전파하지 않는다 — 손으로 잡아 둔 간격을 지우지 않는다', () => {
        const { a, b } = chain();
        const res = svc.updateTimeRange(s, a.id, a.timeRanges[0].id,
            { endDate: '2026-01-07' }, undefined, { cascade: true });
        assert.equal(res.cascadeDays, 0);
        assert.equal(rangeOf(b.id).startDate, '2026-01-12');
    });

    test('workdays=true 면 주말에 착지한 날짜를 다음 평일로 민다', () => {
        const { a, b } = chain();
        // +3일이면 B 는 2026-01-15(목) → 2026-01-15+3 = 01-15? 아래에서 실측한다
        svc.updateTimeRange(s, a.id, a.timeRanges[0].id,
            { endDate: '2026-01-10' }, undefined, { cascade: true, workdays: true });
        const r = rangeOf(b.id);
        assert.ok(!schedule.isWeekend(r.startDate), `주말에 착지했다: ${r.startDate}`);
        assert.ok(!schedule.isWeekend(r.endDate), `주말에 착지했다: ${r.endDate}`);
    });

    test('마일스톤도 후행이면 따라 움직인다', () => {
        const a = mkTask('A', '2026-01-05', '2026-01-09');
        const b = mkTask('B', '2026-02-01', '2026-02-10');
        const { milestone } = svc.addMilestone(s, b.id, {
            date: '2026-02-05', dependencies: [a.timeRanges[0].id],
        });
        svc.updateTimeRange(s, a.id, a.timeRanges[0].id,
            { endDate: '2026-01-16' }, undefined, { cascade: true });

        const { task } = svc.getTask(s, b.id);
        assert.equal(task.milestones.find(m => m.id === milestone.id).date, '2026-02-12');
    });

    // 작업 레벨 dependencies(레거시)가 있으면 후행 집합에 **소유 작업**이 되돌아오고,
    // shiftEntities 의 wholeTask 분기가 방금 편집한 그 기간을 delta 만큼 한 번 더 밀었다.
    // 응답은 인자로 만들어지므로 200 이 저장소와 다른 날짜를 말했다 — 사용자는 종료일만
    // 3일 밀었는데 시작일까지 3일 밀렸고, 되돌릴 근거가 응답 어디에도 없었다.
    test('캐스케이드가 방금 편집한 기간을 다시 밀지 않는다 — 응답과 저장이 같다', () => {
        s.writeTasks([
            { id: 'T1', name: 'A', children: [], milestones: [], dependencies: ['T2'],
              timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: [] }] },
            { id: 'T2', name: 'B', children: [], milestones: [],
              timeRanges: [{ id: 'r2', startDate: '2026-01-06', endDate: '2026-01-10', dependencies: ['r1'] }] },
        ]);
        const res = svc.updateTimeRange(s, 'T1', 'r1', { endDate: '2026-01-08' }, undefined, { cascade: true });

        assert.equal(res.timeRange.startDate, '2026-01-01');
        assert.equal(res.timeRange.endDate, '2026-01-08');
        const stored = rangeOf('T1');
        assert.equal(stored.startDate, res.timeRange.startDate, '응답이 저장소와 다른 값을 말했다');
        assert.equal(stored.endDate, res.timeRange.endDate);
        assert.equal(rangeOf('T2').startDate, '2026-01-09', '후행은 정상적으로 3일 밀린다');
    });

    test('순환이 있어도 무한히 돌지 않는다', () => {
        // 순환은 서비스가 막으므로 트리를 직접 심어서 만든다
        s.writeTasks([
            { id: 't1', name: 'A', children: [], milestones: [],
              timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: ['r2'] }] },
            { id: 't2', name: 'B', children: [], milestones: [],
              timeRanges: [{ id: 'r2', startDate: '2026-01-06', endDate: '2026-01-10', dependencies: ['r1'] }] },
        ]);
        const res = svc.updateTimeRange(s, 't1', 'r1', { endDate: '2026-01-08' }, undefined, { cascade: true });
        assert.equal(res.cascadeDays, 3);
        assert.deepEqual(res.cascaded, ['r2'], '자기 자신은 다시 밀지 않는다');
    });
});

// ── 임계경로 / 여유 ──────────────────────────────────
describe('임계경로 / 여유(slack)', () => {
    test('빈 프로젝트는 빈 결과', () => {
        const res = svc.getCriticalPath(s);
        assert.deepEqual(res.nodes, []);
        assert.deepEqual(res.criticalIds, []);
    });

    test('사슬의 마지막은 여유 0, 짧은 병렬 가지는 여유가 있다', () => {
        const a = mkTask('A', '2026-01-05', '2026-01-09');
        const long = mkTask('긴 후행', '2026-01-12', '2026-02-10');
        const short = mkTask('짧은 후행', '2026-01-12', '2026-01-16');
        svc.updateTimeRange(s, long.id, long.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });
        svc.updateTimeRange(s, short.id, short.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });

        const res = svc.getCriticalPath(s);
        const by = new Map(res.nodes.map(n => [n.id, n]));
        assert.equal(res.projectEnd, '2026-02-10');
        assert.equal(by.get(long.timeRanges[0].id).slackDays, 0, '프로젝트 종료를 정하는 쪽이 임계다');
        assert.ok(by.get(short.timeRanges[0].id).slackDays > 0, '짧은 가지는 늦어질 여유가 있다');
        assert.ok(res.criticalIds.includes(long.timeRanges[0].id));
        assert.ok(!res.criticalIds.includes(short.timeRanges[0].id));
    });

    test('여유는 평일로도 함께 보고한다', () => {
        const a = mkTask('A', '2026-08-24', '2026-08-24'); // 월
        const b = mkTask('B', '2026-08-31', '2026-08-31'); // 다음 주 월
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });

        const node = svc.getCriticalPath(s).nodes.find(n => n.id === a.timeRanges[0].id);
        assert.equal(node.slackDays, 7);
        assert.equal(node.slackWorkdays, 5, '주말은 여유가 아니다');
    });

    test('순환이 있으면 계산하지 않고 400 이다', () => {
        s.writeTasks([
            { id: 't1', name: 'A', children: [], milestones: [],
              timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: ['r2'] }] },
            { id: 't2', name: 'B', children: [], milestones: [],
              timeRanges: [{ id: 'r2', startDate: '2026-01-06', endDate: '2026-01-10', dependencies: ['r1'] }] },
        ]);
        assertFails(() => svc.getCriticalPath(s), 400, 'cycle');
    });

    test('날짜 없는 항목은 계산에서 빠진다 (판정할 근거가 없다)', () => {
        s.writeTasks([{ id: 't1', name: '날짜 없음', children: [], milestones: [], timeRanges: [] }]);
        assert.deepEqual(svc.getCriticalPath(s).nodes, []);
    });

    // 의존성은 기간 레벨에 있으므로 기간을 가진 작업 노드에는 간선이 하나도 없다 —
    // 그대로 두면 LF 가 프로젝트 종료일이 되어 API 가 **같은 구간에 대해 두 개의 다른
    // 여유**를 답했다(작업 10일, 그 작업의 유일한 기간 5일). "이 작업을 며칠 미룰 수
    // 있나"에 10 이라고 답하면 그 계획은 5일째에 깨진다.
    test('작업의 여유가 자기 기간의 여유와 어긋나지 않는다', () => {
        const a = mkTask('A', '2026-01-01', '2026-01-05');
        const b = mkTask('B', '2026-01-10', '2026-01-15');
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });

        const by = new Map(svc.getCriticalPath(s).nodes.map(n => [n.id, n]));
        assert.equal(by.get(a.timeRanges[0].id).slackDays, 5);
        assert.equal(by.get(a.id).slackDays, 5, '작업이 자기 기간보다 여유가 많을 수는 없다');
        assert.equal(by.get(a.id).latestFinish, by.get(a.timeRanges[0].id).latestFinish);
        assert.equal(by.get(b.id).slackDays, 0);
        assert.ok(svc.getCriticalPath(s).criticalIds.includes(b.id));
    });
});

// ── 의존성 간선 노출 ─────────────────────────────────
describe('의존성 그래프 읽기', () => {
    test('dependency-issues 가 간선 목록을 함께 돌려준다', () => {
        const a = mkTask('A', '2026-01-01', '2026-01-10');
        const b = mkTask('B', '2026-02-01', '2026-02-10');
        svc.updateTimeRange(s, b.id, b.timeRanges[0].id, { dependencies: [a.timeRanges[0].id] });

        const res = svc.getDependencyIssues(s);
        assert.equal(res.edges.length, 1);
        assert.equal(res.edges[0].fromId, a.timeRanges[0].id);
        assert.equal(res.edges[0].toId, b.timeRanges[0].id);
        assert.ok(res.edges[0].fromName, '이름이 없으면 어느 작업의 연결인지 읽을 수 없다');
        assert.deepEqual(res.cycles, []);
    });

    test('끊어진 참조는 edges 가 아니라 dangling 이 말한다', () => {
        s.writeTasks([
            { id: 't1', name: 'A', children: [], milestones: [],
              timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: ['gone'] }] },
        ]);
        const res = svc.getDependencyIssues(s);
        assert.deepEqual(res.edges, []);
        assert.equal(res.dangling.length, 1);
    });
});
