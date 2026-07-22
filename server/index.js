const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const aiGuide = require('./lib/aiGuide');
const { router: tasksRouter, checkRevision } = require('./routes/tasks');

const app = express();
const PORT = 3000;
const DATA_DIR = store.DATA_DIR;

app.use(express.json({ limit: '10mb' }));

// JSON 파일 읽기 헬퍼 (settings/snapshots — 리비전 무관 파일)
const readJson = (filename) => store.readJsonSafe(path.join(DATA_DIR, filename));
const writeJson = (filename, data) => store.writeJsonAtomic(path.join(DATA_DIR, filename), data);

// ── AI 셀프 디스커버리: 루트 진입점 + 가이드 ────────
// 사전 지식 없는 AI가 GET /api 만으로 사용법을 발견할 수 있게 한다
app.get('/api', (req, res) => {
    res.json({
        ok: true,
        name: 'ProjectHelper Timeline API',
        revision: store.readMeta().revision,
        start_here: '/api/guide',
        openapi: '/api/openapi.yaml',
        endpoints: ['/api/guide', '/api/openapi.yaml', '/api/tasks', '/api/revision', '/api/data', '/api/snapshots', '/api/health'],
    });
});

app.get('/api/guide', (req, res) => {
    res.json({ ok: true, guide: aiGuide });
});

// ── 프로젝트 데이터 (통짜 블롭 — 하위호환 유지, 리비전 지원 추가) ──
app.get('/api/data', (req, res) => {
    const tasks = store.readTasks();
    res.json({ ok: true, data: tasks.length > 0 ? tasks : null, revision: store.readMeta().revision });
});

app.post('/api/data', (req, res) => {
    // If-Match 헤더가 있으면 리비전 검사 (없으면 기존처럼 무조건 쓰기)
    if (!checkRevision(req, res)) return;
    const meta = store.writeTasks(req.body);
    res.json({ ok: true, revision: meta.revision });
});

// ── 작업 단위 CRUD + 리비전 API (AI 연동용) ─────────
app.use('/api', tasksRouter);

// ── OpenAPI 스펙 ─────────────────────────────────────
app.get('/api/openapi.yaml', (req, res) => {
    res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});

// ── 설정 ─────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
    const data = readJson('settings.json');
    res.json({ ok: true, data });
});

app.post('/api/settings', (req, res) => {
    writeJson('settings.json', req.body);
    res.json({ ok: true });
});

// ── 스냅샷 ───────────────────────────────────────────
app.get('/api/snapshots', (req, res) => {
    const data = readJson('snapshots.json') || [];
    res.json({ ok: true, data });
});

app.post('/api/snapshots', (req, res) => {
    const { name, data } = req.body;
    const snapshots = readJson('snapshots.json') || [];
    const newSnapshot = {
        id: Date.now().toString(),
        name,
        date: new Date().toISOString(),
        data,
    };
    snapshots.unshift(newSnapshot);
    writeJson('snapshots.json', snapshots);
    res.json({ ok: true, snapshot: newSnapshot });
});

app.put('/api/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const { data } = req.body;
    const snapshots = readJson('snapshots.json') || [];
    const index = snapshots.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });

    const updated = { ...snapshots[index], date: new Date().toISOString(), data };
    snapshots.splice(index, 1);
    snapshots.unshift(updated);
    writeJson('snapshots.json', snapshots);
    res.json({ ok: true });
});

app.delete('/api/snapshots/:id', (req, res) => {
    const { id } = req.params;
    const snapshots = readJson('snapshots.json') || [];
    writeJson('snapshots.json', snapshots.filter(s => s.id !== id));
    res.json({ ok: true });
});

// ── 헬스체크 ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});
