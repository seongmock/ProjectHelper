# AI 연동 가이드 — AI가 타임라인을 직접 읽고 수정하기

ProjectHelper는 AI 에이전트(Claude Code 등)가 프로젝트 일정을 직접 조회·수정할 수 있는 3개 레이어를 제공한다.

| 레이어 | 대상 | 위치 |
|---|---|---|
| REST API (작업 단위 CRUD) | 모든 HTTP 클라이언트 | `server/routes/tasks.js` |
| **셀프 디스커버리** (`GET /api` → `GET /api/guide`) | 사전 지식 없는 AI CLI | `server/lib/aiGuide.js` |
| OpenAPI 3.0 스펙 | 스펙 기반 도구/코드젠 | `server/openapi.yaml` · `GET /api/openapi.yaml` |
| MCP 서버 (13개 도구) | Claude Code, MCP 클라이언트 | `mcp/index.js` · `.mcp.json` |

## 셀프 디스커버리 — 사전 지식 없는 AI가 처음부터 계획을 작성하는 법

어떤 AI CLI든 API 주소 하나만 알면 사용법을 스스로 발견할 수 있다:

1. `GET /api` → `start_here: "/api/guide"` 진입점 응답
2. `GET /api/guide` → 데이터 모델·형식(JSON 예시)·**"계획을 처음부터 작성하는 워크플로우"**·동시성 규약·금지사항을 기계가 읽는 형태로 반환
3. 가이드의 절차대로: **`POST /api/projects`로 새 프로젝트 생성** → 그 안에 최상위 단계 `POST /projects/{pid}/tasks` → 하위 작업(`parentId`) → 마일스톤 → `PATCH progress` → flat 목록으로 확인

MCP 경유 시에는 `get-guide` 도구가 같은 가이드를 반환한다 (처음 사용 시 호출 권장).

## 다중 프로젝트 (v1.5)

- **새 계획은 새 프로젝트에**: `POST /api/projects {name}` → 반환된 `project.id`로 `/api/projects/{pid}/...` 경로 사용. 기존 데이터와 완전 격리 (독립 revision).
- 프로젝트 없는 경로(`/api/tasks` 등)는 **default 프로젝트의 별칭** (하위호환).
- MCP: `list-projects`/`create-project` 도구 + 모든 도구의 선택적 `projectId` 파라미터.
- 사용자는 헤더의 프로젝트 드롭다운으로 전환해 확인 — 드롭다운을 열 때 목록을 다시 가져오므로 AI가 만든 프로젝트가 바로 보인다.
- 멀티유저 배포 시 Caddy basicauth 사용자가 `X-Auth-User`로 전달되어 `owner`/`createdBy`에 기록된다.

## 빠른 시작 (Claude Code)

```bash
# 1. API 서버 실행
npm run dev:api          # :3000

# 2. MCP 의존성 설치 (최초 1회)
cd mcp && npm install

# 3. 프로젝트 루트에서 Claude Code 실행 → .mcp.json이 자동 등록
#    "8월 첫 2주로 '설계 검토' 작업 추가해줘" 같은 요청이 바로 동작
```

브라우저 앱을 열어둔 상태라면 **AI의 변경이 10초 안에 화면에 자동 반영**된다 (리비전 폴링).

## MCP 도구 12개

