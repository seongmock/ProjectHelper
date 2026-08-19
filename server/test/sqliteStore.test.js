// SQLite 백엔드(PH_STORE=sqlite) 테스트.
//
// 핵심은 마지막 describe 의 **미러 테스트**다: 같은 조작 순서를 두 엔진에 그대로 흘리고
// 매 단계의 트리·리비전·스냅샷을 비교한다. 저장 엔진이 둘이라는 것은 "지켜야 할 약속이
// 두 곳에 흩어졌다"는 뜻이고, 그 드리프트는 UI 에서 보이지 않는다 — 이 저장소가
// taskTreeMirror.test.js 를 두고 있는 이유와 같다.
const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const roots = [];

// 엔진 하나를 격리된 데이터 디렉토리에 새로 적재한다.
// store.js/sqliteStore.js 는 로드 시점에 DATA_DIR 을 굳히므로 캐시를 비워야 한다.
const load = (engine) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `ph-${engine}-test-`));
    roots.push(root);
    try { require('../lib/sqliteStore').closeDb(); } catch { /* 아직 적재 전 */ }
    process.env.PH_DATA_DIR = root;
    for (const id of ['../lib/store', '../lib/sqliteStore']) {
        delete require.cache[require.resolve(id)];
    }
    const store = require('../lib/store');
    const api = engine === 'sqlite' ? require('../lib/sqliteStore') : store;
    return { root, store: api };
};

