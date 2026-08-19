// 인프로세스 메트릭 — 의존성 없이, 프로세스가 살아 있는 동안의 숫자만 센다.
//
// 왜 Prometheus 스택이 아닌가: 이건 컨테이너 하나짜리 사내 도구다. 스크레이퍼·시계열
// DB·알림 매니저를 얹으면 운영 대상이 하나에서 넷으로 늘고, 그걸 돌볼 사람이 없다.
// 실제로 답해야 하는 질문은 세 개뿐이다 — **살아 있나 / 언제부터 / 뭐가 깨지고 있나**.
//
// 그래서 상태는 이 모듈 안에만 있다(재시작하면 0으로 돌아간다 — 그게 맞다. 카운터가
// 살아남으면 "재시작했다"는 사실이 숫자에서 사라진다). 대신 출력은 Prometheus 텍스트
// 형식으로도 낼 수 있게 해 뒀다: 나중에 스크레이퍼를 붙일 때 서버를 고칠 필요가 없다.
const os = require('os');

const startedAt = Date.now();

const state = {
    requests: 0,
    byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    durationSumMs: 0,
    maxDurationMs: 0,
    mutations: 0,
    lastMutationAt: null,
    lastErrorAt: null,
};

const statusClass = (status) => `${Math.floor(status / 100)}xx`;

// requestLogger 가 응답 완료 시점에 한 번 부른다 — 계측 지점을 둘로 늘리지 않는다.
const record = ({ method, status, durationMs }) => {
    state.requests += 1;
    const cls = statusClass(status);
    if (cls in state.byClass) state.byClass[cls] += 1;
    state.durationSumMs += durationMs;
    if (durationMs > state.maxDurationMs) state.maxDurationMs = durationMs;

    if (method !== 'GET' && method !== 'HEAD' && status < 400) {
        state.mutations += 1;
        state.lastMutationAt = new Date().toISOString();
    }
    if (status >= 500) state.lastErrorAt = new Date().toISOString();
};

const snapshot = () => {
    const mem = process.memoryUsage();
    return {
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        startedAt: new Date(startedAt).toISOString(),
        node: process.version,
        pid: process.pid,
        loadAvg1m: os.loadavg()[0],
        memory: { rssMb: +(mem.rss / 1048576).toFixed(1), heapUsedMb: +(mem.heapUsed / 1048576).toFixed(1) },
        requests: {
            total: state.requests,
            ...state.byClass,
            avgMs: state.requests ? +(state.durationSumMs / state.requests).toFixed(1) : 0,
            maxMs: +state.maxDurationMs.toFixed(1),
        },
        // "언제 마지막으로 실제 변경이 있었나"는 백업이 최신인지 판단하는 근거가 된다.
        mutations: { total: state.mutations, lastAt: state.lastMutationAt },
        lastErrorAt: state.lastErrorAt,
    };
};

// Prometheus 텍스트 노출 형식. 이름/타입/값만 — 라벨은 status class 하나면 충분하다.
// 프로젝트 이름 같은 식별 정보는 넣지 않는다: 메트릭은 인증 뒤에 있어도 로그·대시보드로
// 흘러 나가는 값이고, 거기에 남의 프로젝트 이름이 실릴 이유가 없다.
const toPrometheus = (snap = snapshot()) => {
    const lines = [];
    const metric = (name, type, help, value) => {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`);
    };
    metric('ph_uptime_seconds', 'gauge', 'Seconds since process start', snap.uptimeSec);
    metric('ph_memory_rss_bytes', 'gauge', 'Resident set size', Math.round(snap.memory.rssMb * 1048576));
    metric('ph_requests_total', 'counter', 'HTTP requests served since start', snap.requests.total);

    lines.push('# HELP ph_requests_by_class_total HTTP requests by status class',
        '# TYPE ph_requests_by_class_total counter');
    for (const cls of ['2xx', '3xx', '4xx', '5xx']) {
        lines.push(`ph_requests_by_class_total{class="${cls}"} ${snap.requests[cls]}`);
    }
    metric('ph_request_duration_avg_ms', 'gauge', 'Mean response time since start', snap.requests.avgMs);
    metric('ph_request_duration_max_ms', 'gauge', 'Slowest response since start', snap.requests.maxMs);
    metric('ph_mutations_total', 'counter', 'Successful mutating requests since start', snap.mutations.total);
    return lines.join('\n') + '\n';
};

module.exports = { record, snapshot, toPrometheus };
