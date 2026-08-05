// 데이터 저장소 — 프로젝트별 스코프 저장 (v1.5 다중 프로젝트)
// 구조: data/projects/<pid>/{data.json, meta.json, snapshots.json} + data/projects.json(레지스트리)
// 모든 쓰기는 원자적(tmp + rename)이며 해당 프로젝트의 리비전을 증가시킨다.
const fs = require('fs');
const path = require('path');

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
    fs.copyFileSync(filepath, backupPath(filepath, 1));
};

// 백업을 뜰지 판단. 시간 경과 외에, 데이터가 급격히 줄어드는 '파괴적' 쓰기는
// 간격과 무관하게 무조건 보존한다.
const shouldBackup = (filepath, prevCount, nextCount) => {
    if (!fs.existsSync(filepath)) return false;
    const newest = backupPath(filepath, 1);
    if (!fs.existsSync(newest)) return true;

    const destructive = prevCount > 0 && nextCount < prevCount / 2;
    if (destructive) return true;

    return Date.now() - fs.statSync(newest).mtimeMs > BACKUP_INTERVAL_MS;
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

const getProjectStore = (pid) => {
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
        if (shouldBackup(dataFile, readTasks().length, tasks.length)) {
            rotateBackups(dataFile);
        }
        writeJsonAtomic(dataFile, tasks);
        return bumpRevision();
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
        writeJsonAtomic(snapshotsFile, snapshots);
    };

    return { pid, readTasks, writeTasks, withTasks, readMeta, bumpRevision, readSnapshots, writeSnapshots };
};

module.exports = {
    getProjectStore,
    isValidPid,
    projectDir,
    readJsonSafe,
    writeJsonAtomic,
    DATA_DIR,
    PROJECTS_DIR,
};
