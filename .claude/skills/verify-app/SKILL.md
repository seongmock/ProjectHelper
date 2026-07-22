---
name: verify-app
description: >
  ProjectHelper 코드 변경 후 동작 검증 절차. 리팩토링, 기능 추가, 버그 수정 후
  "검증해줘", "테스트 돌려줘", "동작 확인" 요청 시 또는 코드 수정을 마친 뒤
  자발적으로 사용. 빌드 + Playwright 스모크(E2E)를 실행하고 결과를 해석한다.
---

# ProjectHelper 동작 검증

## 표준 검증 시퀀스 (코드 변경 후 필수)

```bash
# 1. 프로덕션 빌드 성공 확인 (문법/import 오류 검출)
npm run build

# 2. E2E 스모크 (vite dev 서버 자동 기동, ~30초)
npx playwright test
```

- `tests/e2e/smoke.spec.js` — 14개 핵심 시나리오: 앱 로드, 작업 CRUD, 인라인 편집,
  계층(하위 작업), undo/redo, 뷰 전환, 검색, 다크모드, 내보내기/가져오기 왕복,
  잘못된 JSON 에러 토스트, 스냅샷/프롬프트 모달
- `tests/e2e/ai-sync.spec.js` — 2개 AI 연동 시나리오: 외부 API 쓰기 → 10초 폴링 반영,
  편집 충돌(409) → 서버 우선 재로드. **API 서버(3000)가 꺼져 있으면 자동 skip**
- `tests/e2e/features.spec.js` — v1.1 기능 6개: 진행률 슬라이더/배지, 지연(overdue)
  표시·해제(API 경유), 표 날짜 편집→타임라인 동기화, 표 마일스톤 기본 날짜,
  드래그 후 Ctrl+Z 1회 복원
- `tests/e2e/projects.spec.js` — 다중 프로젝트 6개: 생성/전환, 격리, 전환 후 undo
  차단(히스토리 리셋), 이름변경 유지, 삭제 가드, AI 생성 프로젝트 전환 확인
  (**API 서버 필요** — 없으면 자동 skip)

전체(16개)를 돌리려면 API 서버를 먼저 켠다: `npm run dev:api &`

## 실패 시 해석

| 증상 | 원인 후보 |
|---|---|
| webServer 기동 실패 `EACCES ... node_modules/.vite` | root 소유 vite 캐시 → `rm -rf node_modules/.vite` |
| ai-sync 테스트 skip | API 서버 미실행 (의도된 동작) |
| 왕복 가져오기 실패 | storage.js importData 검증 ↔ export 형식({meta,data}) 불일치 회귀 |
| 다크모드 캡처 테스트 관련 | App→TimelineView `darkMode` prop 전달 확인 |
| 폴링/충돌 테스트 flaky | 1.5s 디바운스·10s 폴링 타이밍 — timeout 여유 확인 |

## 테스트가 커버하지 않는 것 (필요 시 수동 확인)

- 타임라인 바 드래그(날짜 변경/Ctrl 복사), 의존성 연결선
- 이미지 캡처 클립보드 (HTTPS 전용)
- HTML 내보내기 렌더 결과

## 새 기능 추가 시

smoke.spec.js에 시나리오를 추가하라. 셀렉터 관례:
- 뷰: `.table-view`, `.timeline-view` / 행: `.task-row` (`level-N` 클래스로 깊이)
- 버튼은 `getByRole('button', { name: '...' })` 또는 `getByTitle('...')`
- 토스트: `.toast--success` / `.toast--error`
- 삭제 확인은 `confirm()` → `page.on('dialog', d => d.accept())` 필요
