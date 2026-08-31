// AI 에이전트용 셀프 디스커버리 가이드 — GET /api/guide 로 서빙.
// 목적: 사전 지식이 없는 AI CLI가 이 응답만 읽고 일정 계획을 처음부터
// 작성·수정할 수 있게 하는 "기계용 튜토리얼". (스펙 전문은 /api/openapi.yaml)
module.exports = {
    name: 'ProjectHelper Timeline API — AI Guide',
    version: '1.4',
    purpose:
        '프로젝트 타임라인(간트 차트)을 REST로 조회/수정한다. ' +
        '열린 브라우저는 10초 폴링으로 변경을 자동 반영하므로 사용자에게 새로고침을 요구할 필요 없음.',

    discovery: {
        guide: 'GET /api/guide (이 문서)',
        openapi: 'GET /api/openapi.yaml (전체 스펙)',
        projects: 'GET /api/projects (프로젝트 목록 — 각각 독립된 작업 트리/리비전)',
        revision: 'GET /api/projects/{pid}/revision (경량 변경 감지)',
        health: 'GET /api/health',
        metrics: 'GET /api/metrics (운영 지표 — 가동시간·요청수·오류·마지막 변경 시각. ?format=prometheus 로 노출 형식)',
        events: 'GET /api/projects/{pid}/events?limit=50 (감사 로그 — 누가 언제 무엇을 얼마나 바꿨는지)',
        dependencyIssues: 'GET /api/projects/{pid}/dependency-issues (의존성 그래프 edges + 점검 — 순환·일정 위반·끊어진 참조)',
        criticalPath: 'GET /api/projects/{pid}/critical-path (임계경로와 여유 slack — 무엇이 늦으면 종료가 밀리는지)',
        chart: 'GET /api/projects/{pid}/chart?format=text (텍스트 간트 — **자기가 쓴 결과를 눈으로 확인하는 수단**)',
        batch: 'POST /api/projects/{pid}/batch {ops:[...]} (여러 변경을 한 번의 쓰기로 — 전부 아니면 전무)',
        settings: 'GET/POST /api/settings (전역 화면 설정 — 프로젝트 스코프 밖이고 일정 데이터는 없다)',
        mcp: '프로젝트 루트 .mcp.json 등록 시 21개 MCP 도구 사용 가능 (get-guide, list-projects, create-project, add-task, reschedule, batch, render-chart, critical-path 등)',
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
            scoped: '/api/projects/{pid}/tasks | /data | /revision | /snapshots | /events | /dependency-issues | /critical-path | /chart | /batch — 프로젝트 없는 경로와 동일한 형태',
        },
        multiUser: '멀티유저 배포에서 owner/createdBy 는 로그인한 계정(또는 서비스 토큰의 이름)이다. ' +
            'X-Auth-User 헤더는 앞단 인증을 신뢰하도록 켰을 때만(PH_TRUST_PROXY_AUTH=1) 신원으로 쓰인다.',
    },

    formats: {
        date: 'YYYY-MM-DD (예: 2026-08-01)',
        color: '#RRGGBB (예: #4A90E2)',
        milestoneShapes: ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'],
        progress: '0~100 정수 (%). 100이면 지연(overdue) 표시 해제',
        labelPosition: 'auto|top|bottom|left|right — 마일스톤 라벨 위치. auto(기본)는 서로 겹치지 않게 자동 배치되므로 보통 지정하지 않는다.',
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
            milestones: [{ id: '...', date: '2026-08-10', label: '1차 검토', color: '#5CB85C', shape: 'diamond', labelPosition: 'auto', dependencies: [] }],
        },
    },

    workflows: {
        // 큰 계획은 이쪽이 기본이다. 도구를 N 번 부르면 리비전이 N 오르고 매 호출이
        // 트리 전체를 다시 쓴다 — 중간에 실패하면 절반 지어진 트리가 남는다.
        createPlanInOneWrite: {
            description:
                '계획 전체를 **한 번의 쓰기**로 만드는 권장 절차. 리비전 하나, 감사 한 줄, ' +
                '하나가 실패하면 앞선 것까지 되돌아간다(중간 상태가 남지 않는다).',
            steps: [
                "1. POST /api/projects {name} → project.id ({pid})",
                '2. POST /api/projects/{pid}/batch {ops:[...]} — ops 는 최대 200개, 순서대로 적용된다',
                '3. ref 로 앞선 op 의 결과를 가리킨다: `@이름`(작업 id) / `@이름:range`(그 작업의 첫 기간 id). ' +
                    '부모-자식 트리와 의존성 연결을 같은 배치 안에서 만들 수 있다',
                '4. GET /api/projects/{pid}/chart?format=text 로 **그려진 결과를 확인**한다',
                '5. GET /api/projects/{pid}/dependency-issues 로 연결을 점검한다',
            ],
            example: {
                ops: [
                    { op: 'create-task', ref: 'design', body: { name: '설계', startDate: '2026-01-01', endDate: '2026-01-31' } },
                    { op: 'create-task', body: { name: '요구사항 정리', parentId: '@design', startDate: '2026-01-01', endDate: '2026-01-10' } },
                    { op: 'create-task', ref: 'dev', body: { name: '개발', startDate: '2026-02-01', endDate: '2026-03-31' } },
                    { op: 'update-time-range', taskId: '@dev', rangeId: '@dev:range', body: { dependencies: ['@design:range'] } },
                    { op: 'add-milestone', taskId: '@dev', body: { date: '2026-03-31', label: '코드 프리즈', shape: 'flag' } },
                ],
            },
            ops: 'create-task | update-task | delete-task | move-task | add-time-range | update-time-range | ' +
                'delete-time-range | add-milestone | update-milestone | delete-milestone — 단건 엔드포인트와 **같은 검증**을 받는다',
        },
        createPlanFromScratch: {
            description: '새 일정 계획을 처음부터 작성하는 권장 절차 — 반드시 새 프로젝트 안에서',
            steps: [
                "1. POST /api/projects {name: '<계획 이름>'} → project.id 획득 (이하 {pid})",
                '2. 최상위 단계(phase)별로 POST /api/projects/{pid}/tasks {name, startDate, endDate, color?, description?} → 응답의 task.id 저장',
                '3. 하위 작업은 POST /api/projects/{pid}/tasks {name, parentId: <상위 id>, startDate, endDate}',
                '4. 주요 이벤트는 POST /api/projects/{pid}/tasks/{id}/milestones {date, label, shape?}',
                '5. 진행 상황은 PATCH /api/projects/{pid}/tasks/{id} {progress: 0~100}',
                '6. 확인은 GET /api/projects/{pid}/tasks?flat=true — 사용자는 좌측 프로젝트 레일에서 클릭 한 번으로 전환해 확인(레일은 폴링과 함께 목록을 갱신하므로 새로고침 불필요)',
            ],
            example: [
                "PID=$(curl -sX POST -H 'Content-Type: application/json' -d '{\"name\":\"신제품 출시\"}' $BASE/projects | jq -r .project.id)",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"1단계: 기획\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-14\",\"color\":\"#4A90E2\"}' $BASE/projects/$PID/tasks",
                "curl -X POST -H 'Content-Type: application/json' -d '{\"name\":\"요구사항 정의\",\"parentId\":\"<위 응답의 task.id>\",\"startDate\":\"2026-08-03\",\"endDate\":\"2026-08-07\"}' $BASE/projects/$PID/tasks",
            ],
        },
        modifyExistingProject: '기존 계획 수정 시: GET /api/projects로 대상 프로젝트 확인 → 스코프 경로로 조작. 대량 편집 전 POST /api/projects/{pid}/snapshots 백업 권장.',
        reschedule: 'PATCH /api/tasks/{id}/time-ranges/{rangeId} {startDate?, endDate?} — rangeId는 GET /api/tasks/{id} 의 timeRanges[].id',
        cascade:
            'PATCH /api/projects/{pid}/tasks/{id}/time-ranges/{rangeId}?cascade=true — 종료일이 **뒤로 밀린 일수만큼** ' +
            '후행(전이적 포함) 전체를 같은 쓰기에서 민다. 응답의 cascaded/cascadeDays 가 무엇이 얼마나 움직였는지 말한다. ' +
            '앞당김은 전파하지 않는다(사람이 잡아 둔 간격을 지우지 않는다). ' +
            '&workdays=true 를 더하면 주말에 착지한 날짜를 다음 평일로 민다 — 공휴일 달력은 없다.',
        milestoneEdit:
            'PATCH /api/projects/{pid}/tasks/{id}/milestones/{milestoneId} {date?, label?, shape?, color?, labelPosition?, dependencies?}. ' +
            '**지우고 다시 만들지 말 것** — id 가 바뀌고, 삭제는 그 마일스톤을 가리키던 dependencies 를 함께 정리하므로 연결이 사라진다.',
        criticalPath:
            'GET /api/projects/{pid}/critical-path — 각 항목의 slackDays/slackWorkdays 와 criticalIds(여유 0). ' +
            '날짜는 이미 사람이 정한 값이므로 앞당기지 않고, "며칠 늦어도 종료가 안 밀리는가"만 답한다. ' +
            '순환이 있으면 400 이므로 dependency-issues 로 먼저 고칠 것.',
        verifyVisually:
            'GET /api/projects/{pid}/chart?format=text&width=100 — 텍스트 간트. AI 는 화면을 볼 수 없으므로 ' +
            '대량 편집 뒤 **반드시** 한 번 그려서 막대가 의도한 자리에 있는지 확인할 것. ' +
            'from/to 로 구간을, maxRows 로 행 수를 자른다.',
        move: 'POST /api/tasks/{id}/move {parentId(null=루트), position?} — 자기 서브트리 안으로는 이동 불가(400)',
        deleteSafely: 'DELETE /api/tasks/{id} 는 하위 전체 삭제 — 대량 삭제 전 스냅샷 권장',
        dependencies:
            '선행/후행 연결은 timeRange/milestone 의 dependencies[] 에 **선행의 id** 를 넣는다(PATCH 는 목록을 ' +
            '**교체**한다 — 추가하려면 먼저 읽어서 합칠 것). 존재하지 않는 id 이거나 순환을 닫는 연결은 400 으로 거부된다. ' +
            '현재 연결 그래프는 GET /api/projects/{pid}/dependency-issues 의 edges 로 읽는다 — ' +
            'overlaps(후행이 선행 종료보다 먼저 시작)와 dangling(삭제된 상대를 가리키는 참조)은 쓰기 시점에 막히지 않으므로 ' +
            '일정을 옮긴 뒤 같은 응답으로 점검할 것.',
    },

    // API 가 **못 하는 것**. 없는 기능을 짐작해서 호출하면 400/404 만 받고 이유를 알 수 없다.
    // 2026-08-31: 마일스톤 수정·의존성 쓰기·일괄 적용·캐스케이드·임계경로·텍스트 렌더가
    // 추가되어 여기서 빠졌다. 남은 것은 아래뿐이다.
    limitations: {
        noHolidays:
            '작업일 계산은 **주말만** 안다(토·일). 공휴일 달력이 데이터 모델에 없으므로 ' +
            'workdays=true 와 slackWorkdays 는 공휴일을 평일로 센다.',
        noForwardScheduling:
            '의존성으로부터 날짜를 **만들어 주지 않는다**. 연결은 판정(순환·위반·여유)에만 쓰이고, ' +
            '시작일은 사람이 정한 값이다 — "가능한 가장 이른 날로 배치"는 없다. ' +
            'cascade 도 뒤로 밀 때만 움직인다.',
        renderIsTextOnly:
            '렌더는 텍스트 간트뿐이다(GET /chart). 이미지·HTML 내보내기는 브라우저에서만 만들어진다 — ' +
            '색·라벨 겹침·화살표 모양 같은 시각적 판정은 API 로 볼 수 없으므로 사용자에게 화면 확인을 요청할 것.',
        noImport:
            '서버에는 가져오기(병합)가 없다. 다른 프로젝트의 트리를 복제하려면 읽어서 batch 로 다시 만들 것 — ' +
            'id 를 그대로 쓰면 두 프로젝트의 연결이 서로 얽힌다.',
        noSearch:
            '검색/필터 쿼리가 없다. GET /tasks?flat=true 로 전체를 받아 직접 거른다(작업 5000개 상한).',
        blobIsUnchecked:
            'POST /api/data(통짜 교체)는 순환·역방향 기간을 **검사하지 않는다** — 브라우저의 저장 경로이기도 해서 ' +
            '거부하면 사용자가 기존 데이터를 고칠 수 없게 된다. 그 경로로 쓴 것은 dependency-issues 에만 드러난다.',
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
        '마일스톤을 지우고 다시 만들어 "수정"하지 말 것 (PATCH .../milestones/{id} 를 쓸 것 — 삭제는 연결까지 가져간다)',
        '작업 N 개를 만들려고 POST 를 N 번 하지 말 것 (POST /api/projects/{pid}/batch 하나로 — 리비전 하나, 실패 시 전부 되돌림)',
        '대량 편집 뒤 GET /api/projects/{pid}/chart 를 건너뛰지 말 것 (AI 가 결과를 볼 수 있는 유일한 수단이다)',
    ],
};
