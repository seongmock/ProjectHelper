// AI 에이전트용 셀프 디스커버리 가이드 — GET /api/guide 로 서빙.
// 목적: 사전 지식이 없는 AI CLI가 이 응답만 읽고 일정 계획을 처음부터
// 작성·수정할 수 있게 하는 "기계용 튜토리얼". (스펙 전문은 /api/openapi.yaml)
module.exports = {
    name: 'ProjectHelper Timeline API — AI Guide',
    version: '1.2',
    purpose:
        '프로젝트 타임라인(간트 차트)을 REST로 조회/수정한다. ' +
        '열린 브라우저는 10초 폴링으로 변경을 자동 반영하므로 사용자에게 새로고침을 요구할 필요 없음.',

    discovery: {
        guide: 'GET /api/guide (이 문서)',
        openapi: 'GET /api/openapi.yaml (전체 스펙)',
        projects: 'GET /api/projects (프로젝트 목록 — 각각 독립된 작업 트리/리비전)',
        revision: 'GET /api/projects/{pid}/revision (경량 변경 감지)',
        health: 'GET /api/health',
        events: 'GET /api/projects/{pid}/events?limit=50 (감사 로그 — 누가 언제 무엇을 얼마나 바꿨는지)',
        dependencyIssues: 'GET /api/projects/{pid}/dependency-issues (의존성 점검 — 순환·일정 위반·끊어진 참조)',
        mcp: '프로젝트 루트 .mcp.json 등록 시 16개 MCP 도구 사용 가능 (get-guide, list-projects, create-project, add-task, reschedule 등)',
        auth: 'GET /api/auth/me — { mode:"open"|"enforced", user }. open 이면 인증 불필요.',
    },

    auth: {
        description:
            '서버에 계정이 하나도 없으면 인증이 꺼져 있다(open). 첫 관리자가 생기면 enforced 가 되고, ' +
            '그때부터 /api/, /api/guide, /api/openapi.yaml, /api/health, /api/auth/* 를 제외한 모든 경로에 신원이 필요하다.',
        agent:
            '에이전트는 사람 계정을 쓰지 말 것. `Authorization: Bearer <token>` 으로 서비스 토큰을 보낸다 ' +
            '(서버 환경변수 PH_API_TOKENS 의 "이름:역할:토큰"). 감사 로그의 actor 가 그 이름이 되므로 ' +
            '누가 무엇을 바꿨는지 사람과 구분된다. MCP 서버는 PH_API_TOKEN 환경변수로 같은 일을 한다.',
        roles: 'viewer(읽기) ⊂ editor(쓰기) ⊂ admin(계정 관리·프로젝트 삭제). 부족하면 403, 신원이 없으면 401.',
    },

    projects: {
        description:
            '데이터는 프로젝트 단위로 격리된다. 각 프로젝트는 독립된 작업 트리·리비전·스냅샷을 가진다. ' +
            '/api/tasks 등 프로젝트 없는 경로는 default 프로젝트의 별칭(하위호환). ' +
            '**새 일정 계획은 새 프로젝트를 만들어 그 안에 작성할 것** — 기존 데이터를 오염시키지 않는다.',
        endpoints: {
            list: 'GET /api/projects',
            create: 'POST /api/projects {name} → 201 {project:{id,...}} — 이후 모든 경로에 이 id 사용',
            rename: 'PATCH /api/projects/{pid} {name}',
            delete: 'DELETE /api/projects/{pid} (마지막 프로젝트는 400)',
            scoped: '/api/projects/{pid}/tasks | /data | /revision | /snapshots | /events | /dependency-issues — 프로젝트 없는 경로와 동일한 형태',
        },
        multiUser: '멀티유저 배포에서 owner/createdBy 는 로그인한 계정(또는 서비스 토큰의 이름)이다. ' +
            'X-Auth-User 헤더는 앞단 인증을 신뢰하도록 켰을 때만(PH_TRUST_PROXY_AUTH=1) 신원으로 쓰인다.',
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
            description: '새 일정 계획을 처음부터 작성하는 권장 절차 — 반드시 새 프로젝트 안에서',
            steps: [
                "1. POST /api/projects {name: '<계획 이름>'} → project.id 획득 (이하 {pid})",
                '2. 최상위 단계(phase)별로 POST /api/projects/{pid}/tasks {name, startDate, endDate, color?, description?} → 응답의 task.id 저장',
                '3. 하위 작업은 POST /api/projects/{pid}/tasks {name, parentId: <상위 id>, startDate, endDate}',
                '4. 주요 이벤트는 POST /api/projects/{pid}/tasks/{id}/milestones {date, label, shape?}',
                '5. 진행 상황은 PATCH /api/projects/{pid}/tasks/{id} {progress: 0~100}',
                '6. 확인은 GET /api/projects/{pid}/tasks?flat=true — 사용자는 헤더의 프로젝트 드롭다운에서 전환해 확인',
            ],
            example: [
                "PID=$(curl -sX POST -H 'Content-Type: application/json' -d '{\"name\":\"신제품 출시\"}' $BASE/projects | jq -r .project.id)",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"1단계: 기획\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-14\",\"color\":\"#4A90E2\"}' $BASE/projects/$PID/tasks",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"요구사항 정의\",\"parentId\":\"<위 응답의 task.id>\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-07\"}' $BASE/projects/$PID/tasks",
            ],
        },
        modifyExistingProject: '기존 계획 수정 시: GET /api/projects로 대상 프로젝트 확인 → 스코프 경로로 조작. 대량 편집 전 POST /api/projects/{pid}/snapshots 백업 권장.',
        reschedule: 'PATCH /api/tasks/{id}/time-ranges/{rangeId} {startDate?, endDate?} — rangeId는 GET /api/tasks/{id} 의 timeRanges[].id',
        move: 'POST /api/tasks/{id}/move {parentId(null=루트), position?} — 자기 서브트리 안으로는 이동 불가(400)',
        deleteSafely: 'DELETE /api/tasks/{id} 는 하위 전체 삭제 — 대량 삭제 전 스냅샷 권장',
        dependencies:
            '선행/후행 연결은 timeRange/milestone 의 dependencies[] 에 **선행의 id** 를 넣는다. ' +
            '존재하지 않는 id 이거나 순환을 닫는 연결은 400 으로 거부된다. ' +
            '일정을 옮긴 뒤에는 GET /api/projects/{pid}/dependency-issues 로 점검할 것 — ' +
            'overlaps(후행이 선행 종료보다 먼저 시작)와 dangling(삭제된 상대를 가리키는 참조)은 쓰기 시점에 막히지 않는다.',
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
        '작업을 지운 뒤 그것을 가리키던 의존성을 그대로 두지 말 것 (dependency-issues 의 dangling 으로 드러난다)',
    ],
};
