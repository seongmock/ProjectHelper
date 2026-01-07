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

    // 초기 데이터 로드
    const getInitialData = () => {
        const saved = storage.loadData();
        return saved || getSampleData();
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

    // 내보내기
    const handleExport = useCallback(() => {
        const timestamp = new Date().toISOString().split('T')[0];
        storage.exportData(tasks, `project-timeline-${timestamp}.json`);
    }, [tasks]);

    // 가져오기
    const handleImport = useCallback((file) => {
        storage.importData(file)
            .then(data => {
                setTasks(data);
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

    // 타임라인 뷰 상태 (Toolbar로 이동)
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [showToday, setShowToday] = useState(true);
    const [isCompact, setIsCompact] = useState(false);
    const [showTaskNames, setShowTaskNames] = useState(true);
    const timelineRef = useRef(null);

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
