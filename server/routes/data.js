// 통짜 데이터 블롭 + 스냅샷 라우트 — 프로젝트 스코프 (req.projectStore 주입 전제)
// 스코프(/api/projects/:pid/*)와 legacy 별칭(/api/*, default 프로젝트) 두 곳에 마운트된다.
const express = require('express');
const { checkRevision } = require('./tasks');
const { validateTaskTree } = require('../lib/validate');

const router = express.Router({ mergeParams: true });

const MAX_SNAPSHOTS = 50;

// ── 프로젝트 데이터 (통짜 블롭 — 하위호환, If-Match 지원) ──
router.get('/data', (req, res) => {
    const tasks = req.projectStore.readTasks();
    res.json({ ok: true, data: tasks.length > 0 ? tasks : null, revision: req.projectStore.readMeta().revision });
});

router.post('/data', (req, res) => {
    // 트리 전체를 덮어쓰는 가장 파괴적인 경로 — 검증 없이 통과시키면 안 된다.
    const err = validateTaskTree(req.body);
    if (err) {
        return res.status(400).json({
            ok: false,
            error: err,
            revision: req.projectStore.readMeta().revision,
        });
    }
    if (!checkRevision(req, res)) return;
    const meta = req.projectStore.writeTasks(req.body);
    res.json({ ok: true, revision: meta.revision });
});

// ── 스냅샷 (프로젝트별) ──────────────────────────────
router.get('/snapshots', (req, res) => {
    res.json({ ok: true, data: req.projectStore.readSnapshots() });
});

router.post('/snapshots', (req, res) => {
    const { name, data } = req.body || {};
    if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ ok: false, error: 'name must be a non-empty string' });
    }
    // 스냅샷은 사고 시 유일한 복구 수단이다. 깨진 트리를 저장하게 두면 안 된다.
    const err = validateTaskTree(data);
    if (err) return res.status(400).json({ ok: false, error: `snapshot data invalid: ${err}` });

    const snapshots = req.projectStore.readSnapshots();
    const newSnapshot = {
        // 같은 ms에 2건이 들어오면 Date.now()만으로는 id가 충돌한다
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        date: new Date().toISOString(),
        createdBy: req.user || 'local',
        data,
    };
    snapshots.unshift(newSnapshot);
    // 무한 증식 방지 — 오래된 것부터 버린다
    req.projectStore.writeSnapshots(snapshots.slice(0, MAX_SNAPSHOTS));
    res.json({ ok: true, snapshot: newSnapshot });
});

router.put('/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const { data } = req.body || {};
    const err = validateTaskTree(data);
    if (err) return res.status(400).json({ ok: false, error: `snapshot data invalid: ${err}` });

    const snapshots = req.projectStore.readSnapshots();
    const index = snapshots.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });

    const updated = { ...snapshots[index], date: new Date().toISOString(), data };
    snapshots.splice(index, 1);
    snapshots.unshift(updated);
    req.projectStore.writeSnapshots(snapshots);
    res.json({ ok: true });
});

router.delete('/snapshots/:id', (req, res) => {
    const snapshots = req.projectStore.readSnapshots();
    req.projectStore.writeSnapshots(snapshots.filter(s => s.id !== req.params.id));
    res.json({ ok: true });
});

module.exports = router;
