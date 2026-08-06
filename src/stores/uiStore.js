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

    // ── 팝오버 / 인라인 편집 ─────────────────────────
    popoverInfo: null,        // { x, y, taskId, date, rangeId }
    openPopover: (info) => set({ popoverInfo: info }),
    closePopover: () => set({ popoverInfo: null }),

    milestoneModalInfo: null, // { task, date }
    openMilestoneAdd: (info) => set({ milestoneModalInfo: info }),
    closeMilestoneAdd: () => set({ milestoneModalInfo: null }),

    // 프로젝트를 전환하면 이전 프로젝트의 선택/검색/팝오버가 남아 있으면 안 된다
    resetViewState: () => set({
        selectedTaskId: null,
        searchQuery: '',
        popoverInfo: null,
        milestoneModalInfo: null,
    }),
}));
