# AGENTS.md — ProjectHelper 개발자/AI 에이전트 가이드

## 프로젝트 개요

React 18 + Vite 기반의 **클라이언트 전용** 프로젝트 타임라인·간트 차트 관리 도구.
백엔드 없음. 모든 데이터는 `localStorage`에 저장.

---

## 빌드 / 개발 명령어

```bash
npm run dev      # 개발 서버 (http://localhost:5173, Hot-Reload)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과물 로컬 미리보기
```

> 테스트 프레임워크 및 린터는 현재 설정되지 않음.
> 코드 변경 후 반드시 `npm run build`로 빌드 성공 여부 확인.

---

## 아키텍처

### 상태 흐름

```
App.jsx (중앙 상태 관리)
  ├── useUndoRedo(tasks)         ← 작업 트리 전체를 히스토리와 함께 관리
  ├── useToast()                 ← 전역 토스트 알림
  ├── useState(viewMode)         ← 'table' | 'timeline' | 'split'
  ├── useState(settings...)      ← timeScale, zoomLevel, showToday, 등 9개
  │
  ├── TableView                  ← 계층적 표 편집
  ├── TimelineView               ← 간트 차트 + DnD (@dnd-kit)
  ├── TimelineBarPopover         ← 우클릭 컨텍스트 메뉴 (전역 팝오버)
  ├── SaveLoadModal              ← 로컬 스냅샷 저장/불러오기
  ├── ImportExportModal          ← JSON 파일 가져오기/내보내기
  └── ToastContainer             ← 화면 우하단 알림
```

### 데이터 모델

작업(Task)은 **재귀 트리**:

```js
{
  id: 'task-1726...abc',        // generateId()로 생성
  name: '작업명',
  timeRanges: [                 // ← 주요 날짜 데이터 (startDate/endDate는 레거시)
    {
      id: 'task-...',
      startDate: 'YYYY-MM-DD',
      endDate: 'YYYY-MM-DD',
      dependencies: [],         // 선행 rangeId 또는 taskId 배열
      color: null,
      label: ''
    }
  ],
  color: '#4A90E2',
  description: '',
  children: [],                 // 하위 작업 (재귀)
  expanded: true,
  labels: [],
  parentId: null,
  milestones: [
    { id, date, label, color, shape: 'diamond'|'circle'|'triangle'|'square' }
  ],
  dependencies: [],             // 항상 [] (range 레벨로 마이그레이션됨)
  divider: { enabled, thickness, style, color }
}
```

### localStorage 키

| 키 | 내용 |
|---|---|
| `project-timeline-data` | 활성 작업 트리 |
| `project-timeline-settings` | UI 설정 (timeScale, zoomLevel, darkMode 등) |
| `project-timeline-snapshots` | 이름 지정 저장 슬롯 배열 |

---

## 핵심 유틸리티

### `src/utils/dataModel.js`

| 함수 | 역할 |
|---|---|
| `createNewTask(name, parentId)` | 올바른 구조의 신규 작업 생성. 직접 객체를 만들지 말 것 |
| `generateId()` | `task-{timestamp}-{random}` 형식의 고유 ID 생성 |
| `flattenTasks(tasks, level)` | 트리를 `expanded` 상태를 존중하며 순서 있는 배열로 평탄화 |
| `migrateTaskData(tasks)` | 구버전(startDate/endDate) → timeRanges 자동 변환. 로드 시 항상 호출됨 |
| `formatDate(date)` | Date 객체 또는 문자열을 `YYYY-MM-DD`로 정규화 |

### `src/hooks/useUndoRedo.js`

```js
const { state, setState, setStateSilent, undo, redo, canUndo, canRedo } = useUndoRedo(initialState);
```

- **`setState(fn)`** — 히스토리에 기록하는 상태 변경 (사용자 액션)
- **`setStateSilent(fn)`** — 히스토리에 기록하지 않는 변경 (드래그 중간 상태)
- 히스토리 최대 20개 유지

### `src/hooks/useToast.js`

```js
const { toasts, toast, removeToast } = useToast();
toast.success('메시지');
toast.error('메시지');
toast.warn('메시지');
toast.info('메시지');
```

`alert()` 대신 반드시 `toast`를 사용할 것.

---

## 주요 개발 패턴

### 작업 트리 업데이트 (불변성)

```js
// ✅ 올바른 방법: updateTaskInTree 재귀 헬퍼 사용
const updateTaskInTree = (items, taskId, updates) =>
    items.map(task =>
        task.id === taskId
            ? { ...task, ...updates }
            : { ...task, children: updateTaskInTree(task.children, taskId, updates) }
    );

setTasks(prev => updateTaskInTree(prev, taskId, { name: '새 이름' }));

// ❌ 금지: 원본 객체 직접 변경
item.children = something;  // 뮤테이션 → undo/redo 히스토리 오염
```

