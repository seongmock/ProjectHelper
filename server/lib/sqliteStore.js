// SQLite 저장소 백엔드 — `PH_STORE=sqlite` 일 때만 쓰인다 (기본값은 JSON 파일).
//
// 왜 있는가 (P3-1): JSON 파일 저장소는 "읽고 → 통째로 다시 쓴다"라서, 같은 프로젝트를
// 두 요청이 동시에 쓰면 나중 쓰기가 앞의 것을 통째로 덮는다. 리비전(If-Match)이 브라우저
// 쪽 충돌은 잡지만, 서버 안에서 겹친 두 쓰기는 잡지 못한다. SQLite 트랜잭션은 그 창을 닫는다.
//
// 왜 기본값이 아닌가: 운영 데이터의 사본은 하나뿐이고, 저장 엔진 교체는 되돌리기 어려운
// 변경이다. 켜는 것은 사람이 하고(마이그레이션 스크립트 → 검증 → 환경변수), 코드는
// 두 엔진이 **같은 약속**을 지키는지만 책임진다(test/sqliteStore.test.js 의 미러 테스트).
//
// 세 가지는 일부러 SQLite 로 옮기지 않았다:
//  1. **감사 로그(events.jsonl)** — append-only 파일이라는 점 자체가 설계다. 감사 대상인
//     쓰기와 같은 트랜잭션 안에 두면, 잘못된 쓰기 하나가 자기 흔적까지 지울 수 있다.
//  2. **세대 백업(data.json.bak.N)** — 복구하는 사람은 대개 급하다. 그때 필요한 것은
//     조회 도구가 아니라 `cp` 다. 엔진과 무관하게 평범한 JSON 파일로 남긴다.
//  3. **프로젝트 레지스트리(projects.json)** — 작고, 부팅 때 한 번 읽고, 마이그레이션
//     로직(registry.ensureLayout)이 붙어 있다. 옮기면 이득 없이 위험만 는다.
//
// 트리는 한 행의 JSON 텍스트로 둔다. 노드를 행으로 정규화하면 재귀 트리 구현이 하나 더
// 생기고(클라이언트/server/lib/taskTree.js 에 이어 세 번째), 이 저장소에서 실제로 필요한
// 것은 질의가 아니라 원자성이다.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const eventLog = require('./eventLog');
const {
    isValidPid, projectDir, generationBackup, countNodes, DATA_DIR,
} = require('./store');

const DB_FILE = process.env.PH_SQLITE_FILE || path.join(DATA_DIR, 'projecthelper.db');

let db = null;
const handle = () => {
    if (db) return db;
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    db = new DatabaseSync(DB_FILE);
    // WAL: 읽기가 쓰기를 막지 않는다. FULL: 커밋이 디스크에 닿은 뒤에야 반환한다 —
    // JSON 쪽 writeJsonAtomic 의 fsync 와 같은 수준의 약속을 유지하기 위한 것이다.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_data (
            pid        TEXT PRIMARY KEY,
            tasks      TEXT NOT NULL DEFAULT '[]',
            snapshots  TEXT NOT NULL DEFAULT '[]',
            revision   INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        )
    `);
    return db;
};

// 테스트가 다른 DB 파일로 갈아탈 수 있게 — 운영 경로에서는 부르지 않는다.
const closeDb = () => {
    if (db) { db.close(); db = null; }
};

const parseJson = (text, fallback) => {
    try {
        const value = JSON.parse(text);
        return value === null || value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
};

const getProjectStore = (pid, ctx = {}) => {
    if (!isValidPid(pid)) throw new Error(`invalid project id: ${pid}`);
    const dir = projectDir(pid);
    const dataFile = path.join(dir, 'data.json'); // 세대 백업(.bak.N)의 이름 기준일 뿐이다
    const conn = handle();

    const row = () => conn.prepare('SELECT * FROM project_data WHERE pid = ?').get(pid) || null;

    const ensureRow = () => {
        conn.prepare(`
            INSERT INTO project_data (pid, tasks, snapshots, revision, updated_at)
            VALUES (?, '[]', '[]', 1, ?)
            ON CONFLICT(pid) DO NOTHING
        `).run(pid, new Date().toISOString());
    };

    const ensureDir = () => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    };

    const readMeta = () => {
        const r = row();
        if (r && typeof r.revision === 'number') {
            return { revision: r.revision, updatedAt: r.updated_at };
        }
        return { revision: 1, updatedAt: new Date().toISOString() };
    };

    const bumpRevision = () => {
        const next = { revision: readMeta().revision + 1, updatedAt: new Date().toISOString() };
        ensureRow();
        conn.prepare('UPDATE project_data SET revision = ?, updated_at = ? WHERE pid = ?')
            .run(next.revision, next.updatedAt, pid);
        return next;
    };

    // JSON 쪽과 같은 관용: 과거에 {ok, data} 엔벨로프로 저장된 값도 배열로 정규화하고,
    // 읽을 수 없는 값은 크래시 대신 빈 트리로 본다.
    const readTasks = () => {
        const r = row();
        if (!r) return [];
        const raw = parseJson(r.tasks, []);
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.data)) return raw.data;
        return [];
    };

    const writeTasks = (tasks) => {
        if (!Array.isArray(tasks)) {
            throw new TypeError('writeTasks: 작업 트리는 배열이어야 한다');
        }
        const before = readTasks();
        ensureDir();
        generationBackup(dataFile, before, tasks.length);

        const meta = { revision: readMeta().revision + 1, updatedAt: new Date().toISOString() };
        // 트리와 리비전은 한 트랜잭션에서 함께 움직인다 — 둘이 어긋나면 브라우저의
        // If-Match 판단이 거짓말을 한다(리비전은 올랐는데 트리는 옛것, 또는 그 반대).
        conn.exec('BEGIN IMMEDIATE');
        try {
            ensureRow();
            conn.prepare('UPDATE project_data SET tasks = ?, revision = ?, updated_at = ? WHERE pid = ?')
                .run(JSON.stringify(tasks), meta.revision, meta.updatedAt, pid);
            conn.exec('COMMIT');
        } catch (err) {
            conn.exec('ROLLBACK');
            throw err;
        }

        eventLog.append(dir, {
            actor: ctx.actor || 'system',
            op: ctx.op || 'writeTasks',
            revision: meta.revision,
            nodes: countNodes(tasks),
            prevNodes: countNodes(before),
        });
        return meta;
    };

    const withTasks = (mutator) => {
        const tasks = readTasks();
        const result = mutator(tasks);
        if (!Array.isArray(result)) return null;
        const meta = writeTasks(result);
        return { tasks: result, meta };
    };

    const readSnapshots = () => {
        const r = row();
        if (!r) return [];
        const value = parseJson(r.snapshots, []);
        return Array.isArray(value) ? value : [];
    };

    const writeSnapshots = (snapshots) => {
        const before = readSnapshots().length;
        ensureDir();
        ensureRow();
        conn.prepare('UPDATE project_data SET snapshots = ? WHERE pid = ?')
            .run(JSON.stringify(snapshots), pid);
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

module.exports = { getProjectStore, closeDb, DB_FILE };
