#!/usr/bin/env node
// 복원 연습의 '실제값' — 복원된 볼륨으로 띄운 API 컨테이너 **안에서** 돈다.
// 저장소를 직접 읽지 않고 HTTP 로 묻는다: 연습이 답해야 하는 질문은
// "파일이 거기 있는가"가 아니라 "앱이 그 데이터로 뜨는가"다.
const http = require('http');

const get = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: process.env.PORT || 3000, path }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`${path} → ${res.statusCode}`));
            try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
        });
    }).on('error', reject);
});

const countNodes = (tasks) =>
    (Array.isArray(tasks) ? tasks : []).reduce((n, t) => n + 1 + countNodes(t && t.children), 0);

(async () => {
    const { projects } = await get('/api/projects');
    const out = [];
    for (const project of [...projects].sort((a, b) => a.id.localeCompare(b.id))) {
        const { revision, tasks } = await get(`/api/projects/${project.id}/tasks`);
        out.push({ pid: project.id, revision, nodes: countNodes(tasks) });
    }
    process.stdout.write(JSON.stringify(out));
})().catch((err) => { console.error(err.message); process.exit(1); });
