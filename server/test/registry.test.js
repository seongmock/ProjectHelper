// 프로젝트 레지스트리 + 그 위의 도메인 서비스.
//
// 여기서 검증하는 것은 목록 CRUD 가 아니라 **데이터가 사라지지 않는가**다. 두 지점이
// 위험하다: ① `ensureLayout()` 은 부팅 때마다 무조건 돌면서 레거시 단일 `data.json` 을
// 옮긴다 — 멱등하지 않으면 두 번째 부팅이 이미 옮긴 데이터를 덮는다. ② `deleteProject`
// 는 지우는 대신 `_trash/` 로 옮긴다 — 그 안전망이 사라지면 오타 한 번이 프로젝트
// 하나를 영구히 지운다. 둘 다 화면에는 아무 흔적도 남기지 않는다.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const roots = [];

// PH_DATA_DIR 은 store 로드 시점에 한 번만 읽힌다. 시나리오마다 빈 데이터 디렉토리가
// 필요하므로(특히 마이그레이션은 "아직 아무것도 없는 상태"가 전제다) 모듈을 통째로
// 다시 로드한다.
const freshRegistry = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-registry-test-'));
    roots.push(root);
    process.env.PH_DATA_DIR = root;
    for (const id of ['../lib/store', '../lib/registry', '../services/projectService']) {
        delete require.cache[require.resolve(id)];
    }
    return {
        root,
        store: require('../lib/store'),
        registry: require('../lib/registry'),
        service: require('../services/projectService'),
    };
};

after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('ensureLayout — 부팅 때마다 도는 마이그레이션', () => {
    test('빈 디렉토리에서 default 프로젝트를 만든다', () => {
        const { root, registry } = freshRegistry();
        registry.ensureLayout();

        assert.deepEqual(readJson(path.join(root, 'projects', 'default', 'data.json')), []);
        assert.deepEqual(registry.listProjects().map(p => p.id), ['default']);
    });

    test('레거시 단일 data.json 을 default 프로젝트로 옮긴다', () => {
        const { root, registry } = freshRegistry();
        const tree = [{ id: 't1', name: '옛 데이터', children: [], timeRanges: [] }];
        fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify(tree));
        fs.writeFileSync(path.join(root, 'meta.json'), JSON.stringify({ revision: 42 }));
        fs.writeFileSync(path.join(root, 'snapshots.json'), JSON.stringify([{ id: 's1' }]));

        registry.ensureLayout();

        const dir = path.join(root, 'projects', 'default');
        assert.deepEqual(readJson(path.join(dir, 'data.json')), tree);
        assert.equal(readJson(path.join(dir, 'meta.json')).revision, 42, '리비전이 이어져야 한다');
        assert.deepEqual(readJson(path.join(dir, 'snapshots.json')), [{ id: 's1' }]);
        // 옮긴 것이지 복사가 아니다 — 원본이 남아 있으면 다음 부팅이 다시 옮기려 든다
        assert.equal(fs.existsSync(path.join(root, 'data.json')), false);
    });

    test('멱등하다 — 두 번째 부팅이 옮겨 둔 데이터를 덮지 않는다', () => {
        const { root, registry, store } = freshRegistry();
        fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify([{ id: 't1', name: 'A', children: [], timeRanges: [] }]));
        registry.ensureLayout();

        // 마이그레이션 후 사용자가 편집한 상태를 흉내낸다
        store.getProjectStore('default').writeTasks([{ id: 't2', name: 'B', children: [], timeRanges: [] }]);

        registry.ensureLayout();
        registry.ensureLayout();

        assert.deepEqual(store.getProjectStore('default').readTasks().map(t => t.id), ['t2']);
        assert.equal(registry.listProjects().filter(p => p.id === 'default').length, 1,
            'default 가 레지스트리에 중복 등록되면 안 된다');
    });

    test('이미 있는 프로젝트를 지우지 않고 default 만 앞에 채워 넣는다', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        const mine = registry.createProject('내 프로젝트');

        // default 만 레지스트리에서 사라진 상태(손편집 등)를 흉내낸다
        registry.deleteProject('default');
        assert.deepEqual(registry.listProjects().map(p => p.id), [mine.id]);

        registry.ensureLayout();
        assert.deepEqual(registry.listProjects().map(p => p.id), ['default', mine.id]);
    });
});

