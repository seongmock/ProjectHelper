import { useState, useEffect, useCallback, useRef } from 'react';
import { getSampleData, createNewTask } from './utils/dataModel';
import { storage } from './utils/storage';
import { useUndoRedo } from './hooks/useUndoRedo';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import TableView from './components/TableView';
import TimelineView from './components/TimelineView';
import './App.css';

function App() {
    // 뷰 모드: 'table', 'timeline', 'split'
    const [viewMode, setViewMode] = useState('timeline');

    // 타임스케일: 'monthly', 'quarterly'
    const [timeScale, setTimeScale] = useState('monthly');

    // 다크모드
    const [darkMode, setDarkMode] = useState(() => {
        const saved = storage.loadSettings();
        return saved?.darkMode || false;
    });

    // 검색 쿼리
    const [searchQuery, setSearchQuery] = useState('');

    // 선택된 작업
    const [selectedTaskId, setSelectedTaskId] = useState(null);

    // 타임라인 뷰 상태
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [showToday, setShowToday] = useState(true);
    const [isCompact, setIsCompact] = useState(false);
    const [showTaskNames, setShowTaskNames] = useState(true);
    const timelineRef = useRef(null);

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
    useEffect(() => {
        storage.saveSettings({ darkMode });
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }, [darkMode]);

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
            // Delete: 선택 항목 삭제
            if (e.key === 'Delete' && selectedTaskId) {
                e.preventDefault();
                handleDeleteTask(selectedTaskId);
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
    const handleUpdateTask = useCallback((taskId, updates) => {
        const updateTask = (items) => {
            return items.map(item => {
                if (item.id === taskId) {
                    return { ...item, ...updates };
                }
                if (item.children.length > 0) {
                    return {
                        ...item,
                        children: updateTask(item.children),
                    };
                }
                return item;
            });
        };
        setTasks(updateTask(tasks));
    }, [tasks, setTasks]);

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

    // 내보내기
    const handleExport = useCallback(() => {
        const timestamp = new Date().toISOString().split('T')[0];

        const exportData = {
            meta: {
                viewSettings: {
                    viewMode,
                    timeScale,
                    zoomLevel,
                    showToday,
                    isCompact,
                    showTaskNames,
                    darkMode
                },
                version: '1.0'
            },
            data: tasks
        };

        storage.exportData(exportData, `project-timeline-${timestamp}.json`);
    }, [tasks, viewMode, timeScale, zoomLevel, showToday, isCompact, showTaskNames, darkMode]);

    // 가져오기
    const handleImport = useCallback((file) => {
        storage.importData(file)
            .then(importedData => {
                if (Array.isArray(importedData)) {
                    // 구버전 호환 (배열인 경우)
                    setTasks(importedData);
                } else if (importedData.data && Array.isArray(importedData.data)) {
                    // 신버전 (메타데이터 포함)
                    setTasks(importedData.data);

                    // 뷰 설정 복원
                    if (importedData.meta && importedData.meta.viewSettings) {
                        const settings = importedData.meta.viewSettings;
                        if (settings.viewMode) setViewMode(settings.viewMode);
                        if (settings.timeScale) setTimeScale(settings.timeScale);
                        if (settings.zoomLevel) setZoomLevel(settings.zoomLevel);
                        if (settings.showToday !== undefined) setShowToday(settings.showToday);
                        if (settings.isCompact !== undefined) setIsCompact(settings.isCompact);
                        if (settings.showTaskNames !== undefined) setShowTaskNames(settings.showTaskNames);
                        if (settings.darkMode !== undefined) setDarkMode(settings.darkMode);
                    }
                } else {
                    throw new Error('Invalid data format');
                }
                alert('데이터를 성공적으로 가져왔습니다.');
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
                onToggleDarkMode={() => setDarkMode(!darkMode)}
                onExport={handleExport}
                onImport={handleImport}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
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
            />

            <div className="main-content">
                {(viewMode === 'table' || viewMode === 'split') && (
                    <TableView
                        tasks={filteredTasks()}
                        selectedTaskId={selectedTaskId}
                        onSelectTask={setSelectedTaskId}
                        onUpdateTask={handleUpdateTask}
                        onDeleteTask={handleDeleteTask}
                        onAddTask={handleAddTask}
                        onReorderTasks={handleReorderTasks}
                        onIndentTask={handleIndentTask}
                        onOutdentTask={handleOutdentTask}
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
                        timeScale={timeScale}
                        viewMode={viewMode}
                        // 상태 전달
                        zoomLevel={zoomLevel}
                        showToday={showToday}
                        isCompact={isCompact}
                        showTaskNames={showTaskNames}
                    />
                )}
            </div>
        </div>
    );
}

export default App;