| 도구 | 설명 |
|---|---|
| `list-tasks` | 평탄 목록(id/name/level/dates) — 작업 ID 탐색용. **모든 작업의 시작점** |
| `get-task` | 단건 상세 (timeRanges/milestones/children) |
| `add-task` | 생성. `parentId`(하위), `position`, `startDate`+`endDate`(기간) 지원 |
| `update-task` | 이름/색상(#RRGGBB)/설명/라벨 |
| `delete-task` | 서브트리 포함 삭제 |
| `move-task` | 재부모화/순서 (`parentId: null` = 루트) |
| `reschedule` | 기간 날짜 변경. `shiftDays`(±N일 밀기) 또는 start/end 직접 지정 |
| `add-time-range` | 한 작업에 기간(바) 추가 (멀티 타임라인) |
| `delete-time-range` | 기간 삭제 |
| `add-milestone` | 마일스톤 (shape: diamond/circle/triangle/square/star/flag) |
| `delete-milestone` | 마일스톤 삭제 |
| `create-snapshot` | 전체 일정 이름 지정 백업 — **대량 편집 전 권장** |

환경변수: `PH_API_BASE`(기본 `http://localhost:3000/api`), `PH_BASIC_AUTH`(`user:pass`, Caddy HTTPS 경유 시).

## REST API 요약

응답 형식: 성공 `{ok:true, revision, ...}` / 오류 `{ok:false, error, revision?}` (400 검증 / 404 없음 / 409 리비전 충돌)

```
GET    /api/revision                                # 리비전 폴링 (경량)
GET    /api/tasks?flat=true                         # 목록 (트리 또는 평탄)
GET    /api/tasks/:id                               # 단건 + parentId
POST   /api/tasks                                   # 생성 {name*, parentId?, startDate?, endDate?, ...}
PATCH  /api/tasks/:id                               # 부분 수정 {name?, color?, description?, expanded?, labels?, divider?}
DELETE /api/tasks/:id                               # 서브트리 삭제
POST   /api/tasks/:id/move                          # {parentId*(null=루트), position?}
POST   /api/tasks/:id/time-ranges                   # 기간 추가 {startDate*, endDate*, label?, color?}
PATCH  /api/tasks/:id/time-ranges/:rangeId          # 기간 수정
DELETE /api/tasks/:id/time-ranges/:rangeId          # 기간 삭제
POST   /api/tasks/:id/milestones                    # {date*, label?, shape?, color?}
DELETE /api/tasks/:id/milestones/:milestoneId
GET    /api/data          # 통짜 트리 (읽기는 자유롭게)
POST   /api/data          # 통짜 교체 — AI는 가급적 금지 (작업 단위 사용)
GET    /api/events?limit=50   # 감사 로그 — 쓰기 이력 최신순 (읽기 전용)
```

`/api/events` 는 프로젝트별 append-only 로그(`data/projects/<pid>/events.jsonl`)를 읽는다.
쓰기 1건당 `{ts, actor, op, revision, nodes, prevNodes}` 한 줄 — "누가 언제 트리를 몇 개에서
몇 개로 바꿨는가"를 사후에 답하기 위한 것이다. **되돌리기 수단이 아니다**(복구는 스냅샷과
`data.json.bak.N` 세대 백업). `actor` 는 Caddy basicauth 가 넘긴 `X-Auth-User` 다.

## 동시성 규약

1. 모든 변경 응답의 `revision`은 단조 증가 정수 (`server/data/meta.json`)
2. `If-Match: <revision>` 헤더로 낙관적 잠금 — 불일치 시 `409 {error:"revision mismatch", revision:<현재>}`
3. 브라우저 동작:
   - 저장(1.5s 디바운스) 시 If-Match 전송, 409면 토스트 후 **서버 우선** 재로드
   - 보이는 탭에서 10초마다 `/api/revision` 폴링, 변경 시 조용히 재로드 (undo 히스토리 비오염)
4. AI 권장 패턴:
   - 단건 변경: If-Match 불필요 (작업 단위 엔드포인트는 충돌 표면이 작음)
   - read-modify-write(예: 여러 작업 일괄 이동): 읽을 때 받은 revision을 If-Match로 전송, 409면 재읽기
   - 파괴적 대량 작업 전: `create-snapshot`

## 검증

```bash
npx playwright test tests/e2e/ai-sync.spec.js   # API 서버 실행 중이어야 함
```
- 외부 API 쓰기 → 열린 탭 10초 내 반영
- 편집 충돌(409) → 서버 우선 재로드

수동 확인: 브라우저 열어둔 채 `curl -X POST .../api/tasks -d '{"name":"테스트"}'` → 화면에 나타나면 정상.
