// 통짜 데이터 블롭 + 스냅샷 라우트 — 프로젝트 스코프 (req.projectStore 주입 전제)
// 스코프(/api/projects/:pid/*)와 legacy 별칭(/api/*, default 프로젝트) 두 곳에 마운트된다.
const express = require('express');
const { checkRevision } = require('./tasks');

const router = express.Router({ mergeParams: true });

// ── 프로젝트 데이터 (통짜 블롭 — 하위호환, If-Match 지원) ──
router.get('/data', (req, res) => {
    const tasks = req.projectStore.readTasks();
    res.json({ ok: true, data: tasks.length > 0 ? tasks : null, revision: req.projectStore.readMeta().revision });
});

router.post('/data', (req, res) => {
    if (!checkRevision(req, res)) return;
    const meta = req.projectStore.writeTasks(req.body);
    res.json({ ok: true, revision: meta.revision });
});

// ── 스냅샷 (프로젝트별) ──────────────────────────────
router.get('/snapshots', (req, res) => {
    res.json({ ok: true, data: req.projectStore.readSnapshots() });
});

router.post('/snapshots', (req, res) => {
    const { name, data } = req.body;
    const snapshots = req.projectStore.readSnapshots();
    const newSnapshot = {
        id: Date.now().toString(),
        name,
        date: new Date().toISOString(),
        createdBy: req.user || 'local',
        data,
    };
    snapshots.unshift(newSnapshot);
    req.projectStore.writeSnapshots(snapshots);
    res.json({ ok: true, snapshot: newSnapshot });
});

router.put('/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const { data } = req.body;
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
