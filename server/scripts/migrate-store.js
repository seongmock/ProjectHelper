#!/usr/bin/env node
// 저장 엔진 마이그레이션 — JSON 파일 ↔ SQLite (P3-1).
//
//   node server/scripts/migrate-store.js --to sqlite        # 무엇을 옮길지만 보여준다
//   node server/scripts/migrate-store.js --to sqlite --write # 실제로 옮긴다
//   node server/scripts/migrate-store.js --to json --write   # 되돌린다
//
// 규칙 셋:
//  1. **원본을 지우지 않는다.** 옮긴 뒤에도 JSON 파일(또는 DB)은 그대로 남는다. 되돌리는
//     방법이 `PH_STORE` 환경변수 하나여야 한다 — 그래야 엔진 교체가 되돌릴 수 있는 결정이 된다.
//  2. **기본은 예행연습이다.** --write 없이는 아무것도 쓰지 않는다.
//  3. **옮긴 직후 다시 읽어 비교한다.** 한 프로젝트라도 어긋나면 0이 아닌 코드로 끝난다.
//
// 감사 로그(events.jsonl)와 세대 백업(.bak.N), 레지스트리(projects.json)는 어느 엔진에서도
// 파일이므로 옮길 것이 없다 — 그대로 공유된다.
//
// 레거시 레이아웃(data/ 바로 아래 data.json)에서 시작한다면 **먼저 JSON 모드로 한 번
// 부팅**해 registry.ensureLayout 이 projects/default/ 로 정리하게 한 뒤에 옮긴다.
// 그 정리는 JSON 파일만 보기 때문이다.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const store = require('../lib/store');

const args = process.argv.slice(2);
const target = args[args.indexOf('--to') + 1];
const write = args.includes('--write');

if (!['json', 'sqlite'].includes(target)) {
    console.error('사용법: migrate-store.js --to <json|sqlite> [--write]');
    process.exit(2);
}

const DB_FILE = process.env.PH_SQLITE_FILE || path.join(store.DATA_DIR, 'projecthelper.db');

const listPids = () => {
    const registry = store.readJsonSafe(path.join(store.DATA_DIR, 'projects.json'));
    if (Array.isArray(registry) && registry.length) return registry.map((p) => p.id);
    if (!fs.existsSync(store.PROJECTS_DIR)) return [];
    return fs.readdirSync(store.PROJECTS_DIR).filter((d) => store.isValidPid(d));
};

// 엔진을 직접 다룬다 — 스토어 API 를 쓰면 리비전이 올라가고 감사 로그가 이사 기록으로
// 더럽혀진다. 마이그레이션은 편집이 아니라 이사다: 리비전을 **그대로** 옮긴다.
const readSide = (engine, pid) => {
    if (engine === 'json') {
        const dir = store.projectDir(pid);
        const raw = store.readJsonSafe(path.join(dir, 'data.json'));
        const meta = store.readJsonSafe(path.join(dir, 'meta.json'));
        return {
            tasks: Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []),
            snapshots: store.readJsonSafe(path.join(dir, 'snapshots.json')) || [],
            revision: meta && typeof meta.revision === 'number' ? meta.revision : 1,
            updatedAt: (meta && meta.updatedAt) || new Date().toISOString(),
        };
    }
    if (!fs.existsSync(DB_FILE)) return { tasks: [], snapshots: [], revision: 1, updatedAt: new Date().toISOString() };
    const db = new DatabaseSync(DB_FILE);
    try {
        const row = db.prepare('SELECT * FROM project_data WHERE pid = ?').get(pid);
        if (!row) return { tasks: [], snapshots: [], revision: 1, updatedAt: new Date().toISOString() };
        return {
            tasks: JSON.parse(row.tasks),
            snapshots: JSON.parse(row.snapshots),
            revision: row.revision,
            updatedAt: row.updated_at,
        };
    } finally {
        db.close();
    }
};

const writeSide = (engine, pid, payload) => {
    if (engine === 'json') {
        const dir = store.projectDir(pid);
        fs.mkdirSync(dir, { recursive: true });
        store.writeJsonAtomic(path.join(dir, 'data.json'), payload.tasks);
        store.writeJsonAtomic(path.join(dir, 'snapshots.json'), payload.snapshots);
        store.writeJsonAtomic(path.join(dir, 'meta.json'), {
            revision: payload.revision, updatedAt: payload.updatedAt,
        });
        return;
    }
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const db = new DatabaseSync(DB_FILE);
    try {
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
        db.prepare(`
            INSERT INTO project_data (pid, tasks, snapshots, revision, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(pid) DO UPDATE SET
                tasks = excluded.tasks, snapshots = excluded.snapshots,
                revision = excluded.revision, updated_at = excluded.updated_at
        `).run(pid, JSON.stringify(payload.tasks), JSON.stringify(payload.snapshots),
            payload.revision, payload.updatedAt);
    } finally {
        db.close();
    }
};

const countNodes = store.countNodes;
const source = target === 'sqlite' ? 'json' : 'sqlite';
const pids = listPids();

console.log(`데이터: ${store.DATA_DIR}`);
console.log(`${source} → ${target}${write ? '' : '  (예행연습 — 실제로 옮기려면 --write)'}`);
console.log(`프로젝트 ${pids.length}건\n`);

let failed = 0;
for (const pid of pids) {
    const payload = readSide(source, pid);
    const line = `  ${pid.padEnd(20)} 노드 ${String(countNodes(payload.tasks)).padStart(5)}`
        + `  스냅샷 ${String(payload.snapshots.length).padStart(3)}  리비전 ${payload.revision}`;
    if (!write) { console.log(line); continue; }

    writeSide(target, pid, payload);
    const after = readSide(target, pid);
    const ok = JSON.stringify(after.tasks) === JSON.stringify(payload.tasks)
        && JSON.stringify(after.snapshots) === JSON.stringify(payload.snapshots)
        && after.revision === payload.revision;
    console.log(`${line}  ${ok ? '✓' : '✗ 검증 실패'}`);
    if (!ok) failed++;
}

if (!write) {
    console.log('\n아무것도 쓰지 않았다. --write 를 붙이면 옮긴다.');
    process.exit(0);
}
if (failed) {
    console.error(`\n${failed}건이 옮긴 뒤 원본과 달랐다 — 환경변수를 바꾸지 마라.`);
    process.exit(1);
}
console.log(`\n완료. 원본(${source})은 그대로 남아 있다.`);
console.log(target === 'sqlite'
    ? 'API 컨테이너에 PH_STORE=sqlite 를 주고 재기동하면 SQLite 를 쓴다.'
    : 'PH_STORE 를 지우고 재기동하면 JSON 파일로 돌아간다.');
