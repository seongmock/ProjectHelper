# Copilot Instructions

> **이 파일은 요약본이다. 정본은 `CLAUDE.md` 이고, 진행 중인 작업 상태는 `HANDOVER.md` 다.**
> 두 파일을 먼저 읽어라. (이 파일은 과거에 "백엔드 없음 / 테스트 없음" 같은 사실과
> 다른 내용을 담고 있어 2026-08-05에 전면 교체됐다.)

## 이 프로젝트는 무엇인가

React 18 + Vite SPA **+ Express API 서버**(`server/`, JSON 파일 영속화) 구조의
간트차트/타임라인 관리 도구. 클라이언트 전용 앱이 **아니다**.

## 명령어

```bash
npm run dev          # Vite dev 서버 (5173)
npm run dev:api      # Express API (기본 3000; 이 호스트는 3000 점유 → PORT=3100 사용)
npm run build        # 프로덕션 빌드 → dist/
npm run lint         # ESLint
npm run test:unit    # Vitest — 도메인 순수함수 + XSS 회귀
npm run test:server  # node:test — 검증 로직 + 저장소 내구성
npm run test:e2e     # Playwright 31건 (API·dev 서버 자동 기동)
npm run verify       # 위 전부
```

## 절대 지켜야 할 것

1. **운영 API에 쓰기 요청 금지.** 2026-08-05에 이 규칙 부재로 운영 데이터가 소실됐다.
2. **`docker compose down -v` 금지** — `api_data` 볼륨에 운영 데이터가 있다.
3. 트리 조작은 `src/utils/taskTree.js` 순수함수만 사용. **제자리 변경 금지**
   (undo/redo 히스토리가 트리를 공유한다). deep clone 은 `structuredClone`.
4. `src/utils/taskTree.js` 시그니처를 바꾸면 CJS 대응본 `server/lib/taskTree.js` 도 고친다.
5. 사용자 알림은 `toast.success/error/warn/info`. **`alert()` 금지** (ESLint가 막는다).
6. 사용자 데이터를 HTML 문자열에 넣을 때는 반드시 이스케이프한다
   (`htmlExporter.js` 의 `esc()`). 내보낸 HTML은 사내 위키에 임베드된다.

## 데이터 모델

작업(Task)은 재귀 트리(`children[]`). **`timeRanges[]` 가 실제 날짜 데이터**이고
최상위 `startDate`/`endDate` 와 작업 레벨 `dependencies` 는 레거시다.

| 필드 | 설명 |
|---|---|
| `timeRanges[]` | `{ id, startDate, endDate, dependencies[], color, label }` — 주 날짜 데이터 |
| `milestones[]` | `{ id, date, label, color, shape }` |
| `progress` | 0–100 |
| `divider` | `{ enabled, thickness, style, color }` |
| `children[]` | 하위 작업 (재귀) |

- 날짜는 항상 `YYYY-MM-DD` 문자열. `formatDate()` / `dateUtils` 사용.
- ID는 항상 `generateId()`. 작업 생성은 항상 `createNewTask()`.
- `migrateTaskData()` 가 로드 시 정규화한다 — 가져오기 경로에서도 반드시 호출한다.

## 상태 관리

`App.jsx` 가 거의 모든 상태를 보유하고 핸들러를 내려준다(리팩토링 대상 — `HANDOVER.md` P2-1).

- `useUndoRedo(tasks)`: 히스토리 최대 20. 사용자 액션은 `setState`,
  드래그 중간 상태처럼 히스토리를 오염시켜선 안 되는 것은 `setStateSilent`.
- `filteredTasks` 는 `useMemo` **값**이다 — `filteredTasks()` 로 호출하지 마라.

## 스타일

컴포넌트마다 `Foo.jsx` + `Foo.css` 쌍. **바닐라 CSS만** (CSS-in-JS·유틸리티 프레임워크 없음).
다크모드는 `[data-theme="dark"]` 선택자로만 처리한다.
