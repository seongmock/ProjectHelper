// append-only 감사 로그 테스트.
// 핵심 계약 두 가지: ① 모든 트리 쓰기가 기록된다 ② 로그가 깨져도 쓰기는 성공한다.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpRoot;
let store;
let eventLog;

before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-eventlog-test-'));
    const libDir = path.join(tmpRoot, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    for (const name of ['store.js', 'eventLog.js', 'logger.js']) {
        fs.copyFileSync(path.join(__dirname, '..', 'lib', name), path.join(libDir, name));
    }
    store = require(path.join(libDir, 'store.js'));
    eventLog = require(path.join(libDir, 'eventLog.js'));
});

after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const task = (id, children = []) => ({ id, name: id, children, timeRanges: [] });

describe('감사 로그 기록', () => {
    test('트리 쓰기마다 행위자·연산·리비전·노드수가 남는다', () => {
        const s = store.getProjectStore('audit-basic', { actor: 'alice', op: 'POST /api/tasks' });
        s.writeTasks([task('a')]);
        s.writeTasks([task('a'), task('b')]);

        const events = s.readEvents();
        assert.equal(events.length, 2);
        // 최신순
        assert.equal(events[0].nodes, 2);
        assert.equal(events[0].prevNodes, 1);
        assert.equal(events[0].actor, 'alice');
        assert.equal(events[0].op, 'POST /api/tasks');
        assert.ok(events[0].revision > events[1].revision);
        assert.ok(Date.parse(events[0].ts) > 0);
    });

    test('노드 수는 하위 트리까지 센다 — 자식만 날아간 쓰기를 구분하기 위해', () => {
        const s = store.getProjectStore('audit-nodes');
        s.writeTasks([task('parent', [task('c1'), task('c2', [task('g1')])])]);
        s.writeTasks([task('parent')]);

        const [latest, first] = s.readEvents();
        assert.equal(first.nodes, 4);
        assert.equal(latest.nodes, 1);
        assert.equal(latest.prevNodes, 4, '최상위 길이는 1로 같지만 파괴적 쓰기임이 드러나야 한다');
    });

    test('컨텍스트 없이 호출하면 system 으로 기록된다 (스크립트·내부 호출)', () => {
        const s = store.getProjectStore('audit-system');
        s.writeTasks([task('a')]);
        assert.equal(s.readEvents()[0].actor, 'system');
    });

    test('스냅샷 쓰기도 기록된다', () => {
        const s = store.getProjectStore('audit-snap', { actor: 'bob', op: 'POST /api/snapshots' });
        s.writeSnapshots([{ id: '1', name: 'x', data: [] }]);
        const event = s.readEvents()[0];
        assert.equal(event.snapshots, 1);
        assert.equal(event.prevSnapshots, 0);
        assert.equal(event.actor, 'bob');
    });

    test('limit 으로 최신 N건만 읽는다', () => {
        const s = store.getProjectStore('audit-limit');
        for (let i = 0; i < 10; i++) s.writeTasks([task(`t${i}`)]);
        assert.equal(s.readEvents({ limit: 3 }).length, 3);
        assert.equal(s.readEvents().length, 10);
    });
});

describe('로그는 쓰기를 방해하지 않는다', () => {
    test('로그 파일이 디렉토리라 append 가 실패해도 데이터 쓰기는 성공한다', () => {
        const s = store.getProjectStore('audit-broken');
        s.writeTasks([task('a')]);
        // events.jsonl 자리에 디렉토리를 두어 appendFileSync 를 실패시킨다
        const file = path.join(store.projectDir('audit-broken'), 'events.jsonl');
        fs.rmSync(file, { force: true });
        fs.mkdirSync(file);

        assert.doesNotThrow(() => s.writeTasks([task('a'), task('b')]));
        assert.equal(s.readTasks().length, 2);
        assert.deepEqual(s.readEvents(), [], '읽기도 크래시하지 않고 빈 배열');
    });

    test('깨진 줄은 건너뛰고 나머지를 읽는다', () => {
        const s = store.getProjectStore('audit-torn');
        s.writeTasks([task('a')]);
        const file = path.join(store.projectDir('audit-torn'), 'events.jsonl');
        fs.appendFileSync(file, '{"ts":"2026-08-06T00:00:00.000Z","op":"tor\n');

        const events = s.readEvents();
        assert.equal(events.length, 1);
        assert.equal(events[0].nodes, 1);
    });
});

describe('롤오버', () => {
    test('상한을 넘으면 .1 로 한 세대 밀어둔다', () => {
        const dir = path.join(tmpRoot, 'rollover');
        const file = path.join(dir, 'events.jsonl');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, 'x'.repeat(eventLog.MAX_BYTES + 1));

        eventLog.append(dir, { op: 'after-rollover' });

        assert.ok(fs.existsSync(`${file}.1`), '이전 로그가 보존되어야 한다');
        assert.equal(eventLog.read(dir).length, 1, '새 로그는 1건부터 다시 시작');
    });
});
