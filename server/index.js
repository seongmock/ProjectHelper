const express = require('express');
const path = require('path');
const store = require('./lib/store');
const registry = require('./lib/registry');
const aiGuide = require('./lib/aiGuide');
const { router: tasksRouter } = require('./routes/tasks');
const dataRouter = require('./routes/data');
const projectsRouter = require('./routes/projects');

const app = express();
const PORT = 3000;

// 부팅 시 레거시(단일 data.json) → 프로젝트 레이아웃 마이그레이션 (멱등)
registry.ensureLayout();

app.use(express.json({ limit: '10mb' }));

// 사용자 신원 — Caddy basicauth가 X-Auth-User로 전달 (멀티유저 대비: 지금은 기록만, 강제 없음)
app.use('/api', (req, res, next) => {
    req.user = req.get('X-Auth-User') || 'local';
    next();
});

// ── AI 셀프 디스커버리: 루트 진입점 + 가이드 ────────
app.get('/api', (req, res) => {
    res.json({
        ok: true,
        name: 'ProjectHelper Timeline API',
        start_here: '/api/guide',
        openapi: '/api/openapi.yaml',
        endpoints: [
            '/api/guide', '/api/openapi.yaml', '/api/projects',
            '/api/projects/{pid}/tasks', '/api/projects/{pid}/data', '/api/projects/{pid}/revision', '/api/projects/{pid}/snapshots',
            '/api/tasks (→ default 프로젝트 별칭)', '/api/revision', '/api/data', '/api/snapshots', '/api/health',
        ],
    });
});

app.get('/api/guide', (req, res) => {
    res.json({ ok: true, guide: aiGuide });
});

// ── OpenAPI 스펙 ─────────────────────────────────────
app.get('/api/openapi.yaml', (req, res) => {
    res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});

// ── 설정 (전역 — 사용자별 설정은 v2.0 과제) ──────────
const readJson = (filename) => store.readJsonSafe(path.join(store.DATA_DIR, filename));
const writeJson = (filename, data) => store.writeJsonAtomic(path.join(store.DATA_DIR, filename), data);

app.get('/api/settings', (req, res) => {
    res.json({ ok: true, data: readJson('settings.json') });
});

app.post('/api/settings', (req, res) => {
    writeJson('settings.json', req.body);
    res.json({ ok: true });
});

// ── 헬스체크 ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// ── 프로젝트 레지스트리 CRUD ─────────────────────────
app.use('/api', projectsRouter);

// ── 프로젝트 스코프 라우트: /api/projects/:pid/* ─────
const projectScope = (req, res, next) => {
    const pid = req.params.pid;
    if (!store.isValidPid(pid) || !registry.getProject(pid)) {
        return res.status(404).json({ ok: false, error: 'project not found' });
    }
    req.projectId = pid;
    req.projectStore = store.getProjectStore(pid);
    next();
};
app.use('/api/projects/:pid', projectScope, dataRouter, tasksRouter);

// ── legacy 별칭: /api/* → default 프로젝트 (하위호환) ─
const defaultScope = (req, res, next) => {
    req.projectId = 'default';
    req.projectStore = store.getProjectStore('default');
    next();
};
app.use('/api', defaultScope, dataRouter, tasksRouter);

app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});
