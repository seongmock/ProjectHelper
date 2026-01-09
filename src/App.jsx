import { useState, useEffect, useCallback, useRef } from 'react';
import { getSampleData, createNewTask, generateId, flattenTasks } from './utils/dataModel';
import { storage } from './utils/storage';
import { useUndoRedo } from './hooks/useUndoRedo';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import TableView from './components/TableView';
import TimelineView from './components/TimelineView';
import PromptGuideModal from './components/PromptGuideModal';
import ImportExportModal from './components/ImportExportModal';
import './App.css';

function App() {
    // 뷰 모드: 'table', 'timeline', 'split'
    const [viewMode, setViewMode] = useState('timeline');

    // 타임스케일 및 타임라인 설정: localStorage에서 초기화
    const [timeScale, setTimeScale] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.timeScale || 'monthly';
    });
    const [zoomLevel, setZoomLevel] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.zoomLevel || 1.0;
    });
    const [showToday, setShowToday] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.showToday !== undefined ? saved.showToday : true;
    });
    const [isCompact, setIsCompact] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.isCompact || false;
    });
    const [showTaskNames, setShowTaskNames] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.showTaskNames !== undefined ? saved.showTaskNames : true;
    });
    const [snapEnabled, setSnapEnabled] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.snapEnabled !== undefined ? saved.snapEnabled : true;
    });

    // 다크모드
    const [darkMode, setDarkMode] = useState(() => {
        const saved = storage.loadSettings();
        if (saved && saved.darkMode !== undefined) {
            return saved.darkMode;
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
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

    // 초기 데이터 로드
    const getInitialData = () => {
        const saved = storage.loadData();
        if (!saved) return getSampleData();

        // 신버전 데이터 구조 (meta, data) 지원
        if (saved.data && Array.isArray(saved.data)) {
            return saved.data;
        }

        // 구버전 데이터 구조 (배열)
        if (Array.isArray(saved)) {
            return saved;
        }

        return getSampleData();
    };

    // 프로젝트 데이터 (실행 취소/다시 실행 지원)
    const {
        state: tasks,
        setState: setTasks,
        setStateSilent: setTasksSilent, // 드래그 중 임시 업데이트용
        undo,
        redo,
        canUndo,
        canRedo,
    } = useUndoRedo(getInitialData());

    // localStorage에 자동 저장
    useEffect(() => {
        storage.saveData(tasks);
    }, [tasks]);

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
            snapEnabled
        });
    }, [timeScale, zoomLevel, showToday, isCompact, showTaskNames, snapEnabled]);

    // 키보드 단축키
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ctrl+Z: 실행 취소
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            // Ctrl+Y or Ctrl+Shift+Z: 다시 실행
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                redo();
            }
            // Ctrl+S: 내보내기
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                handleExport();
            }
            // Ctrl+N: 새 작업 추가
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                handleAddTask();
            }

        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, selectedTaskId]);

    // 작업 추가
    const handleAddTask = useCallback((parentId = null) => {
        const newTask = createNewTask('새 작업', parentId);

        if (parentId) {
            // 하위 작업 추가
            const addToParent = (items) => {
                return items.map(item => {
                    if (item.id === parentId) {
                        return {
                            ...item,
                            children: [...item.children, newTask],
                            expanded: true,
                        };
                    }
                    if (item.children.length > 0) {
                        return {
                            ...item,
                            children: addToParent(item.children),
                        };
                    }
                    return item;
                });
            };
            setTasks(addToParent(tasks));
        } else {
            // 최상위 작업 추가
            setTasks([...tasks, newTask]);
        }

        setSelectedTaskId(newTask.id);
    }, [tasks, setTasks]);

    // 작업 업데이트
    const handleUpdateTask = useCallback((taskId, updates, addToHistory = false) => {
        const updateFunc = (prevTasks) => {
            return prevTasks.map(task => {
                if (task.id === taskId) {
                    return { ...task, ...updates };
                }
                if (task.children) {
                    return {
                        ...task,
                        children: task.children.map(child => {
                            if (child.id === taskId) {
                                return { ...child, ...updates };
                            }
                            if (child.children) {
                                return {
                                    ...child,
                                    children: child.children.map(grandchild =>
                                        grandchild.id === taskId ? { ...grandchild, ...updates } : grandchild
                                    ),
                                };
                            }
                            return child;
                        }),
                    };
                }
                return task;
            });
        };

        // 드래그 중이든 완료든 항상 setTasks 사용
        // 드래그 완료 시에만 실제 히스토리에 기록됨
        setTasks(updateFunc);
    }, [setTasks]);

    // 여러 작업 동시 업데이트 처리 (Undo/Redo를 위해 한 번의 상태 변경으로 처리)
    const handleUpdateMultipleTasks = useCallback((updatesArray, addToHistory = true) => {
        const updateFunc = (prevTasks) => {
            let newTasks = [...prevTasks];

            updatesArray.forEach(({ taskId, updates }) => {
                newTasks = newTasks.map(task => {
                    if (task.id === taskId) {
                        return { ...task, ...updates };
                    }
                    if (task.children) {
                        return {
                            ...task,
                            children: updateSubtasks(task.children, taskId, updates)
                        };
                    }
                    return task;
                });
            });
            return newTasks;
        };

        // 재귀 업데이트 헬퍼
        const updateSubtasks = (tasks, targetId, updates) => {
            return tasks.map(task => {
                if (task.id === targetId) {
                    return { ...task, ...updates };
                }
                if (task.children) {
                    return { ...task, children: updateSubtasks(task.children, targetId, updates) };
                }
                return task;
            });
        };

        setTasks(updateFunc);
    }, [setTasks]);

    // 작업 삭제
    const handleDeleteTask = useCallback((taskId) => {
        const deleteTask = (items) => {
            return items.filter(item => {
                if (item.id === taskId) return false;
                if (item.children.length > 0) {
                    item.children = deleteTask(item.children);
                }
                return true;
            });
        };
        setTasks(deleteTask(tasks));
        setSelectedTaskId(null);
    }, [tasks, setTasks]);

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

                if (items[i].children.length > 0) {
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
            if (items[i].children.length > 0) {
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
            const clonedTasks = JSON.parse(JSON.stringify(prevTasks));

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
                if (items[i].children.length > 0) {
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

                if (items[i].children.length > 0) {
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
        const exportData = getExportDataObject();
        const timestamp = new Date().toISOString().slice(0, 10);
        storage.exportData(exportData, `project-timeline-${timestamp}.json`);
    }, [getExportDataObject]);

    // 가져오기
    const handleImport = useCallback((file, isMerge = false) => {
        storage.importData(file)
            .then(importedData => {
                let newTasks = [];

                if (Array.isArray(importedData)) {
                    // 구버전 호환 (배열인 경우)
                    newTasks = importedData;
                } else if (importedData.data && Array.isArray(importedData.data)) {
                    // 신버전 (메타데이터 포함)
                    newTasks = importedData.data;

                    // 덮어쓰기 모드일 때만 뷰 설정 복원
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
                    // 병합 모드: ID 재생성 후 추가
                    const regenerateIds = (items) => {
                        return items.map(item => {
                            const newId = generateId();
                            // 자식들도 재귀적으로 ID 변경
                            const newChildren = item.children ? regenerateIds(item.children) : [];

                            // 마일스톤 ID도 변경
                            const newMilestones = item.milestones ? item.milestones.map(ms => ({
                                ...ms,
                                id: generateId()
                            })) : [];

                            return {
                                ...item,
                                id: newId,
                                children: newChildren,
                                milestones: newMilestones,
                                // 의존성은 ID가 바뀌면 깨지므로 일단 초기화하거나, 
                                // 매핑 테이블을 만들어서 변환해야 함. 
                                // 여기서는 간단히 병합 시 의존성 링크는 해제하는 것으로 처리 (복잡도 관리)
                                dependencies: []
                            };
                        });
                    };

                    const processedTasks = regenerateIds(newTasks);
                    setTasks(prev => [...prev, ...processedTasks]);
                    alert('데이터가 성공적으로 병합되었습니다.');
                } else {
                    // 덮어쓰기 모드
                    setTasks(newTasks);
                    alert('데이터를 성공적으로 가져왔습니다.');
                }
            })
            .catch(error => {
                console.error('Failed to import data:', error);
                alert('데이터 가져오기에 실패했습니다.');
            });
    }, [setTasks]);

    // 필터링된 작업 (검색어 적용)
    const filteredTasks = useCallback(() => {
        if (!searchQuery.trim()) return tasks;

        const filterTasks = (items) => {
            return items.filter(item => {
                const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
                const hasMatchingChildren = item.children.length > 0 && filterTasks(item.children).length > 0;

                if (matchesSearch || hasMatchingChildren) {
                    return true;
                }
                return false;
            }).map(item => ({
                ...item,
                children: filterTasks(item.children),
            }));
        };

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
                snapEnabled={snapEnabled}
                darkMode={darkMode}
                onToggleSnap={() => setSnapEnabled(!snapEnabled)}
            />

            <div className="main-content">
                {(viewMode === 'table' || viewMode === 'split') && (
                    <TableView
                        tasks={filteredTasks()}
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
                        viewMode={viewMode}
                    />
                )}

                {(viewMode === 'timeline' || viewMode === 'split') && (
                    <TimelineView
                        ref={timelineRef}
                        tasks={filteredTasks()}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onUpdateTask={handleUpdateTask}
                        onUpdateTasks={handleUpdateMultipleTasks}
                        onMoveTask={handleMoveTask}
                        onIndentTask={handleIndentTask}
                        onOutdentTask={handleOutdentTask}
                        timeScale={timeScale}
                        viewMode={viewMode}
                        // 상태 전달
                        zoomLevel={zoomLevel}
                        showToday={showToday}
                        isCompact={isCompact}
                        showTaskNames={showTaskNames}
                        snapEnabled={snapEnabled}
                    />
                )}
            </div>
            <ImportExportModal
                isOpen={!!ieModalMode}
                onClose={() => setIeModalMode(null)}
                mode={ieModalMode}
                onImport={handleImport}
                onExport={handleExport}
                currentData={ieModalMode === 'EXPORT' ? getExportDataObject() : null}
            />
            <PromptGuideModal
                isOpen={isPromptGuideOpen}
                onClose={() => setIsPromptGuideOpen(false)}
            />
        </div>
    );
}

export default App;
