// 통짜 데이터 블롭 + 스냅샷 라우트 — 프로젝트 스코프 (req.projectStore 주입 전제)
// 스코프(/api/projects/:pid/*)와 legacy 별칭(/api/*, default 프로젝트) 두 곳에 마운트된다.
//
// HTTP 어댑터만 담당한다 — 검증·저장 규칙은 services/dataService 에 있다.
const express = require('express');
const svc = require('../services/dataService');
const { route } = require('../lib/httpAdapter');

const router = express.Router({ mergeParams: true });

// ── 프로젝트 데이터 (통짜 블롭 — 하위호환, If-Match 지원) ──
router.get('/data', route((req) => svc.readData(req.projectStore)));

router.post('/data', route((req) =>
    svc.writeData(req.projectStore, req.body, req.get('If-Match'))));

// ── 감사 로그 (읽기 전용) ────────────────────────────
router.get('/events', route((req) => svc.listEvents(req.projectStore, req.query.limit)));

// ── 스냅샷 (프로젝트별) ──────────────────────────────
router.get('/snapshots', route((req) => svc.listSnapshots(req.projectStore)));

router.post('/snapshots', route((req) =>
    svc.createSnapshot(req.projectStore, req.body || {}, req.user || 'local')));

router.put('/snapshots/:id', route((req) =>
    svc.updateSnapshot(req.projectStore, req.params.id, req.body || {})));

router.delete('/snapshots/:id', route((req) =>
    svc.deleteSnapshot(req.projectStore, req.params.id)));

module.exports = router;
