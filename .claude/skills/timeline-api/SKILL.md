---
name: timeline-api
description: >
  ProjectHelper 타임라인 데이터를 AI가 직접 읽고 수정하는 방법.
  "일정 추가해줘", "작업 날짜 바꿔줘", "마일스톤 넣어줘", "타임라인 수정",
  "간트 차트에 작업 추가" 등 프로젝트 일정 데이터 조작 요청 시 사용.
  MCP 도구(project-helper)가 연결되어 있으면 그것을 우선 사용하고,
  없으면 REST API를 curl로 호출한다.
---

# ProjectHelper 타임라인 API 사용법

## 전제 조건

API 서버가 실행 중이어야 한다:
```bash
npm run dev:api   # 또는 cd server && npm start (포트 3000)
```
브라우저 앱(dev: 5173)은 `/api` 프록시로 같은 서버를 쓴다.
**열린 브라우저 탭은 10초 폴링으로 외부 변경을 자동 반영한다** — 수정 후 사용자에게 새로고침을 요구할 필요 없음.

## 다중 프로젝트 (중요)

데이터는 프로젝트 단위로 격리된다. **새 일정 계획은 새 프로젝트에 작성하라**:
`create-project`(MCP) 또는 `POST /api/projects {name}` → 반환된 id를 도구의 `projectId`
파라미터 / `/api/projects/{pid}/...` 경로에 사용. projectId 생략 시 default 프로젝트.
사용자는 헤더의 프로젝트 드롭다운에서 전환해 확인한다.

## 사용법을 모르면: 셀프 디스커버리

`GET /api` → `start_here`가 가리키는 `GET /api/guide`에 데이터 모델·형식 예시·
"계획을 처음부터 작성하는 워크플로우"·동시성 규약이 기계가 읽는 JSON으로 담겨 있다.
MCP에서는 `get-guide` 도구가 동일 내용 반환.

## 방법 1: MCP 도구 (우선)

`project-helper` MCP 서버가 등록되어 있으면 (프로젝트 루트 `.mcp.json`) 도구를 직접 호출:

| 도구 | 용도 |
|---|---|
| `get-guide` | API 사용 가이드 (처음 사용 시 먼저 호출) |
| `list-tasks` | 작업 ID 탐색 (flat 목록: id/name/level/dates) — **항상 이걸로 ID부터 확인** |
| `get-task` | 단건 상세 (timeRanges/milestones 포함) |
| `add-task` | 생성 (`parentId`로 하위 작업, `startDate`+`endDate`로 기간 지정) |
| `update-task` | 이름/색/설명/라벨/진행률(progress 0~100) 수정 |
| `reschedule` | 날짜 변경 (`shiftDays`로 통째 밀기 가능) |
| `move-task` | 재부모화/순서 변경 (`parentId: null` = 루트) |
| `add-time-range` / `delete-time-range` | 한 작업의 복수 기간(바) 관리 |
| `add-milestone` / `delete-milestone` | 마일스톤 마커 |
| `delete-task` | 서브트리 포함 삭제 |
| `check-dependencies` | 의존성 점검 — 순환/일정 위반/끊어진 참조 (일정 대량 이동 후 확인) |
| `create-snapshot` | **대량 편집/삭제 전 반드시 백업** |

## 방법 2: REST API (curl)

전체 스펙: `server/openapi.yaml` 또는 `GET /api/openapi.yaml`

```bash
BASE=http://localhost:3000/api

# 작업 목록 (ID 찾기)
curl -s "$BASE/tasks?flat=true"

# 작업 생성
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"새 작업","startDate":"2026-08-01","endDate":"2026-08-15","parentId":null}' \
  "$BASE/tasks"

# 날짜 변경 (rangeId는 get-task로 확인)
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-08-05","endDate":"2026-08-20"}' \
  "$BASE/tasks/{taskId}/time-ranges/{rangeId}"

# 마일스톤 추가
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"date":"2026-08-10","label":"1차 검토","shape":"diamond"}' \
  "$BASE/tasks/{taskId}/milestones"
```

## 데이터 모델 핵심

- Task는 **재귀 트리** (`children`). 날짜의 원본은 `timeRanges[]` — task의 `startDate`/`endDate`는 파생 캐시로 서버가 자동 재계산한다.
- `progress`: 0~100 정수 진행률. 100이면 지연(overdue) 표시가 해제된다. `PATCH /api/tasks/:id`로 수정.
- 의존성(`dependencies`)은 **timeRange/milestone 레벨**에 있다 (task 레벨은 레거시, 항상 빈 배열).
- 날짜는 `YYYY-MM-DD` 문자열. 색상은 `#RRGGBB`.
- milestone `shape`: diamond | circle | triangle | square | star | flag

## 동시성 규약 (중요)

- 모든 변경 응답에 `revision`(증가 정수)이 담긴다.
- 변경 요청에 `If-Match: <revision>` 헤더를 넣으면 리비전 불일치 시 **409** — read-modify-write 시 사용 권장.
- 헤더 생략 시 무조건 쓰기(last-write-wins). 단건 도구 호출이면 생략해도 안전 (브라우저가 10초 내 재동기화).
- `POST /api/data`(통짜 교체)는 피하라 — 작업 단위 엔드포인트를 쓰면 충돌 표면이 최소화된다.

## 프로덕션 (Caddy HTTPS 경유)

`https://<host>/api/...` 의 **basicauth 는 2026-08-18 현재 일시 제거된 상태**다 — 자격증명 없이
호출된다. 복구되면 MCP는 `PH_BASIC_AUTH=user:pass` 환경변수로 지원한다.
