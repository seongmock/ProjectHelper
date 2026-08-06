const express = require('express');
const path = require('path');
const store = require('./lib/store');
const registry = require('./lib/registry');
const aiGuide = require('./lib/aiGuide');
const { router: tasksRouter } = require('./routes/tasks');
const dataRouter = require('./routes/data');
const projectsRouter = require('./routes/projects');
const { logger, requestLogger } = require('./lib/logger');

const app = express();
// 포트 고정은 호스트 충돌 시 손쓸 방법이 없다. (이 개발 호스트의 3000번은
// 무관한 uvicorn 서비스가 점유 중이라 실제로 문제가 됐다.)
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// 부팅 시 레거시(단일 data.json) → 프로젝트 레이아웃 마이그레이션 (멱등)
registry.ensureLayout();

app.disable('x-powered-by'); // 불필요한 스택 노출 제거
app.use(requestLogger);
app.use(express.json({ limit: '1mb' })); // 10mb는 과했다 — 트리 상한(5000노드)에 맞춘다

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
            '/api/projects/{pid}/events',
            '/api/tasks (→ default 프로젝트 별칭)', '/api/revision', '/api/data', '/api/snapshots',
            '/api/events', '/api/health',
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
// 스토어에 감사 컨텍스트를 함께 넘긴다 — 쓰기마다 events.jsonl 에 행위자·경로가 남는다.
const auditCtx = (req) => ({
    actor: req.user || 'local',
    op: `${req.method} ${req.originalUrl.split('?')[0]}`,
});

const projectScope = (req, res, next) => {
    const pid = req.params.pid;
    if (!store.isValidPid(pid) || !registry.getProject(pid)) {
        return res.status(404).json({ ok: false, error: 'project not found' });
    }
    req.projectId = pid;
    req.projectStore = store.getProjectStore(pid, auditCtx(req));
    next();
};
app.use('/api/projects/:pid', projectScope, dataRouter, tasksRouter);

// ── legacy 별칭: /api/* → default 프로젝트 (하위호환) ─
const defaultScope = (req, res, next) => {
    req.projectId = 'default';
    req.projectStore = store.getProjectStore('default', auditCtx(req));
    next();
};
app.use('/api', defaultScope, dataRouter, tasksRouter);

// ── 404 (알 수 없는 /api 경로) ───────────────────────
app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: 'endpoint not found', path: req.originalUrl });
});

// ── 전역 에러 핸들러 ─────────────────────────────────
// 이것이 없으면 Express 기본 핸들러가 동작하고, NODE_ENV가 production이 아닐 때
// 스택트레이스를 그대로 응답에 실어 보낸다(실사 지적사항 B3 — 실제로 유출됐다).
// next 인자는 쓰지 않지만 생략할 수 없다 — Express는 4-arity 함수만 에러 핸들러로 인식한다.
// (eslint 설정에서 `next` 를 unused-args 예외로 허용하고 있다)
app.use((err, req, res, next) => {
    // body-parser의 JSON 파싱 실패는 클라이언트 잘못이므로 400
    const isClientError = err.type === 'entity.parse.failed' || err.status === 400;
    const status = isClientError ? 400 : err.status || 500;

    logger.error('unhandled error', {
        method: req.method,
        path: req.originalUrl,
        status,
        error: err.message,
        stack: IS_PROD ? undefined : err.stack,
    });

    res.status(status).json({
        ok: false,
        error: isClientError ? 'malformed request body' : 'internal server error',
        // 스택은 어떤 환경에서도 응답에 포함하지 않는다. 필요하면 서버 로그를 본다.
    });
});

const server = app.listen(PORT, () => {
    logger.info('server started', { port: PORT, env: process.env.NODE_ENV || 'development' });
});

// ── graceful shutdown ────────────────────────────────
// 파일 쓰기 도중 강제 종료되면 데이터가 깨질 수 있다. 진행 중인 요청을 마치고 종료한다.
let shuttingDown = false;
const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    server.close(() => {
        logger.info('shutdown complete');
        process.exit(0);
    });
    // 커넥션이 안 닫히면 강제 종료 (Docker 기본 유예 10초보다 짧게)
    setTimeout(() => {
        logger.warn('forced shutdown after timeout');
        process.exit(1);
    }, 8000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: String(reason) });
});
