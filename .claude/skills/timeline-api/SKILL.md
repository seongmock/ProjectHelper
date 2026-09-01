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
사용자는 **좌측 프로젝트 레일**에서 클릭 한 번으로 전환해 확인한다(폴링이 목록도 갱신하므로 새로고침 불필요).

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
| `add-milestone` / `update-milestone` / `delete-milestone` | 마일스톤 마커 — 수정은 **반드시 `update-milestone`** (지우고 다시 만들면 id 가 바뀌어 연결이 사라진다) |
| `delete-task` | 서브트리 포함 삭제 |
| `check-dependencies` | 의존성 **그래프(`edges`)** + 점검 — 순환/일정 위반/끊어진 참조 |
| `set-dependencies` | 기간·마일스톤의 선행 목록 **교체** (순환·미지의 id 는 400) |
| `critical-path` | 임계경로와 여유(`slackDays`/`slackWorkdays`/`criticalIds`) |
| `render-chart` | 텍스트 간트 — **자기 결과를 눈으로 확인하는 유일한 수단** |
| `batch` | 여러 변경을 **한 번의 쓰기**로 (전부 아니면 전무). 계획을 처음부터 만들 때 기본 선택 |
| `create-snapshot` | **대량 편집/삭제 전 반드시 백업** |

**계획을 새로 만들 때는 `add-task` 를 N 번 부르지 말고 `batch` 하나로 보내라.** `ref` 로
앞선 op 의 결과를 `@이름`(작업 id) / `@이름:range`(그 작업의 첫 기간 id)로 가리킬 수 있어서,
부모-자식 트리와 의존성 연결까지 한 번에 만들어진다 — 리비전 하나, 감사 한 줄, 하나가
실패하면 앞선 것까지 되돌아간다(최대 200개).

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

# 마일스톤 추가 / 수정 (수정은 PATCH — 삭제+재생성 금지)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"date":"2026-08-10","label":"1차 검토","shape":"diamond","labelPosition":"top"}' \
  "$BASE/tasks/{taskId}/milestones"
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"date":"2026-08-12"}' \
  "$BASE/tasks/{taskId}/milestones/{milestoneId}"

# 뒤로 밀면서 후행까지 함께 (주말 회피)
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"endDate":"2026-08-25"}' \
  "$BASE/tasks/{taskId}/time-ranges/{rangeId}?cascade=true&workdays=true"

# 계획을 한 번의 쓰기로 (ref 로 앞선 op 의 새 id 를 가리킨다)
curl -s -X POST -H 'Content-Type: application/json' -d '{"ops":[
  {"op":"create-task","ref":"design","body":{"name":"설계","startDate":"2026-09-01","endDate":"2026-09-10"}},
  {"op":"create-task","ref":"dev","body":{"name":"개발","startDate":"2026-09-11","endDate":"2026-09-30"}},
  {"op":"update-time-range","taskId":"@dev","rangeId":"@dev:range","body":{"dependencies":["@design:range"]}}
]}' "$BASE/batch"

# 결과를 눈으로 확인 · 임계경로
curl -s "$BASE/chart?format=text&width=100"
curl -s "$BASE/critical-path"
```

## 데이터 모델 핵심

- Task는 **재귀 트리** (`children`). 날짜의 원본은 `timeRanges[]` — task의 `startDate`/`endDate`는 파생 캐시로 서버가 자동 재계산한다.
- `progress`: 0~100 정수 진행률. 100이면 지연(overdue) 표시가 해제된다. `PATCH /api/tasks/:id`로 수정.
- 의존성(`dependencies`)은 **timeRange/milestone 레벨**에 있다 (task 레벨은 레거시, 항상 빈 배열).
- 날짜는 `YYYY-MM-DD` 문자열. 색상은 `#RRGGBB`.
- milestone `shape`: diamond | circle | triangle | square | star | flag,
  `labelPosition`: auto | top | bottom | left | right (auto 가 겹치지 않게 배치하므로 보통 생략)

## API 로는 안 되는 것 (짐작해서 호출하지 말 것)

- **공휴일 달력 없음** — 작업일 계산(`workdays=true`, `slackWorkdays`)은 주말(토·일)만 안다.
- **전진 스케줄링 없음** — 의존성으로부터 날짜를 만들어 주지 않는다. 시작일은 사람이 정한 값이고,
  연결은 판정(순환·위반·여유)에만 쓰인다. `cascade` 도 **뒤로 밀 때만** 움직인다(앞당김은 전파하지
  않는다 — 사람이 잡아 둔 간격을 지우는 쪽이 더 큰 손실이다).
- **이미지·HTML 렌더 없음** — 렌더는 텍스트 간트(`render-chart`)뿐이다. 색·라벨 겹침 같은 시각적
  판정은 사용자에게 요청.
- **가져오기(병합) 없음** — 다른 프로젝트의 트리를 복제하려면 읽어서 `batch` 로 다시 만들 것
  (id 를 그대로 쓰면 두 프로젝트의 연결이 얽힌다).
- **검색·필터 쿼리 없음** — `?flat=true` 로 전체를 받아 직접 거른다(작업 5000개 상한).
- **통짜 `POST /api/data` 는 검증하지 않는다** — 순환·역방향 기간이 그대로 들어간다. 그 경로는 피하라.

전체 목록은 `GET /api/guide` 의 `limitations`.

## 동시성 규약 (중요)

- 모든 변경 응답에 `revision`(증가 정수)이 담긴다.
- 변경 요청에 `If-Match: <revision>` 헤더를 넣으면 리비전 불일치 시 **409** — read-modify-write 시 사용 권장.
- 헤더 생략 시 무조건 쓰기(last-write-wins). 단건 도구 호출이면 생략해도 안전 (브라우저가 10초 내 재동기화).
- `POST /api/data`(통짜 교체)는 피하라 — 작업 단위 엔드포인트를 쓰면 충돌 표면이 최소화된다.

## 프로덕션 (Caddy HTTPS 경유)

`https://<host>/api/...` 의 **basicauth 는 2026-08-18 현재 일시 제거된 상태**다 — 자격증명 없이
호출된다. 복구되면 MCP는 `PH_BASIC_AUTH=user:pass` 환경변수로 지원한다.
