// 데이터 저장소 — 프로젝트별 스코프 저장 (v1.5 다중 프로젝트)
// 구조: data/projects/<pid>/{data.json, meta.json, snapshots.json} + data/projects.json(레지스트리)
// 모든 쓰기는 원자적(tmp + rename)이며 해당 프로젝트의 리비전을 증가시킨다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// 경로 이스케이프 방지 — 프로젝트 id는 소문자/숫자/하이픈만
const PID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isValidPid = (pid) => typeof pid === 'string' && PID_RE.test(pid);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 공용 JSON 헬퍼 ───────────────────────────────────
const writeJsonAtomic = (filepath, data) => {
    const tmp = filepath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, filepath);
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

    const writeTasks = (tasks) => {
        ensureDir();
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
