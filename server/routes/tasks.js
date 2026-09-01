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
const { renderAsciiChart } = require('../lib/asciiChart');
const { validators } = require('../lib/validate');

const router = express.Router({ mergeParams: true });

const ifMatch = (req) => req.get('If-Match');

// 쿼리 문자열은 무엇이든 올 수 있다 — 렌더 폭에 NaN 이 들어가면 빈 차트가 나온다.
const clampInt = (raw, min, max, fallback) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

// ── 리비전 폴링 ──────────────────────────────────────
router.get('/revision', route((req) => svc.getRevision(req.projectStore)));

// ── 작업 조회 ────────────────────────────────────────
router.get('/tasks', route((req) =>
    svc.listTasks(req.projectStore, { flat: req.query.flat === 'true' })));

router.get('/tasks/:id', route((req) => svc.getTask(req.projectStore, req.params.id)));

// ── 의존성 정합성 ────────────────────────────────────
// '/tasks/:id' 보다 아래에 둬도 경로가 겹치지 않는다(다른 세그먼트).
router.get('/dependency-issues', route((req) => svc.getDependencyIssues(req.projectStore)));

// ── 임계경로 / 여유(slack) ───────────────────────────
router.get('/critical-path', route((req) => svc.getCriticalPath(req.projectStore)));

// ── 텍스트 간트 ──────────────────────────────────────
// AI 가 자기가 만든 일정을 **볼** 수 있는 유일한 경로다. 그림을 돌려주는 엔드포인트가
// 없던 동안, 에이전트는 데이터를 쓸 수는 있어도 그 결과가 읽을 만한지 판정할 수단이
// 0이었다. `?format=text` 면 text/plain, 기본은 JSON(다른 응답과 형태를 맞춘다).
//
// **날짜는 clamp 하지 않는다.** 폭·행수는 추측해도 차트가 나오지만, 추측한 날짜로 그린
// 차트는 그냥 틀린 차트다. 검증이 없던 동안 셋이 함께 새어 나갔다: 반복 파라미터
// (`?from=a&from=b`)는 배열로 와서 `from.split` 이 TypeError → **500**(클라이언트 잘못이
// 5xx 카운터와 에러 로그를 오염시킨다), `to=1002026-01-01` 은 월 눈금 루프를 1200만 회
// 돌려 이벤트 루프를 7초 세웠고, 뒤집힌 범위는 "(-364일, 1칸=-4.8일)" 짜리 정상 응답이
// 됐다 — 이 경로는 에이전트가 자기 일정을 **볼 수 있는 유일한 창**이라 그 침묵이 가장 나쁘다.
router.get('/chart', (req, res, next) => {
    try {
        const range = {};
        for (const key of ['from', 'to']) {
            const raw = req.query[key];
            if (raw === undefined) continue;
            if (!validators.date(raw)) {
                return res.status(400).json({ ok: false, error: `${key} must be a valid YYYY-MM-DD date` });
            }
            range[key] = raw;
        }
        if (range.from && range.to && range.to < range.from) {
            return res.status(400).json({ ok: false, error: 'to must be >= from' });
        }
        const chart = renderAsciiChart(req.projectStore.readTasks(), {
            width: clampInt(req.query.width, 40, 400, 100),
            from: range.from,
            to: range.to,
            maxRows: clampInt(req.query.maxRows, 1, 1000, 200),
        });
        if (req.query.format === 'text') return res.type('text/plain; charset=utf-8').send(chart);
        res.json({ ok: true, revision: req.projectStore.readMeta().revision, chart });
    } catch (err) {
        next(err);
    }
});

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

// cascade=true 면 이 기간의 종료일이 **뒤로 밀린 만큼** 후행 전체를 같은 쓰기에서 민다.
// workdays=true 면 착지한 날짜가 주말이면 다음 평일로 밀어 준다.
router.patch('/tasks/:id/time-ranges/:rangeId', route((req) =>
    svc.updateTimeRange(req.projectStore, req.params.id, req.params.rangeId, req.body, ifMatch(req), {
        cascade: req.query.cascade === 'true',
        workdays: req.query.workdays === 'true',
    })));

router.delete('/tasks/:id/time-ranges/:rangeId', route((req) =>
    svc.deleteTimeRange(req.projectStore, req.params.id, req.params.rangeId, ifMatch(req))));

// ── 마일스톤 추가/수정/삭제 ──────────────────────────
router.post('/tasks/:id/milestones', route((req) =>
    svc.addMilestone(req.projectStore, req.params.id, req.body, ifMatch(req)), 201));

router.patch('/tasks/:id/milestones/:milestoneId', route((req) =>
    svc.updateMilestone(req.projectStore, req.params.id, req.params.milestoneId, req.body, ifMatch(req))));

router.delete('/tasks/:id/milestones/:milestoneId', route((req) =>
    svc.deleteMilestone(req.projectStore, req.params.id, req.params.milestoneId, ifMatch(req))));

// ── 일괄 적용 ────────────────────────────────────────
// 여러 변경을 **한 번의 쓰기**로 — 리비전 하나, 감사 한 줄, 전부 아니면 전무.
router.post('/batch', route((req) => svc.applyBatch(req.projectStore, req.body, ifMatch(req))));

module.exports = { router };