describe('createProject', () => {
    test('빈 트리와 함께 만들어진다 (첫 저장 전에도 읽을 수 있어야 한다)', () => {
        const { registry, store } = freshRegistry();
        registry.ensureLayout();
        const p = registry.createProject('설계');

        assert.equal(p.name, '설계');
        assert.equal(p.owner, 'local');
        assert.deepEqual(store.getProjectStore(p.id).readTasks(), []);
        assert.match(p.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('id 가 겹치지 않는다', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        const ids = Array.from({ length: 50 }, (_, i) => registry.createProject(`p${i}`).id);
        assert.equal(new Set(ids).size, ids.length);
    });

    test('같은 이름을 여러 번 만들어도 각각 별개의 저장소다', () => {
        const { registry, store } = freshRegistry();
        registry.ensureLayout();
        const a = registry.createProject('같은 이름');
        const b = registry.createProject('같은 이름');
        assert.notEqual(a.id, b.id);

        store.getProjectStore(a.id).writeTasks([{ id: 'x', name: 'x', children: [], timeRanges: [] }]);
        assert.deepEqual(store.getProjectStore(b.id).readTasks(), []);
    });

    test('소유자를 기록한다', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        assert.equal(registry.createProject('감사', 'sm.yoo').owner, 'sm.yoo');
    });
});

describe('getProject / renameProject', () => {
    test('없는 id 는 null 이다 (예외가 아니다)', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        assert.equal(registry.getProject('없음'), null);
        assert.equal(registry.renameProject('없음', '새 이름'), null);
    });

    test('이름만 바꾸고 id 는 유지한다 — 레일 배지 색이 id 에서 나온다', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        const p = registry.createProject('전');
        const renamed = registry.renameProject(p.id, '후');

        assert.equal(renamed.id, p.id);
        assert.equal(renamed.name, '후');
        assert.equal(registry.getProject(p.id).name, '후');
    });

    test('변경 시각이 갱신된다', async () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        const p = registry.createProject('시각');
        await new Promise(r => setTimeout(r, 5));
        assert.notEqual(registry.renameProject(p.id, '갱신').updatedAt, p.updatedAt);
    });
});

describe('deleteProject — 지우는 대신 옮긴다', () => {
    test('삭제된 프로젝트의 데이터는 _trash 에 남는다', () => {
        const { root, registry, store } = freshRegistry();
        registry.ensureLayout();
        const p = registry.createProject('버릴 것');
        store.getProjectStore(p.id).writeTasks([{ id: 'keep', name: '살아 있어야 한다', children: [], timeRanges: [] }]);

        assert.deepEqual(registry.deleteProject(p.id), { ok: true });
        assert.equal(registry.getProject(p.id), null);
        assert.equal(fs.existsSync(store.projectDir(p.id)), false);

        const trash = fs.readdirSync(path.join(root, 'projects', '_trash'));
        const moved = trash.find(name => name.startsWith(p.id));
        assert.ok(moved, '_trash 로 옮겨져 있어야 한다');
        assert.deepEqual(
            readJson(path.join(root, 'projects', '_trash', moved, 'data.json')).map(t => t.id),
            ['keep']
        );
    });

    test('마지막 하나는 지울 수 없다 (빈 화면에서 복구할 수단이 없다)', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        assert.deepEqual(registry.deleteProject('default'), { error: 'cannot delete the last project' });
        assert.deepEqual(registry.listProjects().map(p => p.id), ['default']);
    });

    test('없는 id 는 not found — 남은 프로젝트를 건드리지 않는다', () => {
        const { registry } = freshRegistry();
        registry.ensureLayout();
        registry.createProject('둘째');
        assert.deepEqual(registry.deleteProject('없음'), { error: 'not found' });
        assert.equal(registry.listProjects().length, 2);
    });

    test('디렉토리가 이미 없어도 레지스트리에서는 빠진다', () => {
        const { registry, store } = freshRegistry();
        registry.ensureLayout();
        const p = registry.createProject('유령');
        fs.rmSync(store.projectDir(p.id), { recursive: true, force: true });

        assert.deepEqual(registry.deleteProject(p.id), { ok: true });
        assert.equal(registry.getProject(p.id), null);
    });
});

describe('projectService — registry 의 반환 규약을 AppError 로 통일한다', () => {
    const status = (fn) => {
        try { fn(); } catch (err) { return err.status; }
        return null;
    };

    test('이름이 없거나 공백뿐이면 400 이다', () => {
        const { registry, service } = freshRegistry();
        registry.ensureLayout();
        assert.equal(status(() => service.createProject({})), 400);
        assert.equal(status(() => service.createProject({ name: '   ' })), 400);
        assert.equal(status(() => service.createProject({ name: 123 })), 400);
    });

    test('이름의 앞뒤 공백은 다듬는다', () => {
        const { registry, service } = freshRegistry();
        registry.ensureLayout();
        assert.equal(service.createProject({ name: '  설계  ' }).project.name, '설계');
    });

    test('없는 프로젝트의 이름 변경/삭제는 404 다', () => {
        const { registry, service } = freshRegistry();
        registry.ensureLayout();
        registry.createProject('둘째');
        assert.equal(status(() => service.renameProject('없음', { name: 'x' })), 404);
        assert.equal(status(() => service.deleteProject('없음')), 404);
    });

    test('마지막 프로젝트 삭제는 404 가 아니라 400 이다 (있긴 있다)', () => {
        const { registry, service } = freshRegistry();
        registry.ensureLayout();
        assert.equal(status(() => service.deleteProject('default')), 400);
    });

    test('목록은 { projects } 로 감싸서 준다', () => {
        const { registry, service } = freshRegistry();
        registry.ensureLayout();
        assert.deepEqual(service.listProjects().projects.map(p => p.id), ['default']);
    });
});