after(() => {
    try { require('../lib/sqliteStore').closeDb(); } catch { /* noop */ }
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const task = (id, children = []) => ({ id, name: id, children, timeRanges: [] });
const tree = (n) => Array.from({ length: n }, (_, i) => task(`t${i}`));

describe('SQLite 백엔드 — 저장소 계약', () => {
    let store;
    beforeEach(() => { store = load('sqlite').store; });

    test('없는 프로젝트는 빈 트리와 리비전 1로 보인다', () => {
        const s = store.getProjectStore('default');
        assert.deepEqual(s.readTasks(), []);
        assert.equal(s.readMeta().revision, 1);
        assert.deepEqual(s.readSnapshots(), []);
    });

    test('저장한 트리를 그대로 읽어온다 (중첩 포함)', () => {
        const s = store.getProjectStore('default');
        const data = [task('a', [task('b', [task('c')])])];
        s.writeTasks(data);
        assert.deepEqual(s.readTasks(), data);
    });

    test('배열이 아닌 값은 저장을 거부한다', () => {
        const s = store.getProjectStore('default');
        for (const bad of [null, undefined, {}, 'tasks', 42]) {
            assert.throws(() => s.writeTasks(bad), TypeError);
        }
        assert.deepEqual(s.readTasks(), []);
    });

    test('쓰기마다 리비전이 오르고, 트리와 같은 트랜잭션에서 움직인다', () => {
        const s = store.getProjectStore('default');
        const first = s.writeTasks([task('a')]);
        const second = s.writeTasks([task('a'), task('b')]);
        assert.equal(second.revision, first.revision + 1);
        assert.equal(s.readMeta().revision, second.revision);
        assert.equal(s.readTasks().length, 2);
    });

    test('프로젝트별로 완전히 분리된다', () => {
        const a = store.getProjectStore('alpha');
        const b = store.getProjectStore('beta');
        a.writeTasks([task('a')]);
        assert.deepEqual(b.readTasks(), []);
        b.writeTasks([task('b1'), task('b2')]);
        assert.equal(a.readTasks().length, 1);
        assert.equal(a.readMeta().revision, 2);
        assert.equal(b.readMeta().revision, 2);
    });

    test('잘못된 pid 로는 스토어를 만들 수 없다 (경로 이스케이프)', () => {
        for (const bad of ['../etc', 'a/b', 'UPPER', '', null]) {
            assert.throws(() => store.getProjectStore(bad), /invalid project id/);
        }
    });

    test('읽을 수 없는 값이 들어 있어도 크래시 대신 빈 트리다', () => {
        const s = store.getProjectStore('default');
        s.writeTasks([task('a')]);
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(require('../lib/sqliteStore').DB_FILE);
        db.prepare('UPDATE project_data SET tasks = ? WHERE pid = ?').run('{망가진', 'default');
        db.close();
        assert.deepEqual(s.readTasks(), []);
    });

    test('{ok,data} 엔벨로프도 배열로 정규화한다 (JSON 쪽과 같은 관용)', () => {
        const s = store.getProjectStore('default');
        s.writeTasks([task('a')]);
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(require('../lib/sqliteStore').DB_FILE);
        db.prepare('UPDATE project_data SET tasks = ? WHERE pid = ?')
            .run(JSON.stringify({ ok: true, data: [task('x')] }), 'default');
        db.close();
        assert.deepEqual(s.readTasks().map((t) => t.id), ['x']);
    });

    test('감사 로그는 여전히 events.jsonl 에 남는다 (DB 안이 아니다)', () => {
        const { root, store: engine } = load('sqlite');
        const s = engine.getProjectStore('default', { actor: '테스터', op: 'unit' });
        s.writeTasks([task('a', [task('b')])]);
        const line = JSON.parse(
            fs.readFileSync(path.join(root, 'projects', 'default', 'events.jsonl'), 'utf-8')
                .trim().split('\n').pop()
        );
        assert.equal(line.actor, '테스터');
        assert.equal(line.op, 'unit');
        assert.equal(line.nodes, 2);
        assert.equal(line.prevNodes, 0);
    });

    test('스냅샷도 감사 로그를 남기고 프로젝트별로 유지된다', () => {
        const s = store.getProjectStore('default');
        s.writeSnapshots([{ id: 's1' }, { id: 's2' }]);
        assert.equal(s.readSnapshots().length, 2);
        assert.equal(s.readEvents({ limit: 10 }).at(-1).op, 'writeSnapshots');
    });

    test('bumpRevision 은 트리를 건드리지 않고 리비전만 올린다', () => {
        const s = store.getProjectStore('default');
        s.writeTasks([task('a')]);
        const before = s.readMeta().revision;
        const next = s.bumpRevision();
        assert.equal(next.revision, before + 1);
        assert.deepEqual(s.readTasks().map((t) => t.id), ['a']);
    });

    test('withTasks 는 배열을 돌려줄 때만 저장한다', () => {
        const s = store.getProjectStore('default');
        assert.equal(s.withTasks(() => null), null);
        assert.equal(s.readMeta().revision, 1);
        const result = s.withTasks((tasks) => [...tasks, task('a')]);
        assert.equal(result.tasks.length, 1);
        assert.equal(s.readMeta().revision, 2);
    });
});

describe('SQLite 백엔드 — 세대 백업은 엔진과 무관하게 평범한 JSON 파일이다', () => {
    test('파괴적 쓰기(절반 이하로 축소)는 직전 트리를 .bak.1 로 남긴다', () => {
        const { root, store } = load('sqlite');
        const s = store.getProjectStore('default');
        s.writeTasks(tree(10));
        s.writeTasks([task('only')]);
        const bak = path.join(root, 'projects', 'default', 'data.json.bak.1');
        assert.ok(fs.existsSync(bak), '파괴적 쓰기인데 백업이 없다');
        assert.equal(JSON.parse(fs.readFileSync(bak, 'utf-8')).length, 10);
    });

    test('첫 쓰기는 백업하지 않는다 — 잃을 것이 없다', () => {
        const { root, store } = load('sqlite');
        store.getProjectStore('default').writeTasks(tree(5));
        assert.ok(!fs.existsSync(path.join(root, 'projects', 'default', 'data.json.bak.1')));
    });

    test('연속 편집(비파괴적)에서는 매번 돌지 않는다', () => {
        const { root, store } = load('sqlite');
        const s = store.getProjectStore('default');
        s.writeTasks(tree(4));
        s.writeTasks(tree(5)); // 첫 백업
        s.writeTasks(tree(6));
        s.writeTasks(tree(7));
        const dir = path.join(root, 'projects', 'default');
        assert.ok(fs.existsSync(path.join(dir, 'data.json.bak.1')));
        assert.ok(!fs.existsSync(path.join(dir, 'data.json.bak.2')), '10분 간격이 무시됐다');
    });
});

describe('두 엔진은 같은 약속을 지킨다 — 미러', () => {
    // 조작 순서 하나를 두 엔진에 그대로 흘리고 매 단계의 관측값을 비교한다.
    const script = [
        (s) => s.writeTasks([task('a')]),
        (s) => s.writeTasks([task('a', [task('a1'), task('a2')])]),
        (s) => s.withTasks((tasks) => [...tasks, task('b')]),
        (s) => s.withTasks(() => null),
        (s) => s.bumpRevision(),
        (s) => s.writeSnapshots([{ id: 's1', tasks: [] }]),
        (s) => s.writeTasks(tree(12)),
        (s) => s.writeTasks([task('survivor')]), // 파괴적
        (s) => { assert.throws(() => s.writeTasks('nope'), TypeError); },
        (s) => s.writeTasks([]),
    ];

    const observe = (s) => ({
        tasks: s.readTasks(),
        revision: s.readMeta().revision,
        snapshots: s.readSnapshots(),
        events: s.readEvents({ limit: 100 }).map((e) => ({
            op: e.op, nodes: e.nodes, prevNodes: e.prevNodes, snapshots: e.snapshots,
        })),
    });

    const run = (engine) => {
        const { root, store } = load(engine);
        const s = store.getProjectStore('default', { actor: 'mirror', op: 'script' });
        const observations = [observe(s)];
        for (const step of script) {
            step(s);
            observations.push(observe(s));
        }
        const dir = path.join(root, 'projects', 'default');
        const baks = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter((f) => f.startsWith('data.json.bak.')).sort()
            : [];
        return {
            observations,
            baks,
            bakContents: baks.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')).length),
        };
    };

    test('트리·리비전·스냅샷·감사 로그가 단계마다 일치한다', () => {
        const json = run('json');
        const sqlite = run('sqlite');
        assert.equal(json.observations.length, script.length + 1);
        for (let i = 0; i < json.observations.length; i++) {
            assert.deepEqual(sqlite.observations[i], json.observations[i], `단계 ${i} 에서 갈렸다`);
        }
    });

    test('세대 백업도 같은 이름·같은 내용으로 남는다', () => {
        const json = run('json');
        const sqlite = run('sqlite');
        assert.deepEqual(sqlite.baks, json.baks);
        assert.deepEqual(sqlite.bakContents, json.bakContents);
    });

    test('PH_STORE=sqlite 면 store.getProjectStore 자체가 SQLite 로 위임한다', () => {
        const { root, store } = load('sqlite');
        process.env.PH_STORE = 'sqlite';
        try {
            store.getProjectStore('default').writeTasks([task('a')]);
            // 위임됐다면 JSON 파일이 아니라 DB 에 들어간다.
            assert.ok(!fs.existsSync(path.join(root, 'projects', 'default', 'data.json')));
            assert.ok(fs.existsSync(path.join(root, 'projecthelper.db')));
            assert.deepEqual(store.getProjectStore('default').readTasks().map((t) => t.id), ['a']);
        } finally {
            delete process.env.PH_STORE;
        }
    });

    test('기본값(PH_STORE 없음)은 JSON 파일이다 — 엔진 교체는 사람이 한다', () => {
        const { root, store } = load('json');
        store.getProjectStore('default').writeTasks([task('a')]);
        assert.ok(fs.existsSync(path.join(root, 'projects', 'default', 'data.json')));
        assert.ok(!fs.existsSync(path.join(root, 'projecthelper.db')));
    });
});
