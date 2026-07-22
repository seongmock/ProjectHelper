// AI 에이전트용 셀프 디스커버리 가이드 — GET /api/guide 로 서빙.
// 목적: 사전 지식이 없는 AI CLI가 이 응답만 읽고 일정 계획을 처음부터
// 작성·수정할 수 있게 하는 "기계용 튜토리얼". (스펙 전문은 /api/openapi.yaml)
module.exports = {
    name: 'ProjectHelper Timeline API — AI Guide',
    version: '1.1',
    purpose:
        '프로젝트 타임라인(간트 차트)을 REST로 조회/수정한다. ' +
        '열린 브라우저는 10초 폴링으로 변경을 자동 반영하므로 사용자에게 새로고침을 요구할 필요 없음.',

    discovery: {
        guide: 'GET /api/guide (이 문서)',
        openapi: 'GET /api/openapi.yaml (전체 스펙)',
        revision: 'GET /api/revision (경량 변경 감지)',
        health: 'GET /api/health',
        mcp: '프로젝트 루트 .mcp.json 등록 시 12개 MCP 도구 사용 가능 (list-tasks, add-task, reschedule 등)',
    },

    formats: {
        date: 'YYYY-MM-DD (예: 2026-08-01)',
        color: '#RRGGBB (예: #4A90E2)',
        milestoneShapes: ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'],
        progress: '0~100 정수 (%). 100이면 지연(overdue) 표시 해제',
        response: '성공 { ok:true, revision, ... } / 오류 { ok:false, error, revision? } (400 검증 / 404 없음 / 409 리비전 충돌)',
    },

    taskModel: {
        description:
            'Task는 재귀 트리(children). 날짜의 원본은 timeRanges[] — task의 startDate/endDate는 서버가 재계산하는 파생 캐시이므로 직접 쓰지 말 것. ' +
            '의존성(dependencies)은 timeRange/milestone 레벨. labels는 문자열 배열.',
        example: {
            id: 'task-... (서버가 생성)',
            name: '설계 검토',
            timeRanges: [{ id: '...', startDate: '2026-08-01', endDate: '2026-08-15', dependencies: [], color: null, label: '' }],
            color: '#4A90E2',
            description: '',
            progress: 0,
            children: [],
            expanded: true,
            labels: [],
            parentId: null,
            milestones: [{ id: '...', date: '2026-08-10', label: '1차 검토', color: '#5CB85C', shape: 'diamond' }],
        },
    },

    workflows: {
        createPlanFromScratch: {
            description: '빈 상태(또는 기존 데이터 위)에서 일정 계획을 처음부터 작성하는 권장 절차',
            steps: [
                '0. (기존 데이터가 있으면) POST /api/snapshots {name, data: <GET /api/data 의 data>} 로 백업',
                '1. 최상위 단계(phase)별로 POST /api/tasks {name, startDate, endDate, color?, description?} → 응답의 task.id 저장',
                '2. 하위 작업은 POST /api/tasks {name, parentId: <상위 id>, startDate, endDate}',
                '3. 주요 이벤트는 POST /api/tasks/{id}/milestones {date, label, shape?}',
                '4. 진행 상황은 PATCH /api/tasks/{id} {progress: 0~100}',
                '5. 확인은 GET /api/tasks?flat=true (id/name/level/parentId/날짜 요약)',
            ],
            example: [
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"1단계: 기획\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-14\",\"color\":\"#4A90E2\"}' $BASE/tasks",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"요구사항 정의\",\"parentId\":\"<위 응답의 task.id>\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-07\"}' $BASE/tasks",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"date\":\"2026-08-14\",\"label\":\"기획 승인\",\"shape\":\"diamond\"}' $BASE/tasks/<id>/milestones",
            ],
        },
        reschedule: 'PATCH /api/tasks/{id}/time-ranges/{rangeId} {startDate?, endDate?} — rangeId는 GET /api/tasks/{id} 의 timeRanges[].id',
        move: 'POST /api/tasks/{id}/move {parentId(null=루트), position?} — 자기 서브트리 안으로는 이동 불가(400)',
        deleteSafely: 'DELETE /api/tasks/{id} 는 하위 전체 삭제 — 대량 삭제 전 스냅샷 권장',
    },

    concurrency: {
        rule: '모든 변경 응답에 revision(증가 정수)이 포함된다. 변경 요청에 If-Match: <revision> 헤더를 넣으면 불일치 시 409 {revision:<현재>}.',
        recommendation:
            '단건 변경은 If-Match 생략 가능(작업 단위 엔드포인트는 충돌 표면이 작음). ' +
            'read-modify-write는 읽을 때의 revision을 If-Match로 보내고 409면 재읽기. ' +
            'POST /api/data(통짜 교체)는 피할 것.',
    },

    donts: [
        'task의 startDate/endDate를 직접 PATCH하지 말 것 (파생 캐시 — time-ranges 라우트 사용)',
        'POST /api/data 로 전체 교체하지 말 것 (열린 브라우저와 충돌 표면 최대화)',
        'id를 직접 만들지 말 것 (서버가 생성)',
    ],
};
