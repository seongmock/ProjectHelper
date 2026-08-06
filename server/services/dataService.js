// 통짜 트리 블롭 + 스냅샷 도메인 로직.
//
// POST /data 는 트리 전체를 한 번에 덮어쓰는 가장 파괴적인 경로다. 2026-08-05 실사에서
// 이 경로에 검증이 없어 운영 데이터가 소실됐다(docs/TECHNICAL_DUE_DILIGENCE.md 부록 A).
// 검증을 라우트가 아니라 여기에 두는 이유: 라우트를 우회하는 호출자가 생겨도 같은 방어선을 지난다.
const { validateTaskTree } = require('../lib/validate');
const { badRequest, notFound } = require('../lib/errors');
const { assertRevision } = require('./taskService');

const MAX_SNAPSHOTS = 50;

const assertTree = (data, label = 'data') => {
    const err = validateTaskTree(data);
    if (err) throw badRequest(label === 'data' ? err : `${label} invalid: ${err}`);
};

// ── 트리 블롭 ────────────────────────────────────────
const readData = (store) => {
    const tasks = store.readTasks();
    return { data: tasks.length > 0 ? tasks : null, revision: store.readMeta().revision };
};

const writeData = (store, body, ifMatch) => {
    assertTree(body);
    assertRevision(store, ifMatch);
    return { revision: store.writeTasks(body).revision };
};

// ── 스냅샷 ───────────────────────────────────────────
const listSnapshots = (store) => ({ data: store.readSnapshots() });

const createSnapshot = (store, { name, data }, createdBy = 'local') => {
    if (typeof name !== 'string' || name.trim() === '') {
        throw badRequest('name must be a non-empty string');
    }
    // 스냅샷은 사고 시 유일한 복구 수단이다. 깨진 트리를 저장하게 두면 안 된다.
    assertTree(data, 'snapshot data');

    const snapshot = {
        // 같은 ms에 2건이 들어오면 Date.now()만으로는 id가 충돌한다
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        date: new Date().toISOString(),
        createdBy,
        data,
    };

    const snapshots = store.readSnapshots();
    snapshots.unshift(snapshot);
    // 무한 증식 방지 — 오래된 것부터 버린다
    store.writeSnapshots(snapshots.slice(0, MAX_SNAPSHOTS));
    return { snapshot };
};

const updateSnapshot = (store, id, { data }) => {
    assertTree(data, 'snapshot data');

    const snapshots = store.readSnapshots();
    const index = snapshots.findIndex(s => s.id === id);
    if (index === -1) throw notFound('snapshot');

    // 갱신된 스냅샷을 맨 앞으로 (목록은 최신순)
    const updated = { ...snapshots[index], date: new Date().toISOString(), data };
    snapshots.splice(index, 1);
    snapshots.unshift(updated);
    store.writeSnapshots(snapshots);
    return {};
};

const deleteSnapshot = (store, id) => {
    store.writeSnapshots(store.readSnapshots().filter(s => s.id !== id));
    return {};
};

module.exports = {
    readData,
    writeData,
    listSnapshots,
    createSnapshot,
    updateSnapshot,
    deleteSnapshot,
    MAX_SNAPSHOTS,
};
