---
name: verify-app
description: >
  ProjectHelper 코드 변경 후 동작 검증 절차. 리팩토링, 기능 추가, 버그 수정 후
  "검증해줘", "테스트 돌려줘", "동작 확인" 요청 시 또는 코드 수정을 마친 뒤
  자발적으로 사용. lint·단위·서버·빌드·E2E 를 돌리고 결과를 해석한다.
---

# ProjectHelper 동작 검증

## 표준 검증 시퀀스 (코드 변경 후 필수)

```bash
npm run verify           # lint + 단위 591건(+커버리지 게이트) + 서버 267건 + 빌드
                         #   + 번들 예산 + 문서 개수 + E2E 112건
npm run test:e2e:sqlite  # 저장·동기화·프로젝트를 건드렸으면 운영 엔진으로 한 번 더
```

**합격 기준: lint 0 error · 단위 591건 · 서버 267건 · 빌드 성공 · E2E 112건 (skip 0).**
`playwright.config.js` 가 API 서버와 dev 서버를 모두 자동 기동하므로 skip 은 발생하지
않는다 — **skip 1건은 불합격이다.** 그 테스트는 아무것도 검증하지 않았고, 예전에
19/1/8(통과/실패/skip)이 "통과"로 보고된 적이 있다. 개수는
`scripts/test-floors.mjs` 한 곳에 있고 CI 가 실행 개수·문서 표기 양쪽을 그 값과 맞춘다.

부분 실행:

```bash
npx vitest run tests/unit/taskTree.test.js     # 단위 한 파일
node --test server/test/validate.test.js       # 서버 한 파일
npx playwright test tests/e2e/features.spec.js # E2E 한 파일
npx playwright test -g "마일스톤"              # 제목 부분일치
npx playwright test --headed --debug           # 눈으로 보며 단계 실행
```

## E2E 스펙이 각각 무엇을 지키는가

| 파일 | 지키는 것 |
|---|---|
| `smoke.spec.js` | 앱 로드, 작업 CRUD·인라인 편집·계층, undo/redo, 뷰 전환, 검색, 다크모드, 내보내기/가져오기 왕복, 잘못된 JSON 토스트 |
| `features.spec.js` | 진행률·지연 표시, 표↔타임라인 날짜 동기화, 마일스톤(라벨 배치·헤드룸·표와 차트의 도형 일치), 의존성 배지·화살표, 캡처 높이 |
| `projects.spec.js` | 프로젝트 생성/전환/격리, 전환 후 undo 차단, 이름변경·삭제 가드, AI 가 만든 프로젝트가 레일에 나타나는지 |
| `ai-sync.spec.js` | 외부(AI) 쓰기 → 10초 폴링 반영, 편집 충돌(409) → 서버 우선 재로드 |
| `auth.spec.js` | 계정이 없으면 open 모드, 첫 관리자 생성 후 enforced, 401 이 오프라인과 구분되는지 |
| `overlay-audit.spec.js` | 메뉴가 불투명·화면 안·클릭 가능한지, 라벨/툴팁이 잘리지 않는지 |
| `export-html.spec.js` | 내보낸 HTML 을 **실제로 렌더해** 선·화살표·배지·도형이 그려지는지 |

개수를 파일별로 적지 않는 것은 의도다 — 늘 때마다 낡는다. 총계는 위 한 곳에만 둔다.

## 실패 시 해석

| 증상 | 원인 후보 |
|---|---|
| webServer 기동 실패 `EACCES ... node_modules/.vite` | root 소유 vite 캐시 → `rm -rf node_modules/.vite` |
| 1 failed / 8 skipped 같은 조합 | 3101·5173 에 남은 유령 서버 → `lsof -i :3101` 로 찾아 kill (`pkill` 은 과하다) |
| `PH_STORE=sqlite` 에서만 실패 | 저장 엔진 분기 — `lib/sqliteStore.js` 와 JSON store 의 동작 차이. 미러 테스트(`server/test/sqliteStore.test.js`)부터 본다 |
| 번들 예산 실패 | 엔트리 청크가 500kB 를 넘거나 html2canvas 가 엔트리에 섞였다 (`import()` 유지 확인) |
| 문서 개수 게이트 실패 | 테스트를 늘렸으면 `scripts/test-floors.mjs` 와 문서를 함께 올린다 |
| 왕복 가져오기 실패 | storage.js importData 검증 ↔ export 형식(`{meta,data}`) 불일치 회귀 |
| 폴링/충돌 테스트 flaky | 1.5s 디바운스·10s 폴링 타이밍 — timeout 여유 확인 |

## 테스트가 커버하지 않는 것 (필요 시 수동 확인)

- 타임라인 바 드래그(날짜 변경 / Ctrl 복사)
- 이미지 캡처 클립보드 (HTTPS 전용 — 캡처 **높이**는 단위·E2E 가 본다)
- 배포된 컨테이너 안쪽: `npm run verify` 는 호스트 소스만 본다 → `./scripts/verify-deploy.sh`(39건)와
  CI 의 `docker-smoke` 잡이 그 몫이다. 백업이 살아 있는지는 `./scripts/restore-drill.sh`

## 새 기능 추가 시

시나리오를 해당 스펙 파일에 추가하고 `scripts/test-floors.mjs` 의 개수를 올린다. 셀렉터 관례:

- 뷰: `.table-view`, `.timeline-view` / 행: `.task-row` (`level-N` 클래스로 깊이)
- 버튼은 `getByRole('button', { name: '...' })` 또는 `getByTitle('...')`
- 토스트: `.toast--success` / `.toast--error`
- 모달은 `.modal-overlay` 안에 있고, 프로젝트/버전 관리는 `pm-tab-projects` / `pm-tab-versions`
- 삭제 확인은 모달 안의 확인 줄(`pm-confirm`) — `window.confirm` 이 아니다
