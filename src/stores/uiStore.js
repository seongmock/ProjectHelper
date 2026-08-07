// 화면 상태 스토어 (Zustand) — 지속되지 않는 것만 담는다.
//
// 담는 것: 뷰 모드, 검색어, 선택, 열려 있는 모달/팝오버
// 담지 않는 것: 작업 트리(useUndoRedo), 저장되는 설정(settingsStore)
//
// 모달 상태를 App.jsx 의 useState 5개로 흩어 두면 "무엇이 열려 있는지"를 한눈에 볼 수
// 없고, 하나를 열 때 다른 것을 닫는 규칙을 강제할 수 없다.
import { create } from 'zustand';

export const useUiStore = create((set) => ({
    // ── 뷰 ───────────────────────────────────────────
    viewMode: 'timeline', // 'table' | 'timeline' | 'split'
    setViewMode: (viewMode) => set({ viewMode }),

    searchQuery: '',
    setSearchQuery: (searchQuery) => set({ searchQuery }),

    selectedTaskId: null,
    setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),

    // ── 모달 ─────────────────────────────────────────
    isPromptGuideOpen: false,
    openPromptGuide: () => set({ isPromptGuideOpen: true }),
    closePromptGuide: () => set({ isPromptGuideOpen: false }),

    isSnapshotsOpen: false,
    openSnapshots: () => set({ isSnapshotsOpen: true }),
    closeSnapshots: () => set({ isSnapshotsOpen: false }),

    // 'IMPORT' | 'EXPORT' | null. customExportData 는 스냅샷을 내보낼 때만 채워진다.
    ieModalMode: null,
    customExportData: null,
    openImport: () => set({ ieModalMode: 'IMPORT', customExportData: null }),
    openExport: (customExportData = null) => set({ ieModalMode: 'EXPORT', customExportData }),
    closeIeModal: () => set({ ieModalMode: null, customExportData: null }),

    // 우클릭으로 특정 기간을 지목했을 때 그 기간 id. 인스펙터가 해당 기간을 강조하고
    // "연결 추가"의 주체로 쓴다. 다른 작업을 선택해도 남을 수 있어서 **인스펙터가
    // 소유 여부를 확인하고 무시한다** — 여기서 지우려면 선택 변경 경로를 전부 알아야 한다.
    selectedRangeId: null,
    setSelectedRangeId: (selectedRangeId) => set({ selectedRangeId }),

    // 마일스톤도 같은 규약이다(v3). 선택 단위는 여전히 **작업 하나**이고, 기간·마일스톤은
    // 그 안에서 어디를 지목했는지를 나타내는 포커스 힌트일 뿐이다 — 그래서 둘은 배타적이다.
    selectedMilestoneId: null,
    setSelectedMilestoneId: (selectedMilestoneId) => set({ selectedMilestoneId }),

    // 명령 팔레트(Ctrl+K). 열림 상태만 여기 두고 목록은 App 이 만든다 —
    // 팔레트가 실행하는 것은 전부 이미 어딘가에 있는 핸들러다.
    isPaletteOpen: false,
    openPalette: () => set({ isPaletteOpen: true }),
    closePalette: () => set({ isPaletteOpen: false }),
    togglePalette: () => set(state => ({ isPaletteOpen: !state.isPaletteOpen })),

    milestoneModalInfo: null, // { task, date }
    openMilestoneAdd: (info) => set({ milestoneModalInfo: info }),
    closeMilestoneAdd: () => set({ milestoneModalInfo: null }),

    // 프로젝트를 전환하면 이전 프로젝트의 선택/검색/모달이 남아 있으면 안 된다
    resetViewState: () => set({
        selectedTaskId: null,
        selectedRangeId: null,
        selectedMilestoneId: null,
        searchQuery: '',
        milestoneModalInfo: null,
    }),
}));
