import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSampleData, createNewTask, generateId, flattenTasks, migrateTaskData } from './utils/dataModel';
import {
    updateTaskInTree,
    deleteFromTree,
    addToParent,
    findTaskAndParent,
    isDescendant,
    indentTask,
    outdentTask,
    regenerateIds,
    recalcTaskBounds,
    findOwnerOfEntity,
} from './utils/taskTree';
import { storage } from './utils/storage';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useToast } from './hooks/useToast';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import TableView from './components/TableView';
import TimelineView from './components/TimelineView';
import TimelineBarPopover from './components/TimelineBarPopover';
import PromptGuideModal from './components/PromptGuideModal';
import ImportExportModal from './components/ImportExportModal';
import SaveLoadModal from './components/SaveLoadModal';
import MilestoneQuickAdd from './components/MilestoneQuickAdd';
import ToastContainer from './components/Toast';
import { exportToHtml } from './utils/htmlExporter';
import { getTheme } from './themes/index.js';
import './themes/themes.css';
import './App.css';

function App() {
    // 뷰 모드: 'table', 'timeline', 'split'
    const [viewMode, setViewMode] = useState('timeline');

    // Toast 알림
    const { toasts, toast, removeToast } = useToast();

    // 서버 로드 완료 전 로딩 상태
    const [isLoading, setIsLoading] = useState(true);

    // 설정 (localStorage 캐시에서 즉시 초기화, 서버 로드 후 갱신)
    const loadSettingsSync = () => {
        try {
            const item = localStorage.getItem('project-timeline-settings');
            return item ? JSON.parse(item) : null;
        } catch { return null; }
    };
    const [timeScale, setTimeScale] = useState(() => loadSettingsSync()?.timeScale || 'monthly');
    const [zoomLevel, setZoomLevel] = useState(() => loadSettingsSync()?.zoomLevel || 1.0);
    const [showToday, setShowToday] = useState(() => loadSettingsSync()?.showToday ?? true);
    const [isCompact, setIsCompact] = useState(() => loadSettingsSync()?.isCompact || false);
    const [showTaskNames, setShowTaskNames] = useState(() => loadSettingsSync()?.showTaskNames ?? true);
    const [snapEnabled, setSnapEnabled] = useState(() => loadSettingsSync()?.snapEnabled ?? true);
    const [showBarLabels, setShowBarLabels] = useState(() => loadSettingsSync()?.showBarLabels ?? false);
    const [showBarDates, setShowBarDates] = useState(() => loadSettingsSync()?.showBarDates ?? false);

    // 차트 테마
    const [chartTheme, setChartTheme] = useState(() => loadSettingsSync()?.chartTheme || 'default');
    const themeConfig = getTheme(chartTheme);

    // 다크모드
    const [darkMode, setDarkMode] = useState(() => {
        const saved = loadSettingsSync();
        if (saved?.darkMode !== undefined) return saved.darkMode;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    });

    // 검색 쿼리
    const [searchQuery, setSearchQuery] = useState('');

    // 선택된 작업
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const timelineRef = useRef(null);

    // AI 프롬프트 가이드 모달 상태
    const [isPromptGuideOpen, setIsPromptGuideOpen] = useState(false);

    // 가져오기/내보내기 모달 상태
    const [ieModalMode, setIeModalMode] = useState(null); // 'IMPORT' | 'EXPORT' | null

    // 저장/불러오기 모달 상태
    const [isSaveLoadModalOpen, setIsSaveLoadModalOpen] = useState(false);
    // 커스텀 내보내기 데이터 (스냅샷 내보내기용)
    const [customExportData, setCustomExportData] = useState(null);

    // 컨텍스트 메뉴 팝오버 상태 (Table/Timeline 공용)
    const [popoverInfo, setPopoverInfo] = useState(null); // { x, y, taskId, date }

    // 마일스톤 추가 모달 상태 (App 레벨로 이동)
    const [milestoneModalInfo, setMilestoneModalInfo] = useState(null); // { task, date }

    // 컨텍스트 메뉴 핸들러
    const handleContextMenu = useCallback((e, taskId, date = null, rangeId = null) => {
        e.preventDefault();
        const clickDate = date || new Date(); // 날짜 없으면 오늘
        setPopoverInfo({
            x: e.clientX,
            y: e.clientY,
            taskId,
            date: clickDate,
            rangeId // Pass rangeId
        });
    }, []);

    // 팝오버 닫기
    const closePopover = useCallback(() => setPopoverInfo(null), []);

    // 뷰 설정 일괄 적용 (서버 로드/가져오기 공용) — 존재하는 필드만 반영
    const applyViewSettings = useCallback((settings) => {
        if (!settings) return;
        if (settings.viewMode) setViewMode(settings.viewMode);
        if (settings.timeScale) setTimeScale(settings.timeScale);
        if (settings.zoomLevel) setZoomLevel(settings.zoomLevel);
        if (settings.showToday !== undefined) setShowToday(settings.showToday);
        if (settings.isCompact !== undefined) setIsCompact(settings.isCompact);
        if (settings.showTaskNames !== undefined) setShowTaskNames(settings.showTaskNames);
        if (settings.snapEnabled !== undefined) setSnapEnabled(settings.snapEnabled);
        if (settings.showBarLabels !== undefined) setShowBarLabels(settings.showBarLabels);
        if (settings.showBarDates !== undefined) setShowBarDates(settings.showBarDates);
        if (settings.darkMode !== undefined) setDarkMode(settings.darkMode);
        if (settings.chartTheme) setChartTheme(settings.chartTheme);
    }, []);

    // 초기 데이터 로드 (서버 우선 → localStorage 폴백 → 샘플)
    const {
        state: tasks,
        setState: setTasks,
        setStateSilent: setTasksSilent,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useUndoRedo(getSampleData()); // 서버 로드 전 임시 샘플

    useEffect(() => {
        (async () => {
            try {
                const [serverData, serverSettings] = await Promise.all([
                    storage.loadData(),
                    storage.loadSettings(),
                ]);

                // 설정 적용
                applyViewSettings(serverSettings);

                // 작업 데이터 적용
                if (serverData) {
                    let dataToLoad;
                    if (serverData.data && Array.isArray(serverData.data)) {
                        dataToLoad = serverData.data;
                    } else if (Array.isArray(serverData)) {
                        dataToLoad = serverData;
                    }
                    if (dataToLoad) setTasks(migrateTaskData(dataToLoad));
                }
            } finally {
                setIsLoading(false);
            }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 외부(AI API 등) 변경 재로드 직후 저장 에코 방지 플래그
    const skipNextSaveRef = useRef(false);

    // 서버 데이터를 히스토리 오염 없이 반영 (외부 변경 수신용)
    const reloadFromServer = useCallback(async () => {
        const fresh = await storage.loadData();
        if (fresh) {
            const data = Array.isArray(fresh) ? fresh : fresh.data;
            if (Array.isArray(data)) {
                skipNextSaveRef.current = true;
                setTasksSilent(() => migrateTaskData(data));
            }
        }
    }, [setTasksSilent]);

    // 자동 저장 — 1.5초 debounce (매 변경마다 서버 요청 방지)
    // 409(리비전 충돌) 시 서버 우선 정책: 외부(AI) 변경을 다시 로드해 반영
    useEffect(() => {
        if (isLoading) return; // 초기 로드 중에는 저장하지 않음
        if (skipNextSaveRef.current) {
            skipNextSaveRef.current = false;
            return;
        }
        const timer = setTimeout(async () => {
            const result = await storage.saveData(tasks);
            if (result?.conflict) {
                toast.info('외부에서 데이터가 변경되어 최신 상태를 불러왔습니다.');
                await reloadFromServer();
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [tasks, isLoading, reloadFromServer, toast]);

    // 리비전 폴링 — 외부(AI API)가 데이터를 변경하면 10초 내 자동 반영
    useEffect(() => {
        if (isLoading) return;
        const id = setInterval(async () => {
            if (document.hidden) return; // 백그라운드 탭은 폴링 생략
            const rev = await storage.fetchRevision();
            if (rev != null && storage.getKnownRevision() != null && rev !== storage.getKnownRevision()) {
                await reloadFromServer();
            }
        }, 10000);
        return () => clearInterval(id);
    }, [isLoading, reloadFromServer]);

    // 다크모드 설정 저장
    // 다크모드 변경 시 DOM 적용
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }, [darkMode]);

    // 시스템 다크모드 설정 감지
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = (e) => {
            // 사용자 설정이 없을 때만 시스템 설정 따름
            // (버그 수정: loadSettings()는 async — 동기 캐시를 읽어야 저장된 설정이 존중됨)
            const saved = loadSettingsSync();
            if (!saved || saved.darkMode === undefined) {
                setDarkMode(e.matches);
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    // 다크모드 토글 핸들러 (저장 포함)
    const handleToggleDarkMode = useCallback(() => {
        setDarkMode(prev => {
            const newMode = !prev;
            storage.saveSettings({ darkMode: newMode });
            return newMode;
        });
    }, []);

    // 타임라인 설정 저장
    // (버그 수정: 초기 로드 중 기본값이 서버 설정을 덮어쓰는 레이스 방지 — isLoading 가드.
    //  saveSettings가 내부에서 localStorage 캐시와 병합하므로 별도 로드 불필요)
    useEffect(() => {
        if (isLoading) return;
        storage.saveSettings({
            timeScale,
            zoomLevel,
            showToday,
            isCompact,
            showTaskNames,
            snapEnabled,
            showBarLabels,
            showBarDates,
            chartTheme,
        });
    }, [isLoading, timeScale, zoomLevel, showToday, isCompact, showTaskNames, snapEnabled, showBarLabels, showBarDates, chartTheme]);

    // 테마 변경 핸들러
    const handleThemeChange = useCallback((newTheme) => {
        setChartTheme(newTheme);
        storage.saveSettings({ chartTheme: newTheme });
    }, []);

    // 작업 추가
    const handleAddTask = useCallback((parentId = null) => {
        const newTask = createNewTask('새 작업', parentId);

        setTasks(prevTasks =>
            parentId ? addToParent(prevTasks, parentId, newTask) : [...prevTasks, newTask]
        );

        setSelectedTaskId(newTask.id);
    }, [setTasks]);

    // 작업 업데이트
    const handleUpdateTask = useCallback((taskId, updates) => {
        setTasks(prevTasks => updateTaskInTree(prevTasks, taskId, updates));
    }, [setTasks]);

    // 여러 작업 동시 업데이트 처리 (Undo/Redo를 위해 한 번의 상태 변경으로 처리)
    const handleUpdateMultipleTasks = useCallback((updatesArray) => {
        setTasks(prevTasks => {
            return updatesArray.reduce(
                (acc, { taskId, updates }) => updateTaskInTree(acc, taskId, updates),
                prevTasks
            );
        });
    }, [setTasks]);

    // 작업 삭제 (불변 재귀 — 원본 객체 직접 변경 없음)
    const handleDeleteTask = useCallback((taskId) => {
        setTasks(prev => deleteFromTree(prev, taskId));
        setSelectedTaskId(null);
    }, [setTasks]);

    // 팝오버 액션 핸들러들 (순서 변경됨)
    const handlePopoverUpdate = useCallback((id, updates) => {
        handleUpdateTask(id, updates);
    }, [handleUpdateTask]);

    const handlePopoverDelete = useCallback((id) => {
        handleDeleteTask(id);
        closePopover();
    }, [handleDeleteTask, closePopover]);

    // 팝오버 내 "마일스톤 추가" 핸들러
    const handlePopoverAddMilestone = useCallback(() => {
        if (!popoverInfo) return;

        const flatList = flattenTasks(tasks);
        const targetTask = flatList.find(t => t.id === popoverInfo.taskId);

        if (targetTask) {
            setMilestoneModalInfo({ task: targetTask, date: popoverInfo.date });
        }
        closePopover();
    }, [popoverInfo, closePopover, tasks]);

    // 마일스톤 추가 완료 핸들러
    const handleAddMilestone = useCallback((taskId, milestoneData) => {
        const flatList = flattenTasks(tasks);
        const currentTask = flatList.find(t => t.id === taskId);

        if (currentTask) {
            const newMilestone = {
                id: generateId(),
                ...milestoneData
            };
            const updatedMilestones = [...(currentTask.milestones || []), newMilestone];
            handleUpdateTask(taskId, { milestones: updatedMilestones });
        }
        setMilestoneModalInfo(null);
    }, [tasks, handleUpdateTask]);

    // 작업 순서 변경 (드래그 앤 드롭)
    const handleReorderTasks = useCallback((reorderedTasks) => {
        setTasks(reorderedTasks);
    }, [setTasks]);

    // 작업 들여쓰기 (Indent)
    const handleIndentTask = useCallback((taskId) => {
        setTasks(prevTasks => indentTask(prevTasks, taskId));
    }, [setTasks]);

    // 작업 이동 핸들러 (DnD)
    const handleMoveTask = useCallback((activeId, overId) => {
        setTasks((prevTasks) => {
            const activeInfo = findTaskAndParent(prevTasks, activeId);
            const overInfo = findTaskAndParent(prevTasks, overId);

            if (!activeInfo || !overInfo) return prevTasks;

            // 같은 항목이면 무시
            if (activeId === overId) return prevTasks;

            // 불변성 유지를 위해 deep clone 후 처리
            const clonedTasks = structuredClone(prevTasks);

            // 클론된 데이터에서 다시 찾기
            const activeNode = findTaskAndParent(clonedTasks, activeId);
            const overNode = findTaskAndParent(clonedTasks, overId);

            if (!activeNode || !overNode) return prevTasks;

            // 순환 참조 방지: overNode가 activeNode의 자손이면 이동 불가
            if (isDescendant(activeNode.task, overId)) {
                return prevTasks;
            }

            // 글로벌 인덱스로 이동 방향 판별 (평탄화된 리스트 기준)
            const flatList = flattenTasks(prevTasks);
            const activeFlatItem = flatList.find(t => t.id === activeId);
            const overFlatItem = flatList.find(t => t.id === overId);

            // 안전장치
            if (!activeFlatItem || !overFlatItem) return prevTasks;

            const activeGlobalIndex = flatList.findIndex(t => t.id === activeId);
            let overGlobalIndex = flatList.findIndex(t => t.id === overId);

            // [Fix] 최상위(Root) 태스크를 하위(Child) 태스크 위로 드래그했을 때,
            // 하위 태스크의 자식으로 들어가는 것을 방지하고, 해당 하위 태스크의 최상위 조상 위치로 매핑
            let effectiveOverId = overId;
            let targetNode = overNode; // 기본값: overNode가 타겟

            if (activeFlatItem.level === 0 && overFlatItem.level > 0) {
                // overId의 최상위 조상 찾기 (평탄화 리스트에서 위쪽으로 탐색하여 레벨 0 찾기)
                for (let i = overGlobalIndex; i >= 0; i--) {
                    if (flatList[i].level === 0) {
                        effectiveOverId = flatList[i].id;
                        overGlobalIndex = i; // 인덱스도 업데이트
                        break;
                    }
                }
            }

            const isMovingDown = activeGlobalIndex < overGlobalIndex;

            // 제거
            activeNode.list.splice(activeNode.index, 1);

            // 타겟이 변경되었다면 다시 찾기 (effectiveOverId는 Root이므로 제거 후에도 유효)
            if (effectiveOverId !== overId) {
                const found = findTaskAndParent(clonedTasks, effectiveOverId);
                if (found) {
                    targetNode = found;
                }
            }

            // 추가
            let targetList = targetNode.list;
            let targetIndex = targetList.findIndex(t => t.id === effectiveOverId);

            // [Fix 2] '열려있는(Expanded) 그룹'의 제목 위로 드래그(하방 이동)한 경우,
            // 해당 그룹의 '첫 번째 자식'으로 넣으려는 의도로 해석.
            // 단, 이미 자식이 있는 경우에만 적용 (빈 태스크는 Leaf로 취급하여 순서 변경만 허용)
            // 빈 태스크에 넣으려면 '들여쓰기' 제스처를 사용해야 함.
            const isDroppingOnExpandedParent =
                isMovingDown &&
                overNode.task.expanded &&
                overNode.task.children && overNode.task.children.length > 0 &&
                overNode.task.id === effectiveOverId;

            if (isDroppingOnExpandedParent) {
                // 부모의 자식 리스트로 타겟 변경
                // 주의: overNode는 clone된 트리의 node이므로 task.children 참조 유효
                if (!overNode.task.children) overNode.task.children = [];

                targetList = overNode.task.children;
                targetIndex = 0; // 첫 번째 위치
            } else {
                // 일반적인 경우: 아래로 이동 시 타겟의 뒤로 이동 (Insert After)
                if (isMovingDown) {
                    targetIndex += 1;
                }
            }

            targetList.splice(targetIndex, 0, activeNode.task);

            return clonedTasks;
        });
    }, [setTasks]);

    // 작업 내어쓰기 (Outdent)
    const handleOutdentTask = useCallback((taskId) => {
        setTasks(prevTasks => outdentTask(prevTasks, taskId));
    }, [setTasks]);

    // 내보내기 데이터 생성 (객체만 반환)
    const getExportDataObject = useCallback(() => {
        return {
            meta: {
                viewSettings: {
                    viewMode,
                    timeScale,
                    zoomLevel,
                    showToday,
                    isCompact,
                    showTaskNames,
                    darkMode,
                    snapEnabled
                },
                version: '1.0'
            },
            data: tasks
        };
    }, [tasks, viewMode, timeScale, zoomLevel, showToday, isCompact, showTaskNames, darkMode, snapEnabled]);

    // 내보내기 (파일 저장)
    const handleExport = useCallback(() => {
        const exportData = customExportData || getExportDataObject();
        const timestamp = new Date().toISOString().slice(0, 10);
        storage.exportData(exportData, `project-timeline-${timestamp}.json`);
    }, [getExportDataObject, customExportData]);

    // HTML 내보내기
    const handleHtmlExport = useCallback(() => {
        const settings = {
            darkMode,
            dayWidth: zoomLevel * 40,
            showToday,
            showBarLabels,
            showBarDates,
            showTaskNames,
            timeScale,
            isCompact,
            chartTheme,
        };

        const htmlContent = exportToHtml(tasks, settings);

        navigator.clipboard.writeText(htmlContent)
            .then(() => {
                toast.success('HTML 코드가 클립보드에 복사되었습니다!');
            })
            .catch(() => {
                toast.error('클립보드 복사에 실패했습니다.');
            });
    }, [tasks, darkMode, zoomLevel, showToday, showBarLabels, showBarDates, showTaskNames, timeScale, isCompact, chartTheme, toast]);

    // 스냅샷 내보내기 핸들러
    const handleSnapshotExport = useCallback((snapshot) => {
        // 현재 설정 + 스냅샷 데이터로 내보내기 객체 생성
        const exportObject = {
            meta: {
                viewSettings: {
                    viewMode, timeScale, zoomLevel, showToday, isCompact, showTaskNames, darkMode, snapEnabled
                },
                version: '1.0'
            },
            data: snapshot.data
        };
        setCustomExportData(exportObject);
        setIeModalMode('EXPORT');
    }, [viewMode, timeScale, zoomLevel, showToday, isCompact, showTaskNames, darkMode, snapEnabled]);

    // 가져오기 데이터 처리 공통 로직
    const processImportedData = useCallback((importedData, isMerge = false) => {
        try {
            let newTasks = [];

            if (Array.isArray(importedData)) {
                newTasks = importedData;
            } else if (importedData.data && Array.isArray(importedData.data)) {
                newTasks = importedData.data;

                if (!isMerge && importedData.meta && importedData.meta.viewSettings) {
                    const settings = importedData.meta.viewSettings;
                    applyViewSettings(settings);
                    if (settings.darkMode !== undefined) {
                        storage.saveSettings({ darkMode: settings.darkMode });
                    }
                }
            } else {
                throw new Error('Invalid data format');
            }

            if (isMerge) {
                const processedTasks = regenerateIds(newTasks);
                setTasks(prev => [...prev, ...processedTasks]);
            } else {
                setTasks(newTasks);
            }
        } catch (error) {
            console.error('Failed to process data:', error);
            toast.error('데이터 처리 중 오류가 발생했습니다.');
        }
    }, [applyViewSettings, setTasks, toast]);

    // 가져오기 (파일)
    const handleImport = useCallback((file, isMerge = false) => {
        storage.importData(file)
            .then(importedData => {
                processImportedData(importedData, isMerge);
                toast.success(isMerge ? '데이터가 성공적으로 병합되었습니다.' : '데이터를 성공적으로 가져왔습니다.');
            })
            .catch(error => {
                console.error('Failed to import data:', error);
                toast.error('데이터 가져오기에 실패했습니다.');
            });
    }, [processImportedData, toast]);

    // 키보드 단축키 — handleExport/handleAddTask 선언 이후에 위치해야 TDZ 오류 방지
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                redo();
            }
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                handleExport();
            }
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                handleAddTask();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, handleExport, handleAddTask]);

    // 필터링된 작업 (검색어 적용) — split 모드에서 중복 계산 방지
    const filteredTasks = useMemo(() => {
        if (!searchQuery.trim()) return tasks;

        const query = searchQuery.toLowerCase();
        const filterTasks = (items) =>
            items
                .filter(item => {
                    const matchesName = item.name.toLowerCase().includes(query);
                    const matchesDesc = item.description && item.description.toLowerCase().includes(query);
                    const hasMatchingChildren = item.children && item.children.length > 0 && filterTasks(item.children).length > 0;
                    return matchesName || matchesDesc || hasMatchingChildren;
                })
                .map(item => ({ ...item, children: filterTasks(item.children || []) }));

        return filterTasks(tasks);
    }, [tasks, searchQuery]);



    // 줌 핸들러
    const handleZoomIn = () => setZoomLevel(prev => prev + 0.1);
    const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.1, 0.1));

    // 타임라인 이미지 복사
    const handleCopyTimeline = () => {
        if (timelineRef.current) {
            timelineRef.current.copyToClipboard();
        }
    };

    return (
        <div className="app">
            <Header
                darkMode={darkMode}
                onToggleDarkMode={handleToggleDarkMode}
                onExport={() => setIeModalMode('EXPORT')}
                onImport={() => setIeModalMode('IMPORT')}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onOpenPromptGuide={() => setIsPromptGuideOpen(true)}
                onOpenSnapshots={() => setIsSaveLoadModalOpen(true)}
            />

            <Toolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                timeScale={timeScale}
                onTimeScaleChange={setTimeScale}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onAddTask={() => handleAddTask()}
                // 타임라인 컨트롤 props
                zoomLevel={zoomLevel}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                showToday={showToday}
                onToggleToday={() => setShowToday(!showToday)}
                isCompact={isCompact}
                onToggleCompact={() => setIsCompact(!isCompact)}
                showTaskNames={showTaskNames}
                onToggleTaskNames={() => setShowTaskNames(!showTaskNames)}
                onCopyImage={handleCopyTimeline}
                snapEnabled={snapEnabled}
                onToggleSnap={() => setSnapEnabled(!snapEnabled)}
                onHtmlExport={handleHtmlExport}
                showBarLabels={showBarLabels}
                onToggleBarLabels={() => setShowBarLabels(!showBarLabels)}
                showBarDates={showBarDates}
                onToggleBarDates={() => setShowBarDates(!showBarDates)}
                chartTheme={chartTheme}
                onThemeChange={handleThemeChange}
            />

            <div className="main-content">
                {isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--color-text-secondary)', fontSize: '15px', gap: '10px' }}>
                        <span>⏳</span> 데이터 불러오는 중...
                    </div>
                ) : (
                    <>
                {(viewMode === 'table' || viewMode === 'split') && (
                    <TableView
                        tasks={filteredTasks}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onUpdateTask={handleUpdateTask}
                        onUpdateTasks={handleUpdateMultipleTasks}
                        onDeleteTask={handleDeleteTask}
                        onAddTask={handleAddTask}
                        onReorderTasks={handleReorderTasks}
                        onIndentTask={handleIndentTask}
                        onOutdentTask={handleOutdentTask}
                        onMoveTask={handleMoveTask}
                        onContextMenu={handleContextMenu}
                        viewMode={viewMode}
                    />
                )}

                {(viewMode === 'timeline' || viewMode === 'split') && (
                    <TimelineView
                        ref={timelineRef}
                        tasks={filteredTasks}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onUpdateTask={handleUpdateTask}
                        onUpdateTasks={handleUpdateMultipleTasks}
                        onDeleteTask={handleDeleteTask}
                        onAddTask={handleAddTask}
                        onMoveTask={handleMoveTask}
                        onIndentTask={handleIndentTask}
                        onOutdentTask={handleOutdentTask}
                        onContextMenu={handleContextMenu}
                        timeScale={timeScale}
                        viewMode={viewMode}
                        zoomLevel={zoomLevel}
                        showToday={showToday}
                        isCompact={isCompact}
                        showTaskNames={showTaskNames}
                        snapEnabled={snapEnabled}
                        showBarLabels={showBarLabels}
                        showBarDates={showBarDates}
                        onOpenMilestoneAdd={setMilestoneModalInfo}
                        toast={toast}
                        chartTheme={chartTheme}
                        darkMode={darkMode}
                    />
                )}
                    </>
                )}
            </div>

            {/* 작업 설정 팝오버 (전역) */}
            {popoverInfo && (() => {
                const flatList = flattenTasks(tasks);
                const targetTask = flatList.find(t => t.id === popoverInfo.taskId);
                if (!targetTask) return null;

                // 모든 엔티티 (작업 + 마일스톤) 수집
                // 모든 엔티티 (작업 + 마일스톤 + 타임레인지) 수집
                const allMilestones = flatList.flatMap(t => (t.milestones || []).map(m => ({ ...m, type: 'milestone', parentId: t.id, name: m.label || 'Milestone' })));
                const allRanges = flatList.flatMap(t => (t.timeRanges || []).map((r, i) => ({
                    ...r,
                    type: 'range',
                    parentId: t.id,
                    name: r.label || `${t.name} (Period ${i + 1})`
                })));
                const allEntities = [...flatList, ...allMilestones, ...allRanges];

                let targetDependencies = targetTask.dependencies || [];
                let targetId = targetTask.id;

                if (popoverInfo.rangeId) {
                    const range = (targetTask.timeRanges || []).find(r => r.id === popoverInfo.rangeId);
                    if (range) {
                        targetDependencies = range.dependencies || [];
                        targetId = range.id;
                    }
                }

                const preds = allEntities.filter(e => targetDependencies.includes(e.id));
                // Successors: entities that have targetId in THEIR dependencies
                const succs = allEntities.filter(e => {
                    // Check direct dependencies only (Legacy Task or specific Range/Milestone)
                    return (e.dependencies || []).includes(targetId);
                });

                return (
                    <TimelineBarPopover
                        position={{ x: popoverInfo.x, y: popoverInfo.y }}
                        task={targetTask}
                        clickedDate={popoverInfo.date}
                        clickedRangeId={popoverInfo.rangeId}
                        predecessors={preds}
                        successors={succs}
                        onClose={closePopover}
                        onUpdate={handlePopoverUpdate}
                        onDelete={handlePopoverDelete}
                        onAddMilestone={handlePopoverAddMilestone}
                        onStartLinking={() => {
                            if (timelineRef.current) {
                                // Link from specific range if selected, else task
                                const sourceId = popoverInfo.rangeId || targetTask.id;
                                timelineRef.current.startLinking(sourceId);
                            }
                            closePopover();
                        }}
                        onAddTimeRange={(taskId, date) => {
                            const newRanges = [...(targetTask.timeRanges || [])];
                            if (newRanges.length === 0 && (targetTask.startDate || targetTask.endDate)) {
                                // 기존 데이터 마이그레이션 (혹시 안된 경우)
                                newRanges.push({
                                    id: generateId(),
                                    startDate: targetTask.startDate,
                                    endDate: targetTask.endDate
                                });
                            }

                            // 1일 길이의 새 기간 추가
                            const start = new Date(date);
                            const end = new Date(date);
                            newRanges.push({
                                id: generateId(),
                                startDate: start.toISOString().split('T')[0],
                                endDate: end.toISOString().split('T')[0]
                            });

                            // 전체 시작/종료일 업데이트
                            const bounds = recalcTaskBounds(newRanges);

                            handlePopoverUpdate(taskId, {
                                timeRanges: newRanges,
                                ...bounds,
                            });
                        }}
                        onRemoveDependency={(holderId, dependencyId) => {
                            // holderId: 의존성을 보유한 엔티티 (Task/Range/Milestone ID)
                            // dependencyId: holder의 dependencies에서 제거할 ID
                            const flatList = flattenTasks(tasks);
                            const owner = findOwnerOfEntity(flatList, holderId);
                            if (!owner) return;

                            const stripDep = (deps) => (deps || []).filter(id => id !== dependencyId);

                            if (owner.kind === 'task') {
                                handleUpdateTask(holderId, { dependencies: stripDep(owner.task.dependencies) });
                            } else if (owner.kind === 'range') {
                                const newRanges = owner.task.timeRanges.map(r =>
                                    r.id === holderId ? { ...r, dependencies: stripDep(r.dependencies) } : r
                                );
                                handleUpdateTask(owner.task.id, { timeRanges: newRanges });
                            } else if (owner.kind === 'milestone') {
                                const newMilestones = owner.task.milestones.map(m =>
                                    m.id === holderId ? { ...m, dependencies: stripDep(m.dependencies) } : m
                                );
                                handleUpdateTask(owner.task.id, { milestones: newMilestones });
                            }
                        }}
                    />
                );
            })()}

            {/* 마일스톤 추가 모달 */}
            {milestoneModalInfo && (
                <MilestoneQuickAdd
                    task={milestoneModalInfo.task}
                    date={milestoneModalInfo.date}
                    onClose={() => setMilestoneModalInfo(null)}
                    onAdd={handleAddMilestone}
                />
            )}


            <PromptGuideModal
                isOpen={isPromptGuideOpen}
                onClose={() => setIsPromptGuideOpen(false)}
                toast={toast}
            />

            {/* 저장/불러오기 모달 */}
            <SaveLoadModal
                isOpen={isSaveLoadModalOpen}
                onClose={() => setIsSaveLoadModalOpen(false)}
                onLoad={(data) => {
                    processImportedData(data, false);
                }}
                currentData={tasks}
                onExportSnapshot={handleSnapshotExport}
                toast={toast}
            />
            <ImportExportModal
                isOpen={!!ieModalMode}
                onClose={() => {
                    setIeModalMode(null);
                    setCustomExportData(null);
                }}
                mode={ieModalMode}
                onImport={handleImport}
                onExport={handleExport}
                currentData={ieModalMode === 'EXPORT' ? (customExportData || getExportDataObject()) : null}
                toast={toast}
            />

            {/* 토스트 알림 */}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

export default App;
