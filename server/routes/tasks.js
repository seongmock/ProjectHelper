// 작업 단위 CRUD API — AI 에이전트가 트리 전체를 다루지 않고 개별 작업을 조작할 수 있게 한다.
// 응답: 성공 { ok:true, revision, ... } / 오류 { ok:false, error, revision? }
// 모든 변경 요청은 선택적 If-Match 헤더(리비전)를 지원 — 불일치 시 409.
//
// 이 파일은 HTTP 어댑터만 담당한다: 요청에서 인자를 뽑아 services/taskService 에 넘기고,
// 반환값을 그대로 응답한다. 검증·트리 조작·오류 판정은 전부 서비스에 있다.
// 프로젝트 스코프: req.projectStore(getProjectStore(pid))가 상위 미들웨어에서 주입됨.
const express = require('express');
const svc = require('../services/taskService');
const { route } = require('../lib/httpAdapter');

const router = express.Router({ mergeParams: true });

const ifMatch = (req) => req.get('If-Match');

// ── 리비전 폴링 ──────────────────────────────────────
router.get('/revision', route((req) => svc.getRevision(req.projectStore)));

// ── 작업 조회 ────────────────────────────────────────
router.get('/tasks', route((req) =>
    svc.listTasks(req.projectStore, { flat: req.query.flat === 'true' })));

router.get('/tasks/:id', route((req) => svc.getTask(req.projectStore, req.params.id)));

// ── 의존성 정합성 ────────────────────────────────────
// '/tasks/:id' 보다 아래에 둬도 경로가 겹치지 않는다(다른 세그먼트).
router.get('/dependency-issues', route((req) => svc.getDependencyIssues(req.projectStore)));

// ── 작업 CRUD ────────────────────────────────────────
router.post('/tasks', route((req) =>
    svc.createTask(req.projectStore, req.body, ifMatch(req)), 201));

router.patch('/tasks/:id', route((req) =>
    svc.updateTask(req.projectStore, req.params.id, req.body, ifMatch(req))));

router.delete('/tasks/:id', route((req) =>
    svc.deleteTask(req.projectStore, req.params.id, ifMatch(req))));

router.post('/tasks/:id/move', route((req) =>
    svc.moveTask(req.projectStore, req.params.id, req.body, ifMatch(req))));

// ── 기간(timeRange) CRUD ─────────────────────────────
router.post('/tasks/:id/time-ranges', route((req) =>
    svc.addTimeRange(req.projectStore, req.params.id, req.body, ifMatch(req)), 201));

router.patch('/tasks/:id/time-ranges/:rangeId', route((req) =>
    svc.updateTimeRange(req.projectStore, req.params.id, req.params.rangeId, req.body, ifMatch(req))));

router.delete('/tasks/:id/time-ranges/:rangeId', route((req) =>
    svc.deleteTimeRange(req.projectStore, req.params.id, req.params.rangeId, ifMatch(req))));

// ── 마일스톤 추가/삭제 ───────────────────────────────
router.post('/tasks/:id/milestones', route((req) =>
    svc.addMilestone(req.projectStore, req.params.id, req.body, ifMatch(req)), 201));

router.delete('/tasks/:id/milestones/:milestoneId', route((req) =>
    svc.deleteMilestone(req.projectStore, req.params.id, req.params.milestoneId, ifMatch(req))));

module.exports = { router };