### 작업 삭제 (불변성)

```js
const deleteFromTree = (items) =>
    items
        .filter(item => item.id !== taskId)
        .map(item => ({ ...item, children: deleteFromTree(item.children) }));

setTasks(prev => deleteFromTree(prev));
```

### 딥클론

```js
// ✅ 올바른 방법
const cloned = structuredClone(obj);

// ❌ 금지 (Date 객체, undefined 손실 위험)
const cloned = JSON.parse(JSON.stringify(obj));
```

### 필터링된 목록

`App.jsx`의 `filteredTasks`는 `useMemo`로 계산된 변수.
JSX에서 **함수 호출 `filteredTasks()`가 아닌 변수 참조 `filteredTasks`** 로 사용.

### 컴포넌트-CSS 쌍

모든 컴포넌트는 같은 이름의 CSS 파일과 쌍을 이룸:
`Foo.jsx` + `Foo.css`. 다크 모드는 `[data-theme="dark"]` 선택자로 처리.

---

## 동작 검증 방법

### 빌드 검증

```bash
npm run build
# 오류 없이 dist/ 생성 확인
```

### 수동 검증 체크리스트

**작업 CRUD:**
- [ ] "새 작업" 추가 → 목록에 표시
- [ ] 작업명 더블클릭 → 인라인 편집 → Enter 저장
- [ ] 작업 삭제 → 자식 포함 삭제, 선택 해제
- [ ] Ctrl+Z / Ctrl+Y → 실행 취소/다시 실행

**다단계 중첩 업데이트 (3단계 초과):**
- [ ] 작업 > 하위 > 하위 > 하위 (4단계) 작업명 수정 → 정상 반영

**저장/불러오기:**
- [ ] `Ctrl+S` → JSON 파일 다운로드
- [ ] 가져오기 → 덮어쓰기/병합 각각 동작
- [ ] 💾 저장 모달 → 저장 → 불러오기 → 데이터 복원

**Toast:**
- [ ] 가져오기 성공 → 하단 우측 토스트 표시 (alert 차단 없음)
- [ ] 잘못된 JSON 가져오기 → 에러 토스트

**검색:**
- [ ] 작업명 검색 → 매칭 항목만 표시
- [ ] description 내용 검색 → 매칭 항목 표시

**타임라인 드래그:**
- [ ] 바 드래그 → 날짜 변경 후 undo 가능
- [ ] Ctrl 드래그 → 복사 모드
- [ ] Escape → 드래그 취소

**이미지 캡처:**
- [ ] HTTPS 환경: 클립보드 복사 성공 토스트
- [ ] HTTP 환경: 다운로드 파일 생성 + 정보 토스트

---

## 파일 구조 요약

```
src/
├── App.jsx                  # 중앙 상태, 라우팅, 전체 핸들러
├── hooks/
│   ├── useUndoRedo.js       # Undo/Redo 상태 관리
│   └── useToast.js          # 토스트 알림
├── utils/
│   ├── dataModel.js         # Task 구조 정의, 마이그레이션, 샘플 데이터
│   ├── dateUtils.js         # 날짜 계산/스냅/포맷
│   ├── storage.js           # localStorage CRUD, 스냅샷 관리
│   └── htmlExporter.js      # 인터랙티브 HTML 내보내기 생성
└── components/
    ├── Toast.jsx / .css     # 토스트 알림 UI
    ├── TableView.jsx / .css # 표 뷰 + @dnd-kit 정렬
    ├── TimelineView.jsx / .css  # 간트 차트 + 드래그 날짜 조정
    ├── TimelineBar.jsx / .css   # 개별 간트 바 (드래그 핸들)
    ├── TimelineBarPopover.jsx   # 우클릭 컨텍스트 메뉴
    ├── SaveLoadModal.jsx    # 스냅샷 저장/불러오기
    ├── ImportExportModal.jsx # JSON 가져오기/내보내기
    └── PromptGuideModal.jsx # AI 프롬프트 가이드
```

---

## 배포

```bash
# HTTP 기본 배포
./start_server.sh

# HTTPS (내부망, Caddy 사용)
# Caddyfile의 IP를 서버 IP로 수정 후:
./start_https.sh

# 개발 모드 (Hot-Reload)
./start_dev.sh
```

HTTPS 환경에서만 클립보드 Write API (`navigator.clipboard.write`)가 동작.
HTTP 환경에서는 이미지 캡처 시 자동으로 파일 다운로드로 대체.
