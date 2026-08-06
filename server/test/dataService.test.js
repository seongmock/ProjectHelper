// 통짜 블롭 + 스냅샷 도메인 로직 테스트.
//
// POST /data 는 2026-08-05 운영 데이터 소실 사고의 경로다. 검증이 Service 계층으로
// 내려왔으므로 여기서 직접 방어선을 검증한다 — 라우트를 우회해도 같은 규칙이 적용된다.
const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-data-test-'));
process.env.PH_DATA_DIR = tmpRoot;

const store = require('../lib/store');
const svc = require('../services/dataService');
const { AppError } = require('../lib/errors');

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let s;
let seq = 0;
beforeEach(() => {
    s = store.getProjectStore(`data-${++seq}`);
    s.writeTasks([]);
});

const task = (id, extra = {}) => ({ id, name: id, children: [], timeRanges: [], ...extra });

const assertFails = (fn, status, messagePart) => {
    assert.throws(fn, (err) => {
        assert.ok(err instanceof AppError, `AppError 가 아니다: ${err}`);
        assert.equal(err.status, status);
        if (messagePart) assert.match(err.message, new RegExp(messagePart));
        return true;
    });
};

describe('writeData — 트리 전체 덮어쓰기 (가장 파괴적인 경로)', () => {
    test('정상 트리는 저장하고 리비전을 올린다', () => {
        const before = s.readMeta().revision;
        const { revision } = svc.writeData(s, [task('a'), task('b')]);
        assert.equal(revision, before + 1);
        assert.deepEqual(s.readTasks().map(t => t.id), ['a', 'b']);
    });

    test('배열이 아니면 거부하고 기존 데이터를 지키다', () => {
        svc.writeData(s, [task('keep')]);
        const rev = s.readMeta().revision;

        // 2026-08-05 사고의 정확한 재현: {"not":"an array"} 가 200으로 통과했다
        assertFails(() => svc.writeData(s, { not: 'an array' }), 400, 'must be an array');
        assertFails(() => svc.writeData(s, 'string'), 400);
        assertFails(() => svc.writeData(s, null), 400);

        assert.deepEqual(s.readTasks().map(t => t.id), ['keep']);
        assert.equal(s.readMeta().revision, rev, '거부된 쓰기가 리비전을 올리면 안 된다');
    });

    test('id 중복 트리는 거부한다 (트리 헬퍼가 엉뚱한 노드를 건드린다)', () => {
        assertFails(() => svc.writeData(s, [task('dup'), task('dup')]), 400, 'duplicate task id');
    });

    test('빈 배열은 허용한다 (전체 삭제는 정당한 조작)', () => {
        svc.writeData(s, [task('a')]);
        assert.doesNotThrow(() => svc.writeData(s, []));
        assert.deepEqual(s.readTasks(), []);
    });

    test('If-Match 불일치는 409', () => {
        svc.writeData(s, [task('a')]);
        const stale = String(s.readMeta().revision - 1);
        assertFails(() => svc.writeData(s, [task('b')], stale), 409, 'revision mismatch');
        assert.deepEqual(s.readTasks().map(t => t.id), ['a']);
    });
});

describe('readData', () => {
    test('비어 있으면 data 는 null (클라이언트가 샘플로 폴백하는 신호)', () => {
        assert.equal(svc.readData(s).data, null);
    });

    test('데이터가 있으면 배열과 리비전을 함께 준다', () => {
        svc.writeData(s, [task('a')]);
        const result = svc.readData(s);
        assert.equal(result.data.length, 1);
        assert.equal(result.revision, s.readMeta().revision);
    });
});

describe('스냅샷', () => {
    test('생성하면 목록 맨 앞에 온다 (최신순)', () => {
        svc.createSnapshot(s, { name: '첫번째', data: [task('a')] });
        svc.createSnapshot(s, { name: '두번째', data: [task('b')] });
        assert.deepEqual(svc.listSnapshots(s).data.map(x => x.name), ['두번째', '첫번째']);
    });

    test('이름이 비면 거부한다', () => {
        assertFails(() => svc.createSnapshot(s, { name: '   ', data: [] }), 400, 'non-empty');
        assertFails(() => svc.createSnapshot(s, { data: [] }), 400, 'non-empty');
    });

    test('깨진 트리는 스냅샷으로 저장할 수 없다 (복구 수단이 깨지면 안 된다)', () => {
        assertFails(() => svc.createSnapshot(s, { name: 'x', data: { bad: true } }), 400, 'snapshot data');
        assert.deepEqual(svc.listSnapshots(s).data, []);
    });

    test('createdBy 를 기록한다', () => {
        const { snapshot } = svc.createSnapshot(s, { name: 'x', data: [] }, 'alice');
        assert.equal(snapshot.createdBy, 'alice');
    });

    test('같은 밀리초에 만들어도 id 가 충돌하지 않는다', () => {
        const ids = new Set();
        for (let i = 0; i < 50; i++) {
            ids.add(svc.createSnapshot(s, { name: `s${i}`, data: [] }).snapshot.id);
        }
        assert.equal(ids.size, 50);
    });

    test(`상한(${svc.MAX_SNAPSHOTS})을 넘으면 오래된 것부터 버린다`, () => {
        for (let i = 0; i < svc.MAX_SNAPSHOTS + 5; i++) {
            svc.createSnapshot(s, { name: `s${i}`, data: [] });
        }
        const list = svc.listSnapshots(s).data;
        assert.equal(list.length, svc.MAX_SNAPSHOTS);
        assert.equal(list[0].name, `s${svc.MAX_SNAPSHOTS + 4}`); // 최신이 살아남는다
        assert.ok(!list.some(x => x.name === 's0'));
    });

    test('갱신하면 맨 앞으로 올라온다', () => {
        const { snapshot } = svc.createSnapshot(s, { name: '오래됨', data: [task('a')] });
        svc.createSnapshot(s, { name: '나중', data: [] });

        svc.updateSnapshot(s, snapshot.id, { data: [task('a'), task('b')] });
        const list = svc.listSnapshots(s).data;
        assert.equal(list[0].id, snapshot.id);
        assert.equal(list[0].data.length, 2);
        assert.equal(list[0].name, '오래됨', '갱신은 이름을 바꾸지 않는다');
    });

    test('없는 스냅샷 갱신은 404', () => {
        assertFails(() => svc.updateSnapshot(s, 'ghost', { data: [] }), 404, 'snapshot');
    });

    test('갱신도 트리를 검증한다', () => {
        const { snapshot } = svc.createSnapshot(s, { name: 'x', data: [task('a')] });
        assertFails(() => svc.updateSnapshot(s, snapshot.id, { data: 'nope' }), 400);
        assert.equal(svc.listSnapshots(s).data[0].data.length, 1);
    });

    test('삭제', () => {
        const { snapshot } = svc.createSnapshot(s, { name: 'x', data: [] });
        svc.deleteSnapshot(s, snapshot.id);
        assert.deepEqual(svc.listSnapshots(s).data, []);
    });

    test('없는 스냅샷 삭제는 조용히 성공한다 (멱등)', () => {
        assert.doesNotThrow(() => svc.deleteSnapshot(s, 'ghost'));
    });

    test('스냅샷 쓰기는 작업 트리 리비전을 건드리지 않는다', () => {
        svc.writeData(s, [task('a')]);
        const rev = s.readMeta().revision;
        svc.createSnapshot(s, { name: 'x', data: [task('a')] });
        assert.equal(s.readMeta().revision, rev);
    });
});
