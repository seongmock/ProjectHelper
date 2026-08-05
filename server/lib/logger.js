// 구조화 로거 — JSON Lines를 stdout으로. Docker/journald가 그대로 수집한다.
//
// 외부 의존성을 두지 않는 이유: 이 서버는 의도적으로 express 외 런타임 의존성이 없다
// (lib/validate.js도 같은 이유로 직접 구현). pino를 넣을 만큼 요구가 크지 않다.
//
// 실사 지적사항 B4(로깅 0건) 대응. 사고 시 "누가 언제 무엇을 바꿨는가"를 답할 수 있어야 한다.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

const emit = (level, msg, fields = {}) => {
    if (LEVELS[level] < MIN_LEVEL) return;
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...fields,
    });
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
};

const logger = {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
};

// 요청 로깅 미들웨어 — 응답 완료 시점에 1줄.
// 변경 요청(POST/PATCH/PUT/DELETE)은 감사 목적이므로 사용자·프로젝트·리비전을 함께 남긴다.
const requestLogger = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const mutating = req.method !== 'GET' && req.method !== 'HEAD';
        logger[res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'](
            'request',
            {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
                durationMs: Math.round(durationMs * 10) / 10,
                ...(mutating ? { audit: true, user: req.user, project: req.projectId } : {}),
            }
        );
    });
    next();
};

module.exports = { logger, requestLogger };
