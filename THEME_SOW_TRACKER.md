# 작업 지시서: 차트 테마 "SOW Tracker 스타일" 추가

> 이 문서는 ProjectHelper 저장소 안에서 수행할 작업 지시서입니다. 작성일은 2026-10-02이고, SOW Tracker 쪽 세션에서 작성했습니다.
> 목표는 Fujin SOW Tracker(https://10.178.21.120:8794 마일스톤 탭)의 간트와 같은 모양을 ProjectHelper의 **세 번째 차트 테마**로 넣는 것입니다.
> 기존 테마(`default`, `lg`)의 동작은 바꾸지 않습니다.

## 0. 배경

- SOW Tracker는 마일스톤을 이 앱의 프로젝트 **"Fujin SOW 마일스톤 (SOW Tracker 연동)"**에 REST로 밀어 넣습니다.
  - 밀어 넣는 코드: `~/08.Services/sow-tracker/ph.py`
  - 같은 데이터를 트래커는 자기 화면에서 SVG 간트로 직접 그립니다: `~/08.Services/sow-tracker/static/gantt.js`
- 그런데 ProjectHelper에서 그 프로젝트를 열면 모양이 다릅니다. 트래커의 화면 규칙을 이 앱의 테마로 옮겨서 두 화면이 같은 그림을 보여 주게 하려는 것입니다.
- **참고 이미지**
  - `docs/screenshots/sow-theme-ref-gantt.png`: 간트 부분만 잘라 낸 것. 이 그림이 목표입니다.
  - `docs/screenshots/sow-theme-ref-1440.png`, `sow-theme-ref-1920.png`: 마일스톤 탭 전체.
- **원본 코드(같은 서버, 읽기 전용으로 참고)**
  - 렌더러: `~/08.Services/sow-tracker/static/gantt.js`
  - 디자인 토큰과 간트 CSS: `~/08.Services/sow-tracker/index.html` (`<style>`의 `:root` 블록과 `/* ===== gantt ===== */` 절)

## 1. 완료 기준 (Definition of Done)

1. 표시 옵션 메뉴(`DisplayOptionsMenu`)에서 **"SOW Tracker 스타일"**을 고르면 타임라인이 §3 명세대로 그려집니다. `data-chart-theme="sow"` 스코프입니다.
2. 고른 테마는 기존 설정 저장 경로(`settingsStore.chartTheme`)로 저장·복원됩니다.
3. HTML 내보내기(`features/io/htmlExporter.js`)도 `CHART_THEME === 'sow'`일 때 같은 모양으로 나옵니다.
4. 다크 모드를 켜도 이 테마는 밝은 화면으로 그려집니다(`forceLight`). 트래커에는 다크 모드가 없습니다.
5. 나란히 비교했을 때 `docs/screenshots/sow-theme-ref-gantt.png`와 같은 그림입니다. 특히 다음이 일치해야 합니다.
   - 행 줄무늬, 월 격자, 연도 경계선
   - 옅은 막대와 진행률 채움
   - 흰 테두리 다이아몬드와 `yy.mm.dd` 날짜 라벨
   - 점선 "오늘" 선
   - 회색 그룹 막대
6. 회귀가 없습니다.
   - `npm test`(lint + vitest 커버리지 + 서버 테스트 + 빌드 + 번들 예산·문서 수치 검사)와 `npm run test:e2e`(playwright)가 모두 통과합니다. 번들 예산(`scripts/assert-bundle-budget.mjs`)과 문서 수치(`scripts/assert-doc-counts.mjs`) 검사도 포함입니다.
   - `tests/unit/cssTokens.test.js`도 통과해야 합니다. 정의되지 않은 `var()`를 쓰면 실패합니다.
   - `default`·`lg` 테마의 화면은 변화가 0입니다(기존 e2e·스크린샷 기준).
7. 새 테스트를 추가합니다(§5).

## 2. 이 저장소의 테마 구조 (2026-10-02 확인)

| 위치 | 역할 | 비고 |
|---|---|---|
| `src/themes/index.js` | `THEMES` 배열(`id, label, shortLabel, icon, description, barShape, barFill, useTaskColor, showDuration, forceLight`), `getTheme()`, `STATUS_STYLES`, `getStatusColor()` | ⚠ `barShape`·`barFill`·`useTaskColor`·`showDuration`·`forceLight` 필드는 **현재 어디서도 읽지 않습니다**. 실제 분기는 `chartTheme === 'lg'` 하드코딩뿐입니다(`TimelineBar.jsx:514` 부근 `isLg`, `htmlExporter.js:890` 부근) |
| `src/themes/themes.css` | `[data-chart-theme="<id>"]` 스코프 CSS 변수와 규칙 재정의 | `lg` 블록이 예시입니다 |
| `src/features/timeline/TimelineView.jsx` | `data-chart-theme={chartTheme}`를 `.timeline-view`에 붙임(376행 부근). 오늘 마커는 `.today-marker`(461행 부근) | |
| `src/features/timeline/TimelineBar.jsx` | 막대·진행률·마일스톤 렌더. 막대 색 = `statusColor \|\| range.color \|\| task.color`. 진행률 오버레이는 `!isLg && progress > 0` | 마일스톤 도형은 `src/shared/milestoneShapes.js` |
| `src/features/shell/DisplayOptionsMenu.jsx` | `THEMES.map`으로 메뉴를 만듦 | 배열에 추가하면 메뉴에 자동으로 나옵니다 |
| `src/stores/settingsStore.js` | `chartTheme: 'default'`, `colorMode: 'task' \| 'status'` | 전역 설정입니다(프로젝트별 아님) |
| `src/App.css` | 기본·다크 토큰(`--color-*`), `[data-theme="dark"]` | |
| `src/features/io/htmlExporter.js` | 내보내기는 렌더 로직을 다시 구현합니다. `CHART_THEME`로 분기 | 새 테마도 여기에 따로 넣어야 합니다 |

**권장 방식:**
- 하드코딩된 `isLg`를 그대로 두고 `isSow` 분기를 하나 더 붙이는 것보다, 테마 객체의 필드를 실제로 읽게 바꾸는 쪽이 낫습니다.
- 예: `const theme = getTheme(chartTheme); theme.barFill === 'tint'`. 이렇게 하면 다음 테마는 배열 항목만 추가해서 끝납니다.
- 단, `lg` 동작은 그대로 유지해야 합니다.

## 3. 시각 명세 (트래커 `gantt.js` / `index.html`에서 그대로 옮김)

### 3.1 토큰 (`[data-chart-theme="sow"]` 스코프에 정의)

```css
--sow-font: "Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
--sow-n25:#fafafa; --sow-n50:#f5f5f4; --sow-n100:#ebebea; --sow-n200:#dededc; --sow-n300:#c4c4c1;
--sow-n500:#80807c; --sow-n600:#5b5b58; --sow-n900:#1a1a19;
--sow-brand:#A50034; --sow-brand-50:#fbeef2;
--sow-info:#6b8fd6;  /* 예정   */
--sow-warn:#f0b429;  /* 진행   */
--sow-good:#3a9a5b;  /* 완료   */
--sow-crit:#d64545;  /* 지연   */
--sow-none:#9a988f;  /* 취소/없음 */
--sow-row-alt:#fbfaf8; --sow-grid:#efeee9; --sow-grid-year:#d6d4cf; --sow-divider:#e3e2de;
```

이 앱의 기존 변수도 이 스코프에서 다시 매핑합니다(`lg` 블록과 같은 방식).
- 배경: `--color-bg-primary:#fff`, `--color-bg-secondary:var(--sow-n25)`
- 선: `--color-border:var(--sow-n100)`, `--color-grid:var(--sow-grid)`
- 글자: `--color-text-primary:var(--sow-n900)`, `--color-text-secondary:var(--sow-n600)`, `--color-text-muted:var(--sow-n500)`
- 강조: `--color-primary:var(--sow-brand)`
- 지연: `--color-overdue:var(--sow-crit)`

`cssTokens.test.js`가 통과하려면 위 `--sow-*`를 **CSS 파일 안에서 정의**해야 합니다. 인라인 style에서 주입하면 안 됩니다.

### 3.2 레이아웃·격자

| 요소 | 값 |
|---|---|
| 행 높이 | 28px (트래커 `ROW`). 이 앱의 행 높이 체계를 쓰되 compact가 아닐 때 28px에 맞춥니다 |
| 행 줄무늬 | 홀수 번째(0부터 셀 때 1,3,5…) 행 배경 `--sow-row-alt` |
| 행 hover | `--sow-brand-50` |
| 머리글 | 높이 34px, 배경 흰색. 월 라벨 `YYYY.MM` 11px `--sow-n600`. 월 폭이 46px보다 좁으면 **분기마다만** 라벨 표시 |
| 세로 격자 | 매월 1px `--sow-grid`, **1월(연도 경계)은 `--sow-grid-year`** |
| 이름 열 | 오른쪽 경계 1px `--sow-divider`. 그룹(레벨 0) 이름은 600 굵기 `--sow-n900`, 하위는 400. 들여쓰기는 레벨당 16px |
| 글꼴 | `--sow-font` 12px. 축·날짜 라벨 11px |
| 모서리 | 카드·컨테이너 6px(`lg`처럼 0으로 만들지 않음) |

### 3.3 막대

| 대상 | 높이 | 모서리 | 채움 |
|---|---|---|---|
| 하위 작업(레벨 ≥1) | 12px, 행 가운데 | 4px | 막대 색 **28% 불투명도** 바탕 + 진행률 구간만 100% 같은 색. 예: `color-mix(in srgb, <색> 28%, transparent)`, 진행률 오버레이는 기존 것을 재사용 |
| 그룹(레벨 0) | 6px | 2px | 작업 색과 무관하게 **`--sow-n300` 55%** (회색 띠). 트래커는 그룹 막대를 "범위 표시"로만 씁니다 |

- 테두리와 그림자는 없습니다(선택·드래그 시에만 이 앱 기존 강조 사용).
- 막대 위 라벨(`showBarLabels`)을 켜면 11px `--sow-n900`으로 표시합니다. 그림자(text-shadow)는 없습니다.
- 막대 색 결정은 다음과 같습니다.
  - `colorMode==='status'`면 §3.5의 팔레트를 씁니다.
  - 아니면 `range.color || task.color`에 §3.6의 **색 매핑**을 거칩니다.

### 3.4 마일스톤 마커

| 도형 | 모양 | 라벨 |
|---|---|---|
| `diamond`(기본) | 12×12 정사각형을 45° 회전, 채움 = 마일스톤 색, **흰 테두리 2px** | 마커 오른쪽 11px 지점에 날짜 `yy.mm.dd`(예: `27.12.31`), 11px `--sow-n600` |
| `circle` | 반지름 5px, 흰 테두리 2px | 라벨 없음(트래커에서는 "실적일" 마커) |
| 기타 도형 | 이 앱의 `milestoneShapes.js` 서술을 그대로 쓰되 흰 테두리 2px | 이 앱 규칙 |

- 이 앱의 기존 마일스톤 라벨 자동 배치(`milestoneLabels.js`)는 유지해도 됩니다.
- 단, 이 테마에서 **라벨 내용은 날짜**여야 합니다(트래커와 동일). 마일스톤 `label`(예: "K7")은 툴팁으로 보여 줍니다.
- 이 차이가 이 앱의 일반 동작과 충돌하면 §6의 "확인 필요"로 남기세요.

### 3.5 상태 색상 모드 팔레트 (테마별)

`colorMode==='status'`이고 테마가 `sow`이면 다음 색을 씁니다. `STATUS_STYLES`의 id는 그대로 둡니다.

| status id | 라벨 | 색 |
|---|---|---|
| `done` | 완료 | `--sow-good` `#3a9a5b` |
| `active` | 진행중 | `--sow-warn` `#f0b429` |
| `upcoming` | 예정 | `--sow-info` `#6b8fd6` |
| `overdue` | 지연 | `--sow-crit` `#d64545` |

- 구현 제안: 테마 객체에 `statusPalette` 필드를 추가하고 `getStatusColor(status, themeId)`로 확장합니다.
- 범례(`TimelineLegend.jsx`)도 같은 팔레트를 써야 합니다.

### 3.6 트래커 색 → 토큰 매핑 (작업 색 모드)

트래커(`ph.py`)는 마일스톤 상태를 다음 hex로 저장합니다. 이 테마에서는 이 값들을 토큰 색으로 바꿔 그립니다. 다른 hex는 그대로 둡니다.

| 저장된 hex | 의미 | 이 테마에서 그릴 색 |
|---|---|---|
| `#4A90E2` | 예정 | `--sow-info` |
| `#fab219` | 진행 | `--sow-warn` |
| `#0ca30c` | 완료 | `--sow-good` |
| `#d03b3b` | 지연 | `--sow-crit` |
| `#9b9b97` | 취소 | `--sow-none` |
| `#A50034` | Att K 그룹 색 | 그룹이면 §3.3 회색 규칙이 우선 |

- 대소문자를 구분하지 않고 비교합니다.
- 테마 객체에 `colorMap`으로 두면 내보내기에서도 재사용할 수 있습니다.

### 3.7 오늘 선

- 1px 세로선, `--sow-brand`, `stroke-dasharray: 3 3`(CSS면 `border-left:1px dashed`)입니다.
- 상단에 10px 라벨 **"오늘"**을 `--sow-brand`로 붙입니다.
- 기존 `.today-marker::before` 삼각형은 이 테마에서 숨깁니다.

### 3.8 범례 (이 앱에 범례 표시가 켜져 있을 때)

- 순서: `예정 · 진행 · 완료 · 지연 · 취소`(10px 정사각 점, 모서리 2px). 이어서 텍스트 키 `◆ 계획일` `● 실적일` `막대 채움 = 진행률`.
- 12px `--sow-n600`입니다.

## 4. 작업 순서 제안

1. `src/themes/index.js`에 테마를 추가합니다.
   ```js
   { id: 'sow', label: 'SOW Tracker 스타일', shortLabel: 'SOW', icon: '📋',
     description: 'Fujin SOW Tracker와 같은 간트 (옅은 막대 + 진행률, 다이아몬드 + 날짜, 회색 그룹 띠)',
     barShape: 'rect', barFill: 'tint', useTaskColor: true, showDuration: false, forceLight: true,
     statusPalette: { done: '#3a9a5b', active: '#f0b429', upcoming: '#6b8fd6', overdue: '#d64545' },
     colorMap: { '#4a90e2': '#6b8fd6', '#fab219': '#f0b429', '#0ca30c': '#3a9a5b', '#d03b3b': '#d64545', '#9b9b97': '#9a988f' } }
   ```
2. `src/themes/themes.css`에 `[data-chart-theme="sow"]` 블록을 추가합니다(§3.1 토큰과 매핑, §3.2 격자, §3.7 오늘 선).
3. `TimelineBar.jsx`
   - 테마 객체를 읽어 `barFill === 'tint'` 렌더(§3.3)를 추가합니다.
   - 그룹 막대 규칙, `colorMap`·`statusPalette` 적용, 마일스톤 흰 테두리와 날짜 라벨(§3.4)을 넣습니다.
   - `lg`는 기존 분기를 그대로 탑니다.
4. `TimelineLegend.jsx`: 테마별 팔레트를 씁니다.
5. `forceLight` 처리: 이 테마일 때 `.timeline-view` 안에서는 밝은 값으로 고정합니다(`lg`가 하는 방식 참고). 앱 전체 다크 모드는 건드리지 않습니다.
6. `htmlExporter.js`: `CHART_THEME === 'sow'` 분기와 스코프 CSS를 추가합니다. 공용 순수 모듈이 있으면 `?raw`로 심는 기존 방식을 따릅니다.
7. 테스트(§5) → 스크린샷 비교 → 문서 갱신(HANDOVER 변경 이력, README 테마 목록, `docs/AI_INTEGRATION.md`에 테마 언급이 있으면).

## 5. 검증

| 검증 | 방법 |
|---|---|
| 테마 등록 | 단위: `THEMES`에 `sow` 존재, `getTheme('sow').forceLight === true`, `getStatusColor('active','sow') === '#f0b429'`, 색 매핑 함수가 `#4A90E2`→`#6b8fd6`(대소문자 무시) |
| CSS 토큰 | 기존 `cssTokens.test.js` 통과(정의 안 된 `var()` 0) |
| 렌더 | e2e(새 spec 또는 `features.spec.js`): 표시 옵션에서 SOW 테마 선택 → `.timeline-view[data-chart-theme="sow"]` → 하위 막대의 계산된 `background-color`가 반투명(알파 < 1), 그룹 막대는 회색, 마일스톤 마커 흰 테두리, 오늘 선 점선 |
| 다크 모드 | 다크 모드 + SOW 테마 → 타임라인 배경이 흰색 |
| 기존 테마 무변화 | `default`·`lg`로 기존 e2e 전부 통과, 가능하면 스크린샷 비교 |
| 내보내기 | `export-html.spec.js`에 SOW 테마 케이스 추가: 내보낸 프래그먼트의 막대·마커가 같은 규칙 |
| 육안 | "Fujin SOW 마일스톤 (SOW Tracker 연동)" 프로젝트를 SOW 테마로 열어 `docs/screenshots/sow-theme-ref-gantt.png`와 나란히 캡처해 비교. 차이가 남으면 이유를 적어 둠 |

## 6. 하지 말 것 / 주의

- **SOW 연동 프로젝트의 작업을 손으로 고치지 마세요.**
  - 라벨이 `sow-ms:*`·`sow-group:*`인 작업은 트래커가 소유합니다. 여기서 바꾼 날짜·색은 다음 동기화 때 트래커 값으로 돌아갑니다.
  - 테마는 **그리는 방법만** 바꿉니다. 데이터(`timeRanges`·`milestones`의 color 값)는 바꾸지 않습니다.
- `default`·`lg`의 기존 렌더 결과와 저장 데이터 형식을 바꾸지 마세요.
- 새 외부 의존성(폰트 CDN, 아이콘 폰트, 차트 라이브러리)을 넣지 마세요. 사내망입니다.
  - Pretendard가 없으면 Malgun Gothic으로 대체되는 폰트 스택 그대로 둡니다.
- `chartTheme`는 전역 설정입니다. "이 프로젝트를 열면 자동으로 SOW 테마"처럼 **프로젝트별 테마**가 필요하다면 범위 밖입니다. 하지 말고 사용자에게 확인하세요(설정 저장 구조가 바뀝니다).
- **확인 필요 (작업 전에 사용자에게 물어볼 것)**
  - 마일스톤 라벨을 이 테마에서 날짜로 바꾸는 것(§3.4)이 다른 프로젝트에도 적용돼도 되는지. 아니면 "SOW 연동 프로젝트에서만"인지.
  - 진행률 채움의 의미 차이: 트래커는 산출물 승인 비율을 `progress`로 넣고, 이 앱에서는 일반 진행률입니다. 범례 문구를 "진행률"로 할지.

## 7. 참고: 트래커 쪽 연동 요약 (수정 대상 아님)

- **동기화 방법:** `ph.py`가 `POST /api/projects/{pid}/batch`로 동기화합니다. 여러 번 실행해도 결과가 같습니다.
- **만드는 구조:**
  - 그룹 2개: `sow-group:K` "SOW 주요 마일스톤 (Attachment K)", `sow-group:F1` "U.2 모듈 단계 (Attachment F1)"
  - 마일스톤마다 작업 1개: 이름 `K7 · ASIC Tapeout …`, 라벨 `sow-ms:K7`
  - 단계 막대: 직전 마일스톤 날짜 → 이 마일스톤 날짜. 색 = 상태(§3.6)
  - ◆ 계획일, ● 실적일 마커
  - `progress` = 산출물 승인 비율
  - 같은 그룹 안 단계 간 의존성
- **트래커 쪽 문서:** `~/08.Services/sow-tracker/HANDOVER.md` §3.4
