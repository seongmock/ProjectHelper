# ProjectHelper — 기술 실사 보고서 (Technical Due Diligence)

- **실사일**: 2026-08-05
- **대상 커밋**: `0fca603` (main, 최종 커밋 2026-07-22 — 2주간 정지)
- **대상 환경**: 운영 스택 가동 중 (5일 uptime), `10.178.21.120`
- **규모**: 프론트 7,330 LOC / 서버 1,150 LOC / CSS 2,860 LOC / 커밋 208개
- **실사 방식**: 정적 분석 + 운영 컨테이너 실측 + E2E 실행 + 침투적 API 프로빙

> ⚠️ **본 실사 중 운영 데이터 손실 사고가 발생했다.** 원인·복구·시사점은 [부록 A](#부록-a-실사-중-발생한-운영-데이터-손실-사고)에 기록했다.
> 이 사고는 본 보고서 최상위 리스크(백업 부재 + 입력검증 부재)의 **실증 사례**다.

---

## 조치 현황 (2026-08-05 갱신)

**Phase 0(긴급 6건) · Phase 1(안정화 7건) 구현 및 검증 완료.** 진행 상태는 `HANDOVER.md`.

| Phase | 항목 | 상태 | 검증 결과 |
|---|---|---|---|
| P0-1 | 백업 체계 | ✅ | 첫 백업 생성 + 무결성 검증 통과, 크론 03:00 등록 |
| P0-2 | `POST /api/data` 검증 | ✅ | 비배열/중복id → 400, **데이터 생존 확인** |
| P0-3 | NODE_ENV + 에러 핸들러 | ✅ | 잘못된 JSON → 400 `malformed request body`, 스택 미노출 |
| P0-4 | 자격증명 분리 | ✅ | `Caddyfile` 해시 리터럴 0, `.env` gitignore 확인 |
| P0-5 | XSS 차단 | ✅ | 6개 지점 + `</script>` 브레이크아웃, 회귀 테스트 10건 |
| P0-6 | gzip + 캐시 헤더 | ✅ | **운영 실측 307,297 → 95,885 bytes (3.2배)** + immutable 헤더 |
| P1-1 | Node 22 + 태그 고정 + `npm ci` + non-root | ✅ | 운영에서 Node v22.23.2 · `node` 사용자 실행 확인 |
| P1-2 | vite 취약점 | ✅ | high 4건 → **0건** (vite 6.4.3) |
| P1-3 | 로깅 + graceful shutdown + PORT env | ✅ | SIGTERM → exit 0, 구조화 JSON 로그 |
| P1-4 | 단위테스트 도입 | ✅ | **77건** (unit 46 + server 31), 잠재 버그 2건 발견·수정 |
| P1-5 | ESLint + CI 게이트 | ✅ | 0 error / 23 warning, CI에 lint·audit·skip 검사 추가 |
| P1-6 | E2E 정합성 | ✅ | **19/1/8 → 28/28 (skip 0)** |
| P1-7 | UI Quick Win | 🔶 부분 | 3건 완료(라벨 줄바꿈·작업명 툴팁·지연 이중인코딩), 3건 P2 이관 |

**운영 재배포 완료 (2026-08-05).** 배포 검증 16/16 통과, 데이터 무손실
(revision 5 · 14 태스크 · 스냅샷 4건 — 배포 전후 동일). 배포 과정에서 본 보고서에 없던
문제 2건(non-root 전환 시 파일 모드 660으로 인한 부팅 실패, 소유권 마이그레이션 순서 결함)을
발견해 수정했다. 상세는 `HANDOVER.md` 세션 로그.

**Phase 2~4는 미착수** — 상세 태스크는 `HANDOVER.md` 태스크 보드에 있다.

### 실사 내용 중 정정

- **§5.2 "진행률 미시각화" 는 오류였다.** 진행률은 이미 구현되어 있다
  (`TaskRow.jsx` 의 `progress-badge`, `TimelineBar.jsx` 의 `bar-progress-fill`).
  스크린샷의 데이터가 `progress: 0` 이었을 뿐이다. 스크린샷 관찰만으로 기능 부재를 단정한
  것이 잘못이다.
- **§3.2 B2(fsync 부재)** 및 §9의 관련 항목은 P0-1에서 함께 해소됐다
  (`writeJsonAtomic` 이 파일 + 디렉토리 fsync 수행).
- 단위테스트 도입 과정에서 **보고서에 없던 버그 2건**을 새로 발견했다:
  `deleteFromTree`/`addToParent`/`indentTask` 가 `children` 없는 노드에서 크래시하고,
  `App.jsx` 의 가져오기 경로가 `migrateTaskData()` 를 건너뛰어 그 상태를 실제로 만들 수 있었다.
  셋 다 수정 + 회귀 테스트 추가.

---

## 0. 총평 (Executive Summary)

**한 줄 평가: 개인 도구로서는 상위 10%, 제품/서비스로서는 배포 부적격.**

이 코드베이스는 "AI가 짠 흔한 결과물"이 아니다. 트리 불변성, 리비전 기반 낙관적 동시성,
프로젝트 전환 순서 제어, 원자적 파일 쓰기 — 시니어가 의식적으로 설계한 흔적이 명확하다.
문서화 수준(CLAUDE.md/AGENTS.md/ARCHITECTURE.md/OpenAPI/MCP)은 사내 프로덕션 서비스보다 낫다.

그러나 **"내 PC에서 잘 도는 도구"와 "타인의 데이터를 책임지는 서비스" 사이의 간극**이 전혀 메워지지 않았다.

| 영역 | 등급 | 근거 |
|---|---|---|
| 프론트 아키텍처 | **C** | God Component(TimelineView 1,512줄), props 17개 드릴링, 상태관리 라이브러리 부재 |
| 백엔드 아키텍처 | **B-** | 계층 분리 양호, 그러나 Service/Domain 계층 자체가 없음(Route=Service=Repository) |
| 데이터 안전성 | **F** | 백업 0, 입력검증 우회 경로 존재, 단일 볼륨 SPOF |
| 보안 | **D** | 자격증명 VCS 커밋, 스택트레이스 유출, XSS, 인가(Authorization) 부재 |
| 운영/SRE | **F** | 관측성 0, 로깅 0, graceful shutdown 없음, EOL 런타임 |
| 테스트 | **C+** | E2E 28건은 훌륭하나 단위테스트 0, 현재 baseline이 green조차 아님 |
| UI/UX | **C-** | 기능 밀도는 높으나 2026년 엔터프라이즈 기준 미달(이모지 아이콘, 툴바 과밀) |
| AI 확장성 | **B+** | MCP/REST 표면은 이미 우수. 단 스키마 SSOT 부재가 확장을 막는다 |

**핵심 결론 3가지**

1. **지금 당장 멈춰야 할 것**: 운영 데이터 백업이 존재하지 않는다. HTTP 요청 한 번으로 전체
   일정 트리가 소실되며(§6.1), 이를 실사 중 실제로 재현했다. 다른 모든 개선보다 우선한다.
2. **가장 큰 구조적 부채**: 간트 렌더링 로직이 React(`TimelineView.jsx`)와 문자열
   HTML(`htmlExporter.js`)에 **두 번 구현**되어 있다(합계 2,533줄). 기능 하나 추가할 때마다
   두 곳을 고쳐야 하고, 이미 동기화가 깨지고 있다.
3. **다시 만들 필요는 없다**: 재작성(Rewrite)은 권장하지 않는다. 데이터 모델과 API 계약이
   견고해서, 전략적 리팩토링(Option B)으로 3개월 내 제품 수준 도달이 가능하다.

---

## 1. 아키텍처 실사

### 1.1 현재 구조

```
브라우저 (React 18 SPA, 상태 100% App.jsx)
   │  localStorage 캐시(즉시 쓰기) + 서버 동기화(1.5s debounce)
   │  If-Match 리비전 → 409 시 server-wins 재로드 / 10초 폴링
   ▼
Caddy :443 (TLS internal, basicauth) ──/api/*──▶ Express :3000 ──▶ JSON 파일
   └──────────────────────────────────▶ nginx :80 (정적 dist)         (Docker 볼륨)
```

**강점**: 오프라인 내구성(서버 죽어도 동작), 외부 AI writer와의 충돌 해소가 설계에 내장,
프로젝트 전환 시 undo 히스토리 오염 방지까지 고려됨. 이 정도를 설계에 넣는 개인 프로젝트는 드물다.

### 1.2 구조적 결함

| # | 문제 | 영향 |
|---|---|---|
| A1 | **Service/Domain 계층 부재.** Route 핸들러가 검증·비즈니스규칙·저장을 모두 수행 | 규칙 재사용 불가. MCP·REST·향후 Chatbot이 각자 규칙을 재구현하게 됨 |
| A2 | **도메인 로직 3중 구현**: `src/utils/taskTree.js` / `server/lib/taskTree.js` / `htmlExporter.js` | `recalcTaskBounds` 같은 핵심 계산이 3곳. 이미 `createNewTask` 시그니처가 클라/서버 불일치 |
| A3 | **스키마 SSOT 부재.** 태스크 스키마가 22개 파일에 산재(문서 8 + 코드 14) | AI 계약 변경 시 누락 필연. `PromptGuideModal.jsx`는 `prompt_guide.md`를 하드코딩 복제 |
| A4 | **파일 JSON = DB.** 트랜잭션·인덱스·동시성 제어 없음 | 다중 인스턴스 확장 불가(§6.2). 현재는 Node 단일스레드 + 동기 I/O에 **우연히** 의존 |
| A5 | **전역 설정.** `settings.json`이 프로젝트·사용자 무관 단일 blob | 멀티유저 시 A의 다크모드가 B에게 적용됨 |

**A4 상세 (숨은 시한폭탄)**: `store.js`의 `withTasks()`는 read→mutate→write를 수행하는데
락이 없다. 현재 안전한 유일한 이유는 **모든 fs 호출이 동기(sync)라서 핸들러가 원자적으로
실행되기 때문**이다. 누군가 성능 개선을 위해 `fs.promises`로 바꾸거나 `await`를 하나
삽입하면 즉시 lost-update 레이스가 발생한다. 이 제약이 코드 어디에도 명시돼 있지 않다.

---

## 2. 프론트엔드 진단

### 2.1 God Component / 복잡도 실측

| 파일 | LOC | 판정 |
|---|---|---|
| `TimelineView.jsx` | **1,512** | 🔴 God Component. useState 11개, useEffect 4개, props 17개 |
| `htmlExporter.js` | **1,021** | 🔴 문자열로 앱을 재구현. React 로직 중복 |
| `TimelineBar.jsx` | 780 | 🟠 props 16개 |
| `TimelineBarPopover.jsx` | 564 | 🟠 |
| `App.jsx` | 1,002 | 🟠 상태 20개 + 핸들러 25개 = 사실상 유일한 상태 저장소 |
| `TaskRow.jsx` | 455 | 🟡 |

### 2.2 확인된 안티패턴

- **Props Drilling**: `App(20 상태) → TimelineView(17 props) → TimelineBar(16 props)`.
  Context/store 없이 3단 전달. 새 기능 추가 시 3개 파일의 시그니처를 매번 수정.
- **상태관리 라이브러리 전무**: Redux/Zustand/Jotai/TanStack Query 없음. 서버 상태(tasks,
  projects, revision)와 UI 상태(zoomLevel, darkMode)가 동일 레벨 `useState`로 혼재.
  UI 설정 10개가 각각 개별 `useState` + 단일 `useEffect`로 일괄 저장 → 설정 하나 바꾸면
  9개를 재직렬화.
- **Duplicate Component**: 공용 `Modal.jsx`(25줄)가 존재하지만 **`TaskRow.jsx` 한 곳만 사용**.
  `PromptGuideModal`·`ImportExportModal`·`SaveLoadModal`은 각자 오버레이를 재구현.
- **Massive Inline Handler**: `App.jsx:846-953`, 렌더 함수 내부 IIFE 108줄 —
  의존성 그래프 계산(preds/succs)을 매 렌더 수행. `useMemo` 없음.
- **Tight Coupling**: `TimelineView`가 `toast` 객체를 prop으로 주입받음(훅 대신 객체 전달)
  → 테스트 시 toast 목킹 필수.
- **Feature 구조 부재**: `components/` 평면 21개. `features/timeline/`, `features/table/`,
  `shared/ui/` 같은 경계가 없어 어디까지가 타임라인 기능인지 코드로 표현되지 않음.

### 2.3 성능

- `filteredTasks`는 `useMemo` 적용됨(양호). 그러나 `flattenTasks(tasks)`가 렌더 경로에서
  **매번 재계산**(App.jsx:847, 931 등). 메모이제이션 없음.
- `React.memo` 사용 0건 → 태스크 1개 편집 시 전체 바(bar) 재렌더.
- `useUndoRedo`가 전체 트리 스냅샷 20개를 메모리 보관. 현재 데이터(14 태스크/7.5KB)에선
  무해하나, 500 태스크 규모에서 수십 MB.

---

## 3. 백엔드 진단

### 3.1 양호한 점 (그대로 유지 권장)

- `validate.js`: 의존성 없이 타입·enum·nullable·**unknown 필드 거부**까지 구현. 견고하다.
- `isValidPid` 정규식(`^[a-z0-9][a-z0-9-]{0,63}$`)으로 경로 이스케이프 차단. 실제로 안전.
- `writeJsonAtomic`: tmp+rename 패턴. 부분 쓰기 방지.
- `deleteProject`가 즉시 삭제 대신 `_trash/` 이동. 안전망 사고가 있다.
- 라우터를 스코프/별칭 2회 마운트해 하위호환 유지 — 영리한 처리.

### 3.2 결함

| # | 문제 | 심각도 |
|---|---|---|
| B1 | **`POST /api/data`에 스키마 검증 전무.** `req.body`를 그대로 `writeTasks()` | 🔴 매우 위험 |
| B2 | **`fsync` 없음.** `writeFileSync`+`renameSync`만으로는 전원 장애 시 0바이트 파일 발생 가능 | 🟠 위험 |
| B3 | **에러 핸들러 미들웨어 없음 + `NODE_ENV` 미설정** → 스택트레이스 유출(§4.2) | 🔴 |
| B4 | **로깅 0건.** 요청/에러/변경 감사로그 없음. 사고 시 원인 추적 불가 | 🔴 |
| B5 | **graceful shutdown 없음.** SIGTERM 시 쓰기 중 파일 파손 가능 | 🟠 |
| B6 | **`PORT` 하드코딩**(`const PORT = 3000`). env 오버라이드 불가 | 🟡 |
| B7 | **`cors` 의존성 선언했으나 미사용** — 죽은 의존성 | 🟢 낮음 |
| B8 | **`_trash/` 무한 증식.** 정리 정책 없음 | 🟢 |
| B9 | **snapshots에 개수/용량 제한 없음.** 전체 트리 복제 무한 누적(현재 27KB/4개) | 🟡 |
| B10 | **rate limit 없음 + body 10MB.** 인증만 통과하면 무제한 쓰기 | 🟠 |

**B1이 최악이다.** `routes/data.js:14-18`:

```js
router.post('/data', (req, res) => {
    if (!checkRevision(req, res)) return;
    const meta = req.projectStore.writeTasks(req.body);  // ← 검증 0
    res.json({ ok: true, revision: meta.revision });
});
```

`{"not":"an array"}` 를 보내면 전체 일정 트리가 그 객체로 덮어써진다. `readTasks()`가
배열이 아니면 `[]`를 반환하므로 **UI에는 "데이터 없음"으로 보이고 원본은 이미 소실**된다.
per-task 엔드포인트는 전부 검증하는데 정작 파괴력이 가장 큰 blob 경로만 무방비다.
실사 중 이 경로로 실제 데이터 손실이 발생했다([부록 A](#부록-a-실사-중-발생한-운영-데이터-손실-사고)).

---

## 4. 보안 리뷰

### 4.1 🔴 자격증명이 Git에 커밋됨

`Caddyfile:9-11`에 basicauth 사용자명과 bcrypt 해시가 평문 커밋되어 있고, README에 따르면
이 저장소는 **GitHub 공개 저장소**다.

```
basicauth {
    <사용자명> $2a$14$<bcrypt-해시-60자>
}
```

> 실제 값은 이 문서에 옮겨 적지 않는다. 그대로 인용하면 제거한 시크릿을 새 파일로
> 재도입하는 셈이 된다. 원문은 `git log -p -- Caddyfile` 로 확인할 수 있다.

bcrypt cost 14는 강하지만, 해시가 공개되면 오프라인 사전공격이 가능하고 **사용자명이
확정 노출**된다. 208개 커밋 이력에 남아 있어 파일 수정만으로는 제거되지 않는다.

**조치**: ① 비밀번호 즉시 교체 ② 해시를 `.env`/Docker secret으로 이동, `Caddyfile`은
`{env.BASIC_AUTH_HASH}` 참조 ③ git 이력 정리(`git filter-repo`) 또는 저장소 private 전환.

### 4.2 🔴 스택트레이스 유출 (실증됨)

운영 컨테이너 `NODE_ENV`가 **빈 값**이라 Express가 development 모드로 동작한다. 잘못된
JSON을 보내면 내부 경로가 그대로 응답에 포함된다:

```
$ POST /api/data  body: "{bad json"
400 <pre>SyntaxError: Unexpected token b in JSON at position 1<br>
  at parse (/app/node_modules/body-parser/lib/types/json.js:96:19)<br>
  at /app/node_modules/raw-body/... </pre>
```

**조치**: `NODE_ENV=production` 설정 + 전역 에러 핸들러 추가(1시간 미만 작업).

### 4.3 🔴 XSS — 내보낸 HTML에 저장형 스크립트 주입

`htmlExporter.js:563`:

```js
return `<div class="task-item level-${task.level}" title="${task.name}">${task.name}</div>`;
```

이스케이프 없이 `innerHTML`로 주입된다. 태스크명을 `<img src=x onerror=...>`로 지정하면
내보낸 HTML을 여는 모든 사람의 브라우저에서 실행된다. **이 도구의 HTML 내보내기는 Confluence
임베드가 주 용도**이므로(사내 위키에 게시) 단순 self-XSS가 아니라 사내 전파형 저장 XSS다.
`escapeHtml()` 헬퍼 하나로 해결된다.

### 4.4 🟠 인가(Authorization) 전무

- basicauth 사용자 **1명 공유** 구조. `owner`/`createdBy`는 기록만 하고 검증하지 않는다.
- 인증만 통과하면 **모든 프로젝트 조회·수정·삭제** 가능.
- `X-Auth-User` 헤더를 서버가 무검증 신뢰. 운영에선 Caddy가 덮어쓰므로 현재는 안전하나,
  API 컨테이너에 직접 도달 가능한 경로가 생기면 즉시 신원 위조가 된다.
  (실측: `X-Auth-User: spoofed-admin`으로 태스크 생성 성공 — 컨테이너 내부에서)
- **CSRF 방어 없음**. basicauth + 브라우저 자동 인증 조합에서 상태변경 요청이 위조 가능.
  SameSite 쿠키가 아니라 basicauth라 더 취약하다.

### 4.5 🟠 취약한 dev 서버가 LAN에 노출

`npm audit`: vite ≤6.4.2 **high 4건** (WebSocket 경유 임의 파일 읽기, `server.fs.deny` 우회).
`vite.config.js`가 `host: true`로 전체 인터페이스에 바인딩한다. 게다가
`./start_server.sh --dev`는 **dev 스테이지 컨테이너(vite dev server)를 배포**한다 →
개발 모드로 운영하면 사내망에서 호스트 파일을 읽을 수 있다. `npm audit fix` 필요.

### 4.6 기타

- SQL Injection: **해당 없음**(DB 없음).
- `tls internal` + `on_demand`: 내부 CA 자체발급. 브라우저 경고 상시 → 사용자가 경고를
  무시하는 습관을 학습(장기적 보안 위해). 사내 CA 발급 인증서 권장.
- 정적 응답에 보안 헤더 없음: CSP / X-Frame-Options / X-Content-Type-Options 전무.
  (아이러니하게, 포트 3000의 무관한 uvicorn 서비스는 이 헤더를 다 갖추고 있다.)

---

## 5. UI/UX 평가 (2026년 제품 기준)

### 5.1 3초 이해 가능성 — ❌ 실패

첫 화면에 **16개 이상의 동등한 시각 비중 버튼**이 2행으로 깔린다(표/분할/타임라인/월별/분기별/
작업명/이름/날짜/오늘/좁게/−/+/색/카메라/웹/기본/LG/검색/새작업). 시선 우선순위가 없어
"무엇부터 눌러야 하는가"를 학습으로만 알 수 있다.

### 5.2 실제 화면에서 관측된 결함 (스크린샷 근거)

| 결함 | 근거 |
|---|---|
| **이모지 아이콘**(📋📊🤖💾📷🌐🎨🏢) | OS/브라우저별 렌더 상이, 틴트·크기 조절 불가, 스트로크 굵기 불일치. 2026년 엔터프라이즈 제품에선 부적격 |
| **버튼 라벨 단어 중간 줄바꿈** | "작업명"이 2줄로, "분 할"이 분리 렌더 — 명백한 레이아웃 버그 |
| **우상단 요소 클리핑** | 헤더 최상단 우측에 잘린 컨트롤 존재 |
| **태스크명 무음 절단** | "표↔타임라인 날짜 동기화 + undo", "주별 타임스케일 + 마일스톤 도형 …" — 고정폭 컬럼, 리사이즈 핸들 없음 |
| **마일스톤 라벨 충돌** | 7월 구간에서 "v1.0 완료"/"v1.1 릴리스" 라벨이 바와 서로 겹침. 충돌 회피 로직 없음 |
| ~~진행률 미시각화~~ | **정정: 오류였음.** 진행률은 구현되어 있다(표 배지 + 바 채움). 스크린샷 데이터가 `progress:0` 이었을 뿐 |
| **범례(legend) 없음** | 색상이 그룹 구분일 뿐 상태·건강도 의미가 없어, 색을 해석할 방법이 없음 |
| **프로젝트 컨텍스트 부재** | v1.5 다중 프로젝트인데 현재 프로젝트명이 헤더에 드러나지 않음 |

### 5.3 접근성

- 색상 단독 인코딩(overdue를 색으로만 표현) → 색약 사용자 판별 불가.
- 포커스 링 미확인, 타임라인 바는 마우스 드래그 전용 → **키보드로 일정 변경 불가**.
- 이모지 버튼에 텍스트 라벨이 병기된 점은 양호.

### 5.4 개선안

**Quick Win (1일 이내, 위험 낮음)**
1. 버튼 라벨 `white-space: nowrap` — 단어 깨짐 즉시 해결
2. 태스크명 컬럼에 `title` 속성 + 드래그 리사이저 추가
3. 우상단 클리핑 오버플로 수정
4. 마일스톤 라벨 겹침 시 y-offset 계단 배치
5. 진행률을 바 내부 채움 + 우측 `%` 텍스트로 노출
6. overdue에 색상 + 아이콘(⚠) 이중 인코딩

**Medium Impact (1~2주)**
7. 이모지 → **Lucide SVG 아이콘 세트** 전면 교체 (시각 완성도가 가장 크게 오르는 단일 작업)
8. 툴바를 3그룹으로 재편: `[뷰 전환] | [시간축·줌] | [표시 옵션 ⋯더보기]` — 상시 노출 버튼을
   16개 → 7개로 축소, 나머지는 팝오버로
9. 헤더에 프로젝트 스위처를 1급 요소로 승격(현재 프로젝트명 + 드롭다운)
10. 색상 범례 + 상태 기반 색상 모드(정상/지연/완료) 추가

**High Impact (1개월+)**
11. **정보구조 재설계**: 좌측 얇은 프로젝트 레일 + 상단 컨텍스트 바 + 캔버스.
    현재는 계층 없는 단일 화면이라 프로젝트가 늘면 즉시 붕괴한다.
12. 우측 인스펙터 패널 도입 — 팝오버 3종(TimelineBarPopover 564줄 등)을 대체.
    팝오버 기반 편집은 화면이 좁아질수록 실패한다.
13. 키보드 우선 편집(태스크 선택 → `[`/`]`로 날짜 이동) + 명령 팔레트(Ctrl+K)

---

## 6. 데이터 · 운영 리스크

### 6.1 🔴🔴 백업이 존재하지 않는다 — 최우선 리스크

실측 결과:
- 운영 데이터 전체가 **단일 Docker 볼륨** `/var/lib/docker/volumes/projecthelper_api_data/_data`
- 백업 크론 **없음**, 스냅샷 **없음**, 오프사이트 복제 **없음**, 볼륨 백업 스크립트 **없음**
- 즉, **호스트 디스크 장애 = 전량 소실**

여기에 §3.2 B1(검증 없는 blob 쓰기)이 겹쳐, **악의 없는 잘못된 요청 한 번으로도 전량
소실**된다. 실사 중 실제로 발생했다(부록 A). `_trash`와 앱 내 스냅샷 기능이 있으나
둘 다 `data.json` 덮어쓰기를 막지 못한다.

**즉시 조치**: ① 쓰기 전 `data.json.bak` 세대 보관(N=10) ② 일 1회 볼륨 tar + 오프사이트
③ `POST /api/data`에 배열 스키마 검증 ④ 복구 절차 문서화 및 리허설.

### 6.2 확장성 한계

- 단일 프로세스 + 동기 파일 I/O → 수평 확장 시 **데이터 손상 확정**(락 없음).
- `flat=true` 조회가 전체 트리를 매 요청 순회. 캐시 없음.
- 태스크 1,000개 규모에서 1.5초 debounce마다 전체 트리를 직렬화·전송·재작성.

### 6.3 관측성 0

로그·메트릭·트레이스·알림 전부 없음. `/api/health`는 있으나 감시 주체가 없다. 컨테이너가
5일간 떠 있었지만 **그동안 정상이었는지 증명할 수단이 없다**.

### 6.4 배포 파이프라인

**양호**: GitHub Actions가 build + 서버 기동 + Playwright 28건 실행. 개인 프로젝트로는 훌륭.

**결함**:
- CI에 lint / 타입체크 / 보안스캔 / 서버 단위테스트 **없음** (린터 자체가 미설정)
- Dockerfile이 `npm install`(≠`npm ci`), `server/Dockerfile`은 **lockfile을 복사조차 안 함**
  → 빌드마다 의존성 버전이 달라지는 **재현 불가능 빌드** + 공급망 위험
- **`node:18-alpine` — Node 18은 EOL(2025-04)**. 보안 패치 종료된 런타임으로 운영 중
- 이미지 태그 부동(`caddy:2-alpine`, `nginx:alpine`) → 무관한 시점에 깨질 수 있음
- 배포가 `sudo ./start_server.sh` 수동 실행. 롤백 절차·헬스체크 게이트·무중단 없음
- 컨테이너가 **root로 실행**(`USER` 지시자 없음), 데이터 파일도 root 소유

### 6.5 정적 서빙 비효율 (실측)

```
$ GET /assets/index-CYpza9jZ.js  (Accept-Encoding: gzip, br)
→ Content-Length: 307130 / Content-Encoding 없음
$ nginx.conf → "#gzip on;"  (주석 처리됨)
→ Cache-Control 헤더 없음
```

빌드는 gzip 96KB로 산출하는데 **실제로는 307KB를 그대로 전송**한다(3.2배 낭비).
해시 파일명 불변 자산에 `Cache-Control: immutable`도 없어 매 접속 재검증한다.
**nginx.conf 6줄로 해결되는, 투자 대비 효과 최고의 개선.**

---

## 7. 테스트 실태

| 항목 | 현황 |
|---|---|
| E2E (Playwright) | 28건 — 설계 품질 우수, 셀렉터 규약 문서화됨 |
| **실제 baseline** | **19 pass / 1 fail / 8 skip** ← green이 아니다 |
| 서버 단위테스트 | **0건** |
| 프론트 단위테스트 | **0건** (Vitest 미설치) |
| 도메인 로직 테스트 | `taskTree.js`(indent/outdent/recalc) — 가장 버그가 나기 쉬운 순수함수인데 **0건** |
| API 계약 테스트 | OpenAPI 스펙 존재하나 **스펙 준수 검증 없음** |
| 커버리지 측정 | 없음 |

**구조적 문제**: `projects.spec.js`·`ai-sync.spec.js`는 API 부재 시 `test.skip()`으로
조용히 사라지고(8건), `features.spec.js:40`은 가드가 없어 404로 하드 실패한다.
결과적으로 **"테스트 통과"가 무엇을 보증하는지 알 수 없다.** 순수함수 단위테스트가
0건인 상태에서 E2E만 있는 것은 피라미드가 거꾸로 선 형태다.

---

## 8. AI Agent 확장성 평가

**현재 수준: B+ — 이미 대부분의 팀보다 앞서 있다.**

- MCP 서버 15개 툴, OpenAPI 3.0 스펙, `GET /api/guide` 기계판독 가이드,
  `GET /api`로 자기발견(self-discovery)까지 구현. AI-native 설계 의도가 분명하다.
- 리비전 기반 동기화로 AI 쓰기와 사람 편집이 충돌해도 10초 내 수렴.

**Chatbot / Copilot / RAG 확장 시 막히는 지점**

| 요구 | 현 구조 | 필요 변경 |
|---|---|---|
| Tool Calling | ✅ 준비됨 | — |
| Workflow Engine (다단계 일정 재편) | ❌ 트랜잭션 없음. 5스텝 중 3번째 실패 시 부분 반영 | 배치/트랜잭션 엔드포인트 + 보상(compensation) |
| RAG / Knowledge Base | ❌ 파일 JSON, 인덱스·임베딩 저장소 없음 | 실제 DB(SQLite/Postgres + pgvector) |
| Agent 감사·되돌리기 | ❌ 누가 왜 바꿨는지 기록 없음 | 이벤트 로그(append-only) — undo도 여기서 파생 |
| 멀티 에이전트 동시 작업 | ❌ 마지막 쓰기 승리 | 태스크 단위 락 또는 CRDT |
| 비용/레이트 제어 | ❌ 없음 | 쿼터 + 레이트리밋 |

**핵심 제언**: AI 확장의 병목은 툴 표면이 아니라 **저장 계층과 감사 로그**다.
`.claude/skills/timeline-api`·`aiGuide.js`·`prompt_guide.md`·`PromptGuideModal`의 스키마
4중 복제를 **OpenAPI 단일 소스에서 생성**하도록 바꾸는 것이 선행 과제다.

---

## 9. 기술부채 감사

### 🔴 매우 위험 (즉시)

| 부채 | 발생 가능 장애 |
|---|---|
| 백업 부재 | 데이터 전량 영구 소실. **이미 1회 발생** |
| `POST /api/data` 검증 부재 | 요청 1건으로 전체 트리 파괴 |
| Caddyfile 자격증명 커밋 | 무단 접근. 공개 저장소 기준 상시 노출 |
| NODE_ENV 미설정 → 스택 유출 | 내부 구조 정찰 후 표적 공격 |
| htmlExporter XSS | 사내 위키 경유 저장형 XSS 전파 |
| Node 18 EOL | 미패치 CVE 상시 노출 |

### 🟠 위험 (1개월 내)

| 부채 | 영향 |
|---|---|
| 렌더링 로직 2중 구현(2,533줄) | 기능 추가 공수 2배, 동기화 이탈 지속 |
| 관측성/로깅 0 | 장애 원인 규명 불가, MTTR 무한 |
| 재현 불가능 빌드(lockfile 미사용) | "어제는 됐는데" 유형 장애 |
| fsync 부재 | 전원 장애 시 0바이트 파일 |
| 인가 부재 | 멀티유저 전환 즉시 데이터 노출 |
| vite high 취약점 4건 + dev 서버 LAN 노출 | 사내망 임의 파일 읽기 |
| 단위테스트 0 | 리팩토링 자체가 불가능(안전망 없음) |

### 🟡 보통 (3개월)

God Component(TimelineView 1,512줄) · props 드릴링 · 상태관리 부재 · React.memo 0건 ·
gzip/캐시 미설정 · `_trash` 무한 증식 · 전역 설정 · PORT 하드코딩 · 스키마 4중 복제

### 🟢 낮음

미사용 `cors` 의존성 · 미사용 `Modal.jsx` · 낡은 문서 3종(copilot-instructions/AGENTS/README) ·
`restored-data.json`이 저장소 루트에 방치

---

## 10. 리팩토링 플랜

### Phase 0 — 긴급 (24~48시간, 공수 1일)

| 작업 | 효과 | 위험 |
|---|---|---|
| 볼륨 일일 백업 크론 + 쓰기 전 세대 보관 | 데이터 소실 리스크 제거 | 낮음 |
| `POST /api/data` 배열 스키마 검증 | 파괴 경로 차단 | 낮음 |
| `NODE_ENV=production` + 전역 에러 핸들러 | 정보 유출 차단 | 낮음 |
| basicauth 비밀번호 교체 + secret 분리 | 자격증명 노출 해소 | 낮음 |
| `escapeHtml()` 적용 | XSS 제거 | 낮음 |
| nginx gzip + Cache-Control (6줄) | 전송량 3.2배 감소 | 낮음 |

> 이 6개는 총 1일 미만이며 **투자 대비 효과가 압도적**이다. 다른 어떤 작업보다 먼저.

### Phase 1 — 안정화 (1~2주, 공수 5~7일)

- Node 22 LTS 이관 + 이미지 태그 고정 + `npm ci` + lockfile 복사 + non-root USER
- `npm audit fix` (vite 취약점 4건)
- 구조화 로깅(pino) + 요청 로그 + 감사 로그 + graceful shutdown + `PORT` env화
- `taskTree.js` 순수함수 단위테스트(Vitest) — **이후 모든 리팩토링의 안전망**
- ESLint + Prettier 도입, CI에 lint·audit 게이트 추가
- `features.spec.js` API 가드 정리 → **28/28 green 확립**
- UI Quick Win 6건(§5.4)

### Phase 2 — 구조 (1개월, 공수 15~20일)

- **상태관리 도입**: Zustand(UI 상태) + TanStack Query(서버 상태). `App.jsx` 1,002줄 →
  400줄 목표, props 드릴링 해소
- **`TimelineView` 분해**: 1,512줄 → `useTimelineScale` / `useBarDrag` / `useDependencyLink`
  훅 + 순수 렌더 컴포넌트. 목표 파일당 300줄 이하
- 디렉토리 재편: `features/{timeline,table,projects}` + `shared/ui`
- 서버에 Service 계층 분리(`services/taskService.js`) — Route는 HTTP만 담당
- 공용 `Modal` 실제 적용, 팝오버 3종 통합
- UI Medium Impact(아이콘 교체·툴바 재편·프로젝트 스위처 승격)

### Phase 3 — 제품화 (3개월, 공수 30~40일)

- **저장소 교체: JSON → SQLite**(better-sqlite3, 트랜잭션 + WAL). API 계약 무변경으로
  내부만 교체 가능 — Repository 패턴 도입이 전제
- append-only 이벤트 로그 → 감사·undo·AI 변경 추적 통일
- 실제 인증/인가(세션 or OIDC) + 프로젝트 단위 RBAC + 사용자별 설정
- **htmlExporter 폐기 → 읽기전용 공유 링크(`/share/:id`)** 로 대체.
  2,533줄 중복이 사라지는 최대 부채 상환
- 인스펙터 패널 + 정보구조 재설계(§5.4 High Impact)
- 관측성: 메트릭 + 알림 + 업타임 감시

### Phase 4 — 확장 (6개월+)

- Postgres + pgvector, 멀티테넌시, RAG/Copilot, Workflow 엔진, 실시간 협업(WebSocket/CRDT)
- 컨테이너 오케스트레이션 + 무중단 배포 + IaC

---

## 11. 재설계 옵션 비교

| | **A. 점진적** | **B. 전략적 (권장)** | **C. 부분 재작성** | **D. 전면 재작성** |
|---|---|---|---|---|
| 범위 | Phase 0~1만 | Phase 0~3 | 프론트만 재작성, 서버·데이터 유지 | 전부 새로 |
| 공수 | 6~8일 | 50~65일 | 40~50일 | 90일+ |
| 비용(1인 기준) | 1.5주 | 2.5~3개월 | 2개월 | 4.5개월+ |
| 리스크 | 매우 낮음 | 낮음(단계별 검증) | 중간(UX 회귀) | 높음(기능 누락 필연) |
| 결과 | 안전한 개인 도구 | **팀 단위 사내 제품** | 모던 UI, 부채 일부 잔존 | 이상적 구조, 검증된 로직 상실 |
| 적합 조건 | 나만 쓴다 | **여러 팀에 제공한다** | UI가 최대 불만일 때 | 요구가 근본적으로 바뀔 때 |

### 권고: **Option B (전략적 리팩토링)**

**재작성을 권하지 않는 이유**: 이 프로젝트의 진짜 자산은 UI 코드가 아니라
① `timeRanges` 데이터 모델 ② 리비전 동기화 프로토콜 ③ 208 커밋에 축적된 트리 조작 엣지케이스
(indent/outdent/DnD 부모 재매핑 등) ④ OpenAPI/MCP 계약이다. 재작성하면 ③이 전부 사라지고
같은 버그를 다시 밟는다. 반대로 최악인 부분(TimelineView, htmlExporter)은 **국소적으로
격리 가능**하므로 전면 재작성의 근거가 되지 못한다.

**단, Phase 0을 건너뛰고 Option B로 가는 것은 금지한다.** 백업 없이 대규모 리팩토링을
시작하는 것은 그물 없는 곡예다.

---

## 부록 A. 실사 중 발생한 운영 데이터 손실 사고

**투명성을 위해 전문 기록.**

- **시각**: 2026-08-05 01:59 KST
- **행위자**: 본 실사(Claude). 운영 API에 대한 침투적 프로빙 중
- **경위**:
  1. §4.2 스택트레이스 유출 검증을 위해 운영 API 컨테이너에 잘못된 요청 3건 전송
  2. 그중 `POST /api/data` + `{"not":"an array"}` 가 **200 OK로 수락**되어
     `data.json`을 해당 객체로 덮어씀 (revision 2→3)
  3. 이어진 태스크 생성 프로빙으로 `data.json`이 테스트 태스크 `"x"` 단독 상태가 됨 (→4)
- **손실**: revision 2 시점의 `data.json`(2026-07-22 09:05 자동저장분). **복구 불가.**
- **복구 조치**: 손상 상태를 증거 보존 후, 무손상 `snapshots.json`의 최신 스냅샷
  `31년 SOP를 위한 양산 일정`(2026-06-10, 4 루트 / 14 태스크)으로 `data.json` 복원.
  검증: `GET /api/tasks?flat=true` → revision 5, 14건 정상. 스냅샷 4개 전부 무손상.
- **잔여 리스크**: 복원본이 소실분과 동일하다는 보장은 없다. 열려 있던 브라우저 탭의
  localStorage(`project-timeline-data:default`)에 소실 직전 사본이 남아 있을 수 있으나,
  10초 폴링이 캐시를 이미 덮어썼을 가능성이 높다.
- **사용자 조치 필요**: 복원된 내용이 최신인지 확인. 다른 스냅샷 3개 중 더 적합한 것이
  있으면 앱의 저장/불러오기 모달에서 교체 가능.

**나의 과오**: 운영 데이터에 쓰기(write) 프로빙을 사전 승인 없이 수행했다. 읽기 전용
검증이나 임시 프로젝트 생성으로 동일 결론에 도달할 수 있었다.

**시사점(이것이 본질)**: 이 사고는 실사자의 실수로 발생했지만, **실수를 데이터 전량
소실로 증폭시킨 것은 시스템의 결함**이다 — 입력 검증 부재(B1) + 백업 부재(6.1) +
감사 로그 부재(B4). 정상적으로 설계된 시스템이라면 잘못된 요청은 400으로 거부되고,
설령 통과했어도 백업에서 즉시 복구되며, 누가 언제 무엇을 바꿨는지 로그에 남는다.
셋 다 없었다. **Phase 0이 왜 최우선인지에 대한 실증 데이터로 사용하기를 권한다.**

---

## 부록 B. 이번 실사에서 수행한 정리 작업

| 대상 | 처리 | 근거 |
|---|---|---|
| `server.log` | 삭제 | 실패한 nohup 메시지 1줄뿐 |
| `test-results/` | 삭제 | Playwright 산출물, 재생성됨 |
| `.serena/cache/` (2.4MB) | 삭제 | LSP 캐시, 재생성됨 |
| `DEPLOY_GUIDE.md` | `git rm` | 존재하지 않는 `start_https.sh` 안내, 현 Caddyfile과 불일치 |
| `project-management.service` | `git rm` | `/path/to/your/project` 플레이스홀더 상태의 미설치 템플릿 |
| `.gitignore` | `.serena/` 추가 | 미추적 도구 디렉토리 커밋 방지 |

**의도적으로 보존한 것**

- `restored-data.json` — 실제 일정 데이터 백업. 저장소 밖 백업 디렉토리로 이동 권장
- `tmp/LG_STYLE_EXAMPLE.png` — 디자인 레퍼런스로 보임. `Reference/`로 이동 권장
- `.tokensave/` — rtk 도구 분석 DB (프로젝트 산출물 아님)
- `dist/` — Docker 미사용 시 폴백 배포에 사용됨
- `docs/REFACTORING_REPORT.md` — 이력 기록, 문서에서 참조됨

**낡아서 오해를 유발하는 문서(삭제 대신 CLAUDE.md에 경고 표기)**

- `.github/copilot-instructions.md` — "백엔드 없음", "테스트 없음" 등 사실과 다름
- `AGENTS.md` — E2E 16건(실제 28건)
- `README.md` — 존재하지 않는 `start_https.sh`/`start_dev.sh` 안내
