import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSampleData, createNewTask, generateId, flattenTasks, migrateTaskData } from './utils/dataModel';
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
                if (serverSettings) {
                    if (serverSettings.timeScale) setTimeScale(serverSettings.timeScale);
                    if (serverSettings.zoomLevel) setZoomLevel(serverSettings.zoomLevel);
                    if (serverSettings.showToday !== undefined) setShowToday(serverSettings.showToday);
                    if (serverSettings.isCompact !== undefined) setIsCompact(serverSettings.isCompact);
                    if (serverSettings.showTaskNames !== undefined) setShowTaskNames(serverSettings.showTaskNames);
                    if (serverSettings.snapEnabled !== undefined) setSnapEnabled(serverSettings.snapEnabled);
                    if (serverSettings.showBarLabels !== undefined) setShowBarLabels(serverSettings.showBarLabels);
                    if (serverSettings.showBarDates !== undefined) setShowBarDates(serverSettings.showBarDates);
                    if (serverSettings.darkMode !== undefined) setDarkMode(serverSettings.darkMode);
                    if (serverSettings.chartTheme) setChartTheme(serverSettings.chartTheme);
                }

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

    // 자동 저장 — 1.5초 debounce (매 변경마다 서버 요청 방지)
    useEffect(() => {
        if (isLoading) return; // 초기 로드 중에는 저장하지 않음
        const timer = setTimeout(() => {
            storage.saveData(tasks);
        }, 1500);
        return () => clearTimeout(timer);
    }, [tasks, isLoading]);

    // 다크모드 설정 저장
    // 다크모드 변경 시 DOM 적용
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }, [darkMode]);

    // 시스템 다크모드 설정 감지
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = (e) => {
            const saved = storage.loadSettings();
            // 사용자 설정이 없을 때만 시스템 설정 따름
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
    useEffect(() => {
        const settings = storage.loadSettings() || {};
        storage.saveSettings({
            ...settings,
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
    }, [timeScale, zoomLevel, showToday, isCompact, showTaskNames, snapEnabled, showBarLabels, showBarDates, chartTheme]);

    // 테마 변경 핸들러
    const handleThemeChange = useCallback((newTheme) => {
        setChartTheme(newTheme);
        storage.saveSettings({ chartTheme: newTheme });
    }, []);

    // 작업 추가
    const handleAddTask = useCallback((parentId = null) => {
        const newTask = createNewTask('새 작업', parentId);

        setTasks(prevTasks => {
            if (parentId) {
                const addToParent = (items) =>
                    items.map(item => {
                        if (item.id === parentId) {
                            return { ...item, children: [...item.children, newTask], expanded: true };
                        }
                        if (item.children && item.children.length > 0) {
                            return { ...item, children: addToParent(item.children) };
                        }
                        return item;
                    });
                return addToParent(prevTasks);
            }
            return [...prevTasks, newTask];
        });

        setSelectedTaskId(newTask.id);
    }, [setTasks]);

    // 재귀적으로 특정 작업을 업데이트하는 헬퍼 (깊이 제한 없음)
    const updateTaskInTree = useCallback((items, taskId, updates) => {
        return items.map(task => {
            if (task.id === taskId) {
                return { ...task, ...updates };
            }
            if (task.children && task.children.length > 0) {
                return { ...task, children: updateTaskInTree(task.children, taskId, updates) };
            }
            return task;
        });
    }, []);

    // 작업 업데이트
    const handleUpdateTask = useCallback((taskId, updates) => {
        setTasks(prevTasks => updateTaskInTree(prevTasks, taskId, updates));
    }, [setTasks, updateTaskInTree]);

    // 여러 작업 동시 업데이트 처리 (Undo/Redo를 위해 한 번의 상태 변경으로 처리)
    const handleUpdateMultipleTasks = useCallback((updatesArray) => {
        setTasks(prevTasks => {
            return updatesArray.reduce(
                (acc, { taskId, updates }) => updateTaskInTree(acc, taskId, updates),
                prevTasks
            );
        });
    }, [setTasks, updateTaskInTree]);

    // 작업 삭제 (불변 재귀 — 원본 객체 직접 변경 없음)
    const handleDeleteTask = useCallback((taskId) => {
        const deleteFromTree = (items) =>
            items
                .filter(item => item.id !== taskId)
                .map(item => ({
                    ...item,
                    children: deleteFromTree(item.children),
                }));

        setTasks(prev => deleteFromTree(prev));
        setSelectedTaskId(null);
    }, [setTasks]);

    // 팝오버 액션 핸들러들 (순서 변경됨)
    const handlePopoverUpdate = useCallback((id, updates) => {
        handleUpdateTask(id, updates, true);
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
        const indentTask = (items) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === taskId) {
                    if (i === 0) return items; // 첫 번째 항목은 들여쓰기 불가

                    const prevSibling = items[i - 1];
                    const taskToMove = items[i];

                    const newItems = [...items];
                    newItems.splice(i, 1); // 현재 위치에서 제거

                    // 이전 형제의 자식으로 추가
                    const updatedPrevSibling = {
                        ...prevSibling,
                        children: [...prevSibling.children, taskToMove],
                        expanded: true // 부모가 되면 자동 확장
                    };

                    newItems[i - 1] = updatedPrevSibling;
                    return newItems;
                }

                if (items[i].children && items[i].children.length > 0) {
                    const updatedChildren = indentTask(items[i].children);
                    if (updatedChildren !== items[i].children) {
                        return items.map((item, index) =>
                            index === i ? { ...item, children: updatedChildren } : item
                        );
                    }
                }
            }
            return items;
        };

        setTasks(prevTasks => indentTask(prevTasks));
    }, [setTasks]);

    // 작업/트리 검색을 위한 헬퍼 함수
    const findTaskAndParent = (items, taskId, parent = null) => {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === taskId) {
                return { task: items[i], parent, index: i, list: items };
            }
            if (items[i].children && items[i].children.length > 0) {
                const result = findTaskAndParent(items[i].children, taskId, items[i]);
                if (result) return result;
            }
        }
        return null;
    };

    // 작업 이동 핸들러 (DnD)
    const handleMoveTask = useCallback((activeId, overId) => {
        setTasks((prevTasks) => {
            const activeInfo = findTaskAndParent(prevTasks, activeId);
            const overInfo = findTaskAndParent(prevTasks, overId);

            if (!activeInfo || !overInfo) return prevTasks;

            // 같은 항목이면 무시
            if (activeId === overId) return prevTasks;

            const newTasks = [...prevTasks];

            // 1. 기존 위치에서 제거 (주의: 불변성 유지를 위해 깊은 복사 필요)
            // 간단하게 하기 위해 전체 트리를 다시 빌드하는 대신,
            // findTaskAndParent가 반환한 list를 수정하면 원본 참조를 수정하게 됨 (안됨).
            // 따라서 재귀적으로 새로운 트리를 만들어야 함.

            // 하지만 복잡성을 줄이기 위해 deep clone 후 처리
            const clonedTasks = structuredClone(prevTasks);

            // 클론된 데이터에서 다시 찾기
            const activeNode = findTaskAndParent(clonedTasks, activeId);
            const overNode = findTaskAndParent(clonedTasks, overId);

            if (!activeNode || !overNode) return prevTasks;

            // 순환 참조 방지: overNode가 activeNode의 자손인지 확인
            const isDescendant = (parent, targetId) => {
                if (!parent.children) return false;
                for (const child of parent.children) {
                    if (child.id === targetId) return true;
                    if (isDescendant(child, targetId)) return true;
                }
                return false;
            };

            if (isDescendant(activeNode.task, overId)) {
                return prevTasks; // 자손으로 이동 불가
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
                // overId의 최상위 조상 찾기 (위쪽으로 탐색하여 레벨 0 찾기)
                // 평탄화된 리스트에서 overIndex 위쪽으로 탐색
                for (let i = overGlobalIndex; i >= 0; i--) {
                    if (flatList[i].level === 0) {
                        effectiveOverId = flatList[i].id;
                        overGlobalIndex = i; // 인덱스도 업데이트
                        break;
                    }
                }

                // 타겟 변경 감지 시 노드 정보 재검색 (activeNode는 이미 메모리상 트리에서 삭제된 상태여야 함?
                // 아니, 여기는 아직 삭제 전 로직임. activeNode.list.splice는 아래에서 함.)
                // 순서 주의: activeNode 제거 전에 targetNode를 찾으면 참조 오류 가능성?
                // 아니, findTaskAndParent는 clonedTasks에서 찾음. activeNode 제거 전임.
            }

            const isMovingDown = activeGlobalIndex < overGlobalIndex;

            // 제거
            activeNode.list.splice(activeNode.index, 1);

            // 타겟이 변경되었다면 다시 찾기 (activeNode 제거 후에도 유효한지? effectiveOverId는 Root이므로 유효)
            if (effectiveOverId !== overId) {
                // activeNode가 Root였고 제거되었음.
                // effectiveOverId가 overId(Child)의 Root Ancestor임.
                // 만약 activeId === effectiveOverId 였다면? (자신 자식으로 드래그?)
                // isDescendant 체크에서 걸러졌으므로 괜찮음.

                // clonedTasks에서 다시 찾기
                // activeNode가 제거된 상태의 clonedTasks에서.
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
        let taskToMove = null;

        // 1. 이동할 작업 찾기 및 제거
        const removeTask = (items) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === taskId) {
                    taskToMove = items[i];
                    const newItems = [...items];
                    newItems.splice(i, 1);
                    return newItems;
                }
                if (items[i].children && items[i].children.length > 0) {
                    const updatedChildren = removeTask(items[i].children);
                    if (updatedChildren !== items[i].children) {
                        return items.map((item, index) =>
                            index === i ? { ...item, children: updatedChildren } : item
                        );
                    }
                }
            }
            return items;
        };

        // 2. 부모의 형제로 추가
        const insertTask = (items) => {
            for (let i = 0; i < items.length; i++) {
                // 자식 중에 제거된 작업이 있었던 부모를 찾음 (이 부분은 removeTask와 로직이 겹치므로 최적화 필요하지만, 
                // 불변성 유지를 위해 전체 트리를 순회하며 재구성하는 방식이 안전함)

                // 하지만 위 removeTask에서 이미 제거를 했으므로, 여기서는 
                // "원래 부모였던 항목"을 찾는 것이 아니라, 
                // "제거된 작업이 어디에 있었는지"를 알고 그 부모의 다음 위치에 넣어야 함.
                // 따라서 로직을 분리하지 않고 한 번에 처리하는 것이 좋음.
            }
            return items;
        };

        // 재귀적으로 처리하는 단일 함수
        const outdentTaskRecursive = (items, parent = null) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === taskId) {
                    // 최상위 레벨이면 내어쓰기 불가
                    if (!parent) return items;

                    // 여기서 찾았음. 반환값으로 "이 항목을 제거하고, 부모 레벨에서 처리하도록 신호"를 보내야 함
                    // 하지만 구조상 복잡하므로, 부모를 찾는 방식 변경
                    return { found: true, task: items[i], index: i };
                }

                if (items[i].children && items[i].children.length > 0) {
                    const result = outdentTaskRecursive(items[i].children, items[i]);

                    // 자식에서 찾았고, 결과가 배열이 아니라 객체라면 (작업을 찾음)
                    if (result && result.found) {
                        const task = result.task;

                        // 현재 items[i]가 부모임.
                        // 1. 자식 목록에서 해당 작업 제거
                        const newChildren = [...items[i].children];
                        newChildren.splice(result.index, 1);

                        // 2. 현재 부모(items[i]) 바로 뒤에 작업 추가해야 하는데,
                        // 이는 현재 레벨(items)에서 처리해야 함.
                        // 따라서 여기서도 "작업을 찾았고, 내 자식에서 뺐으며, 내 뒤에 붙여야 한다"는 신호를 위로 보내야 함?
                        // 아니면 여기서 바로 처리가 안됨 (내 뒤에 붙이는 건 내 부모가 해야 함).

                        // 내어쓰기는 "현재 부모의 자식에서 빼서, 현재 부모의 형제로 만드는 것"
                        // 즉, items[i]의 자식에서 빼서, items 배열의 i+1 위치에 넣어야 함.

                        const updatedParent = { ...items[i], children: newChildren };

                        const newItems = [...items];
                        newItems[i] = updatedParent;
                        newItems.splice(i + 1, 0, task);

                        return newItems;
                    }

                    // 이미 처리되어 배열이 반환된 경우 (더 상위 레벨로 전파)
                    if (Array.isArray(result) && result !== items[i].children) {
                        return items.map((item, index) =>
                            index === i ? { ...item, children: result } : item
                        );
                    }
                }
            }
            return items;
        };

        setTasks(prevTasks => {
            const result = outdentTaskRecursive(prevTasks);
            // 최상위 레벨에서 객체가 반환되면 (루트의 자식이 내어쓰기 시도됨 -> 불가)
            if (!Array.isArray(result) && result.found) return prevTasks;
            return result;
        });

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
    }, [tasks, viewMode, timeScale, zoomLevel, showToday, isCompact, showTaskNames, darkMode]);

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
    }, [tasks, darkMode, zoomLevel, showToday, showBarLabels, showBarDates, timeScale, isCompact, toast]);

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
                    if (settings.viewMode) setViewMode(settings.viewMode);
                    if (settings.timeScale) setTimeScale(settings.timeScale);
                    if (settings.zoomLevel) setZoomLevel(settings.zoomLevel);
                    if (settings.showToday !== undefined) setShowToday(settings.showToday);
                    if (settings.isCompact !== undefined) setIsCompact(settings.isCompact);
                    if (settings.showTaskNames !== undefined) setShowTaskNames(settings.showTaskNames);
                    if (settings.snapEnabled !== undefined) setSnapEnabled(settings.snapEnabled);
                    if (settings.darkMode !== undefined) {
                        setDarkMode(settings.darkMode);
                        storage.saveSettings({ darkMode: settings.darkMode });
                    }
                }
            } else {
                throw new Error('Invalid data format');
            }

            if (isMerge) {
                const regenerateIds = (items) => {
                    return items.map(item => {
                        const newId = generateId();
                        const newChildren = item.children ? regenerateIds(item.children) : [];
                        const newMilestones = item.milestones ? item.milestones.map(ms => ({
                            ...ms,
                            id: generateId()
                        })) : [];
                        return {
                            ...item,
                            id: newId,
                            children: newChildren,
                            milestones: newMilestones,
                            dependencies: []
                        };
                    });
                };

                const processedTasks = regenerateIds(newTasks);
                setTasks(prev => [...prev, ...processedTasks]);
            } else {
                setTasks(newTasks);
            }
        } catch (error) {
            console.error('Failed to process data:', error);
            toast.error('데이터 처리 중 오류가 발생했습니다.');
        }
    }, [setViewMode, setTimeScale, setZoomLevel, setShowToday, setIsCompact, setShowTaskNames, setSnapEnabled, setDarkMode, setTasks, toast]);

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
                            const allStarts = newRanges.map(r => new Date(r.startDate).getTime());
                            const allEnds = newRanges.map(r => new Date(r.endDate).getTime());
                            const minStart = new Date(Math.min(...allStarts));
                            const maxEnd = new Date(Math.max(...allEnds));

                            handlePopoverUpdate(taskId, {
                                timeRanges: newRanges,
                                startDate: minStart.toISOString().split('T')[0],
                                endDate: maxEnd.toISOString().split('T')[0]
                            });
                        }}
                        onRemoveDependency={(holderId, dependencyId) => {
                            // holderId: The entity holding the dependency (Task/Range/Milestone ID)
                            // dependencyId: The ID to remove from holder's dependencies
                            const flatList = flattenTasks(tasks);

                            // 1. Check if holder is Task
                            let holderTask = flatList.find(t => t.id === holderId);
                            if (holderTask) {
                                const newDeps = (holderTask.dependencies || []).filter(id => id !== dependencyId);
                                handleUpdateTask(holderId, { dependencies: newDeps });
                                return;
                            }

                            // 2. Check if holder is Range
                            holderTask = flatList.find(t => t.timeRanges && t.timeRanges.some(r => r.id === holderId));
                            if (holderTask) {
                                const newRanges = holderTask.timeRanges.map(r => {
                                    if (r.id === holderId) {
                                        return { ...r, dependencies: (r.dependencies || []).filter(id => id !== dependencyId) };
                                    }
                                    return r;
                                });
                                handleUpdateTask(holderTask.id, { timeRanges: newRanges });
                                return;
                            }

                            // 3. Check if holder is Milestone
                            holderTask = flatList.find(t => t.milestones && t.milestones.some(m => m.id === holderId));
                            if (holderTask) {
                                const newMilestones = holderTask.milestones.map(m => {
                                    if (m.id === holderId) {
                                        return { ...m, dependencies: (m.dependencies || []).filter(id => id !== dependencyId) };
                                    }
                                    return m;
                                });
                                handleUpdateTask(holderTask.id, { milestones: newMilestones });
                                return;
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
