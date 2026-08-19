// 데이터 저장소 — 프로젝트별 스코프 저장 (v1.5 다중 프로젝트)
// 구조: data/projects/<pid>/{data.json, meta.json, snapshots.json} + data/projects.json(레지스트리)
// 모든 쓰기는 원자적(tmp + rename)이며 해당 프로젝트의 리비전을 증가시킨다.
const fs = require('fs');
const path = require('path');
const eventLog = require('./eventLog');

// 데이터 위치를 주입 가능하게 둔다 — E2E/통합 테스트가 실제 데이터를 건드리지 않고
// 격리된 디렉토리에서 돌 수 있어야 한다 (playwright.config.js 의 webServer 참조).
const DATA_DIR = process.env.PH_DATA_DIR || path.join(__dirname, '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// 경로 이스케이프 방지 — 프로젝트 id는 소문자/숫자/하이픈만
const PID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isValidPid = (pid) => typeof pid === 'string' && PID_RE.test(pid);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 공용 JSON 헬퍼 ───────────────────────────────────
// tmp + fsync + rename. fsync가 없으면 전원 장애 시 rename만 반영되고 내용은
// 비어 있는 0바이트 파일이 남을 수 있다(ext4 지연 할당).
const writeJsonAtomic = (filepath, data) => {
    const tmp = filepath + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeFileSync(fd, JSON.stringify(data), 'utf-8');
        fs.fsyncSync(fd); // 내용을 디스크에 강제 반영한 뒤에야 rename 한다
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, filepath);

    // 디렉토리 엔트리(rename 자체)도 내구화
    try {
        const dirFd = fs.openSync(path.dirname(filepath), 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* 일부 파일시스템은 디렉토리 fsync를 지원하지 않는다 — 무시 */ }
};

// ── 쓰기 전 세대 백업 ────────────────────────────────
// 배경: 2026-08-05, 검증 없는 POST /api/data 한 번으로 운영 트리가 소실됐다.
// 볼륨 단위 일일 백업(scripts/backup-data.sh)만으로는 당일 편집분을 지킬 수 없어
// 저장소 계층에도 방어선을 둔다.
const BACKUP_GENERATIONS = 5;
const BACKUP_INTERVAL_MS = 10 * 60 * 1000; // 편집 중 1.5초마다 도는 것을 방지

const backupPath = (filepath, n) => `${filepath}.bak.${n}`;

const rotateBackups = (filepath) => {
    for (let i = BACKUP_GENERATIONS - 1; i >= 1; i--) {
        const from = backupPath(filepath, i);
        if (fs.existsSync(from)) fs.renameSync(from, backupPath(filepath, i + 1));
    }
};

// 백업을 뜰지 판단. 시간 경과 외에, 데이터가 급격히 줄어드는 '파괴적' 쓰기는
// 간격과 무관하게 무조건 보존한다.
// 판단은 **직전 트리의 크기**로 한다 — 예전에는 data.json 의 존재 여부로 "첫 쓰기인가"를
// 물었지만, 트리가 파일에 없는 엔진(sqliteStore)에서는 그 질문이 항상 '첫 쓰기'가 되어
// 백업이 영영 돌지 않는다. 잃을 것이 없다는 조건은 크기가 0이라는 것이지 파일이 없다는
// 것이 아니다.
const shouldBackup = (filepath, prevCount, nextCount) => {
    if (prevCount === 0) return false;
    const newest = backupPath(filepath, 1);
    if (!fs.existsSync(newest)) return true;

    if (nextCount < prevCount / 2) return true; // 파괴적 쓰기

    return Date.now() - fs.statSync(newest).mtimeMs > BACKUP_INTERVAL_MS;
};

// 세대 백업 한 번 = 판단 + 회전 + 직전 트리 보존.
// **직전 트리를 인자로 받는다** — 파일을 복사하지 않는다. 그래야 트리가 파일에 있든
// SQLite 행에 있든 같은 안전망을 쓴다(lib/sqliteStore.js). 백업만은 어느 엔진에서도
// 평범한 JSON 파일이어야 한다: 복구하는 사람은 대개 급하고, 그때 필요한 것은
// 조회 도구가 아니라 `cp` 다.
const generationBackup = (dataFile, prevTasks, nextCount) => {
    const prev = Array.isArray(prevTasks) ? prevTasks : [];
    if (!shouldBackup(dataFile, prev.length, nextCount)) return false;
    rotateBackups(dataFile);
    writeJsonAtomic(backupPath(dataFile, 1), prev);
    return true;
};

const readJsonSafe = (filepath) => {
    if (!fs.existsSync(filepath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
        return null;
    }
};

// ── 프로젝트 스코프 스토어 ───────────────────────────
const projectDir = (pid) => path.join(PROJECTS_DIR, pid);

// 트리 전체 노드 수 — 감사 로그에 변경의 '크기'를 남기기 위한 것.
// 최상위 배열 길이만으로는 하위 트리가 통째로 날아간 쓰기를 구분할 수 없다.
const countNodes = (tasks) =>
    (Array.isArray(tasks) ? tasks : []).reduce(
        (sum, task) => sum + 1 + countNodes(task && task.children), 0);

// ctx 는 감사 로그에 남길 호출자 정보다 — { actor, op }.
// HTTP 경로에서는 index.js 미들웨어가 주입하고, 스크립트/내부 호출은 기본값을 쓴다.
const jsonProjectStore = (pid, ctx = {}) => {
    if (!isValidPid(pid)) throw new Error(`invalid project id: ${pid}`);
    const dir = projectDir(pid);
    const dataFile = path.join(dir, 'data.json');
    const metaFile = path.join(dir, 'meta.json');
    const snapshotsFile = path.join(dir, 'snapshots.json');

    const ensureDir = () => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    };

    const readMeta = () => {
        const meta = readJsonSafe(metaFile);
        if (meta && typeof meta.revision === 'number') return meta;
        return { revision: 1, updatedAt: new Date().toISOString() };
    };

    const bumpRevision = () => {
        ensureDir();
        const next = { revision: readMeta().revision + 1, updatedAt: new Date().toISOString() };
        writeJsonAtomic(metaFile, next);
        return next;
    };

    // 과거에 실수로 저장된 {ok, data} 엔벨로프도 허용해 bare array로 정규화
    const readTasks = () => {
        const raw = readJsonSafe(dataFile);
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.data)) return raw.data;
        return [];
    };

    // 저장소 최종 방어선 — 라우트 검증을 우회한 어떤 경로도 트리를 파괴할 수 없게 한다.
    // (라우트 계층 검증은 routes/data.js, 트리 형태 검증은 lib/validate.js)
    const writeTasks = (tasks) => {
        if (!Array.isArray(tasks)) {
            throw new TypeError('writeTasks: 작업 트리는 배열이어야 한다');
        }
        ensureDir();
        const before = readTasks();
        generationBackup(dataFile, before, tasks.length);
        writeJsonAtomic(dataFile, tasks);
        const meta = bumpRevision();

        // 모든 트리 쓰기는 withTasks 를 거쳐서도 결국 여기로 온다 — 감사 로그의 단일 지점.
        eventLog.append(dir, {
            actor: ctx.actor || 'system',
            op: ctx.op || 'writeTasks',
            revision: meta.revision,
            nodes: countNodes(tasks),
            prevNodes: countNodes(before),
        });
        return meta;
    };

    // 읽기 → 변경 → 쓰기. mutator가 배열을 반환하면 저장, 아니면 null
    const withTasks = (mutator) => {
        const tasks = readTasks();
        const result = mutator(tasks);
        if (!Array.isArray(result)) return null;
        const meta = writeTasks(result);
        return { tasks: result, meta };
    };

    const readSnapshots = () => readJsonSafe(snapshotsFile) || [];
    const writeSnapshots = (snapshots) => {
        ensureDir();
        const before = readSnapshots().length;
        writeJsonAtomic(snapshotsFile, snapshots);
        eventLog.append(dir, {
            actor: ctx.actor || 'system',
            op: ctx.op || 'writeSnapshots',
            snapshots: snapshots.length,
            prevSnapshots: before,
        });
    };

    const readEvents = (options) => eventLog.read(dir, options);

    return {
        pid, readTasks, writeTasks, withTasks, readMeta, bumpRevision,
        readSnapshots, writeSnapshots, readEvents,
    };
};

// 저장 엔진 선택 — 기본은 위의 JSON 파일 저장소다.
// PH_STORE=sqlite 면 같은 인터페이스의 SQLite 백엔드로 위임한다(lib/sqliteStore.js).
// 지연 require 인 이유는 순환 참조다: sqliteStore 가 이 모듈의 경로/백업 헬퍼를 쓴다.
// 판단은 호출 시점에 읽는다 — 테스트가 한 프로세스 안에서 두 엔진을 비교할 수 있어야 한다.
let sqlite = null;
const getProjectStore = (pid, ctx = {}) => {
    if (process.env.PH_STORE === 'sqlite') {
        sqlite = sqlite || require('./sqliteStore');
        return sqlite.getProjectStore(pid, ctx);
    }
    return jsonProjectStore(pid, ctx);
};

module.exports = {
    getProjectStore,
    jsonProjectStore,
    isValidPid,
    generationBackup,
    countNodes,
    projectDir,
    readJsonSafe,
    writeJsonAtomic,
    DATA_DIR,
    PROJECTS_DIR,
};
