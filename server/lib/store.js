// 데이터 저장소 — data.json(작업 트리) + meta.json(리비전) 관리
// 모든 쓰기는 원자적(tmp + rename)이며 리비전을 증가시킨다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── 원자적 JSON 쓰기 ─────────────────────────────────
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

// ── 리비전 (meta.json) ───────────────────────────────
const readMeta = () => {
    const meta = readJsonSafe(META_FILE);
    if (meta && typeof meta.revision === 'number') return meta;
    return { revision: 1, updatedAt: new Date().toISOString() };
};

const bumpRevision = () => {
    const meta = readMeta();
    const next = { revision: meta.revision + 1, updatedAt: new Date().toISOString() };
    writeJsonAtomic(META_FILE, next);
    return next;
};

// ── 작업 트리 (data.json) ────────────────────────────
// 과거에 실수로 저장된 {ok, data} 엔벨로프도 허용해 bare array로 정규화
const readTasks = () => {
    const raw = readJsonSafe(DATA_FILE);
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.data)) return raw.data;
    return [];
};

const writeTasks = (tasks) => {
    writeJsonAtomic(DATA_FILE, tasks);
    return bumpRevision();
};

// 읽기 → 변경 → 쓰기 헬퍼. mutator가 새 트리(배열)를 반환하면 저장 후
// { tasks, meta }를, 아니면(변경 없음) null을 반환한다.
const withTasks = (mutator) => {
    const tasks = readTasks();
    const result = mutator(tasks);
    if (!Array.isArray(result)) return null;
    const meta = writeTasks(result);
    return { tasks: result, meta };
};

module.exports = {
    readTasks,
    writeTasks,
    withTasks,
    readMeta,
    bumpRevision,
    readJsonSafe,
    writeJsonAtomic,
    DATA_DIR,
};
