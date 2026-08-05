// 저장소 계층 테스트 — 데이터 내구성과 방어선을 검증한다.
// 임시 DATA_DIR 을 쓰기 위해 store 모듈을 격리 로드한다.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpRoot;
let store;

before(() => {
    // store.js 는 로드 시점에 __dirname 기준으로 DATA_DIR 을 정한다.
    // 실제 데이터를 건드리지 않도록 모듈을 임시 위치로 복사해 로드한다.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-store-test-'));
    const libDir = path.join(tmpRoot, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'lib', 'store.js'), path.join(libDir, 'store.js'));
    store = require(path.join(libDir, 'store.js'));
});

after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const task = (id) => ({ id, name: id, children: [], timeRanges: [] });

describe('writeTasks — 최종 방어선', () => {
    test('배열이 아닌 값은 저장을 거부한다', () => {
        // 라우트 검증을 우회한 어떤 경로도 트리를 파괴할 수 없어야 한다.
        const s = store.getProjectStore('guard-test');
        s.writeTasks([task('a')]);

        assert.throws(() => s.writeTasks({ not: 'an array' }), TypeError);
        assert.throws(() => s.writeTasks('string'), TypeError);
        assert.throws(() => s.writeTasks(null), TypeError);

        // 거부 후에도 기존 데이터가 온전해야 한다
        assert.deepEqual(s.readTasks().map(t => t.id), ['a']);
    });

    test('쓰기마다 리비전이 증가한다', () => {
        const s = store.getProjectStore('rev-test');
        const r1 = s.writeTasks([task('a')]).revision;
        const r2 = s.writeTasks([task('a'), task('b')]).revision;
        assert.equal(r2, r1 + 1);
    });

    test('저장한 트리를 그대로 읽어온다', () => {
        const s = store.getProjectStore('roundtrip-test');
        const tree = [task('a'), task('b')];
        s.writeTasks(tree);
        assert.deepEqual(s.readTasks(), tree);
    });

    test('{ok,data} 엔벨로프로 저장된 과거 데이터도 배열로 정규화한다', () => {
        const s = store.getProjectStore('envelope-test');
        s.writeTasks([task('a')]);
        // 과거 버전이 실수로 엔벨로프를 저장한 상황을 재현
        const file = path.join(store.projectDir('envelope-test'), 'data.json');
        fs.writeFileSync(file, JSON.stringify({ ok: true, data: [task('x')] }));
        assert.deepEqual(s.readTasks().map(t => t.id), ['x']);
    });
});

describe('쓰기 전 세대 백업', () => {
    test('파괴적 쓰기(절반 이하로 축소) 시 백업을 남긴다', () => {
        const s = store.getProjectStore('backup-test');
        s.writeTasks([task('a'), task('b'), task('c'), task('d')]);

        const dataFile = path.join(store.projectDir('backup-test'), 'data.json');
        // 첫 백업(.bak.1 없음 → 무조건 생성)
        s.writeTasks([task('a'), task('b'), task('c')]);
        assert.ok(fs.existsSync(`${dataFile}.bak.1`), '.bak.1 이 생성되어야 한다');

        // 4건 → 1건은 파괴적 쓰기 → 시간 간격과 무관하게 백업
        s.writeTasks([task('only')]);
        assert.ok(fs.existsSync(`${dataFile}.bak.2`), '파괴적 쓰기 시 세대가 밀려야 한다');

        // 백업에서 이전 상태를 복구할 수 있어야 한다
        const restored = JSON.parse(fs.readFileSync(`${dataFile}.bak.1`, 'utf-8'));
        assert.equal(restored.length, 3);
    });

    test('연속 편집(비파괴적)에서는 백업이 매번 돌지 않는다', () => {
        const s = store.getProjectStore('nochurn-test');
        s.writeTasks([task('a'), task('b')]);
        const dataFile = path.join(store.projectDir('nochurn-test'), 'data.json');
        s.writeTasks([task('a'), task('b'), task('c')]); // .bak.1 생성

        // 같은 규모의 쓰기를 반복해도 10분 간격 전에는 세대가 늘지 않아야 한다
        for (let i = 0; i < 5; i++) {
            s.writeTasks([task('a'), task('b'), task('c'), task(`n${i}`)]);
        }
        assert.ok(!fs.existsSync(`${dataFile}.bak.2`), '짧은 간격의 비파괴적 쓰기는 세대를 늘리지 않는다');
    });
});

describe('경로 안전성', () => {
    test('isValidPid 가 경로 이스케이프를 막는다', () => {
        assert.ok(store.isValidPid('default'));
        assert.ok(store.isValidPid('proj-123-abc'));

        assert.ok(!store.isValidPid('../etc'));
        assert.ok(!store.isValidPid('a/b'));
        assert.ok(!store.isValidPid('..'));
        assert.ok(!store.isValidPid('UPPER'));
        assert.ok(!store.isValidPid('-leading-hyphen'));
        assert.ok(!store.isValidPid(''));
        assert.ok(!store.isValidPid('a'.repeat(65)));
        assert.ok(!store.isValidPid(null));
    });

    test('잘못된 pid 로 스토어를 만들 수 없다', () => {
        assert.throws(() => store.getProjectStore('../escape'), /invalid project id/);
    });
});

describe('원자적 쓰기', () => {
    test('쓰기 후 임시 파일이 남지 않는다', () => {
        const s = store.getProjectStore('atomic-test');
        s.writeTasks([task('a')]);
        const dir = store.projectDir('atomic-test');
        assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')), '.tmp 파일이 남아 있다');
    });

    test('읽을 수 없는 파일은 빈 트리로 처리한다 (크래시 대신 복구 가능 상태)', () => {
        const s = store.getProjectStore('corrupt-test');
        s.writeTasks([task('a')]);
        fs.writeFileSync(path.join(store.projectDir('corrupt-test'), 'data.json'), '{broken json');
        assert.deepEqual(s.readTasks(), []);
    });
});
