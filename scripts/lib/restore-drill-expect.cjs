#!/usr/bin/env node
// 복원 연습의 '기대값' — 아카이브를 펼친 디렉토리에서 프로젝트별 {revision, nodes} 를 읽는다.
// 호스트에서 돈다. 복원된 컨테이너가 HTTP 로 내놓는 값과 이것을 비교한다(scripts/restore-drill.sh).
//
// 저장소 모듈(lib/store.js)을 쓰지 않는 것은 의도다: 서버가 쓰는 코드로 기대값을 만들면
// 같은 버그를 양쪽에서 반복하고, 비교는 통과한다. 여기서는 파일/DB 를 직접 읽는다.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('사용법: restore-drill-expect.js <펼친-아카이브-디렉토리>'); process.exit(2); }

const countNodes = (tasks) =>
    (Array.isArray(tasks) ? tasks : []).reduce((n, t) => n + 1 + countNodes(t && t.children), 0);

const out = [];
const snapshot = path.join(dir, 'projecthelper.db.snapshot');
const db = path.join(dir, 'projecthelper.db');
const dbFile = fs.existsSync(snapshot) ? snapshot : (fs.existsSync(db) ? db : null);

if (dbFile) {
    const { DatabaseSync } = require('node:sqlite');
    const conn = new DatabaseSync(dbFile, { readOnly: true });
    const integrity = conn.prepare('PRAGMA integrity_check').get();
    if (integrity.integrity_check !== 'ok') {
        console.error(`DB 무결성 실패: ${integrity.integrity_check}`);
        process.exit(1);
    }
    for (const row of conn.prepare('SELECT pid, tasks, revision FROM project_data ORDER BY pid').all()) {
        out.push({ pid: row.pid, revision: row.revision, nodes: countNodes(JSON.parse(row.tasks)) });
    }
    conn.close();
} else {
    const projects = path.join(dir, 'projects');
    for (const pid of fs.existsSync(projects) ? fs.readdirSync(projects).sort() : []) {
        const p = (name) => path.join(projects, pid, name);
        if (!fs.existsSync(p('data.json'))) continue;
        const meta = fs.existsSync(p('meta.json')) ? JSON.parse(fs.readFileSync(p('meta.json'), 'utf-8')) : {};
        out.push({
            pid,
            revision: meta.revision ?? null,
            nodes: countNodes(JSON.parse(fs.readFileSync(p('data.json'), 'utf-8'))),
        });
    }
}

process.stdout.write(JSON.stringify(out));
