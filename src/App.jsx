// 앱 조립부. 상태는 여기 두지 않는다:
//   - 작업 트리       → useUndoRedo
//   - 저장되는 설정   → stores/settingsStore
//   - 화면 상태/모달  → stores/uiStore
//   - 서버 동기화     → hooks/useProjectSync
//   - 트리 조작       → hooks/useTaskActions (로직은 utils/taskTree.js)
//   - 파일 입출력     → hooks/useImportExport
import { useEffect, useCallback, useRef, useMemo } from 'react';
import { getSampleData, generateId, flattenTasks } from './utils/dataModel';
import { recalcTaskBounds, findOwnerOfEntity, collectEntities } from './utils/taskTree';
import { useUndoRedo } from './shared/hooks/useUndoRedo';
import { useToast } from './shared/hooks/useToast';
import { useProjectSync } from './features/projects/useProjectSync';
import { useTaskActions } from './features/tasks/useTaskActions';
import { useTaskKeyboard } from './features/tasks/useTaskKeyboard';
import { useImportExport } from './features/io/useImportExport';
import { useSettingsStore } from './stores/settingsStore';
import { useUiStore } from './stores/uiStore';
import Header from './features/shell/Header';
import Toolbar from './features/shell/Toolbar';
import TableView from './features/table/TableView';
import TimelineView from './features/timeline/TimelineView';
import TimelineBarPopover from './features/timeline/TimelineBarPopover';
import PromptGuideModal from './features/io/PromptGuideModal';
import ImportExportModal from './features/io/ImportExportModal';
import SaveLoadModal from './features/io/SaveLoadModal';
import MilestoneQuickAdd from './features/timeline/MilestoneQuickAdd';
import InspectorPanel from './features/tasks/InspectorPanel';
import ToastContainer from './shared/ui/Toast';
import './themes/themes.css';
import './App.css';

// 스토어 액션은 생성 시점에 고정된다 — 구독할 필요가 없다
const ui = useUiStore.getState();

function App() {
    const { toasts, toast, removeToast } = useToast();
    const timelineRef = useRef(null);

    // ── 설정 ─────────────────────────────────────────
    const timeScale = useSettingsStore(s => s.timeScale);
    const zoomLevel = useSettingsStore(s => s.zoomLevel);
    const showToday = useSettingsStore(s => s.showToday);
    const isCompact = useSettingsStore(s => s.isCompact);
    const showTaskNames = useSettingsStore(s => s.showTaskNames);
    const snapEnabled = useSettingsStore(s => s.snapEnabled);
    const showBarLabels = useSettingsStore(s => s.showBarLabels);
    const showBarDates = useSettingsStore(s => s.showBarDates);
    const chartTheme = useSettingsStore(s => s.chartTheme);
    const colorMode = useSettingsStore(s => s.colorMode);
    const showInspector = useSettingsStore(s => s.showInspector);
    const darkMode = useSettingsStore(s => s.darkMode);
    const setSetting = useSettingsStore(s => s.setSetting);
    const toggleSetting = useSettingsStore(s => s.toggleSetting);

    // ── 화면 상태 ────────────────────────────────────
    const viewMode = useUiStore(s => s.viewMode);
    const setViewMode = useUiStore(s => s.setViewMode);
    const searchQuery = useUiStore(s => s.searchQuery);
    const setSearchQuery = useUiStore(s => s.setSearchQuery);
    const selectedTaskId = useUiStore(s => s.selectedTaskId);
    const setSelectedTaskId = useUiStore(s => s.setSelectedTaskId);
    const popoverInfo = useUiStore(s => s.popoverInfo);
    const openPopover = useUiStore(s => s.openPopover);
    const closePopover = useUiStore(s => s.closePopover);
    const milestoneModalInfo = useUiStore(s => s.milestoneModalInfo);
    const openMilestoneAdd = useUiStore(s => s.openMilestoneAdd);
    const closeMilestoneAdd = useUiStore(s => s.closeMilestoneAdd);
    const isPromptGuideOpen = useUiStore(s => s.isPromptGuideOpen);
    const isSnapshotsOpen = useUiStore(s => s.isSnapshotsOpen);
    const ieModalMode = useUiStore(s => s.ieModalMode);
    const customExportData = useUiStore(s => s.customExportData);

    // ── 작업 트리 (undo/redo) ────────────────────────
    const {
        state: tasks,
        setState: setTasks,
        setStateSilent: setTasksSilent,
        reset: resetTasks,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useUndoRedo(getSampleData()); // 서버 로드 전 임시 샘플

    // 서버/파일에서 온 설정 적용. viewMode 는 서버에 저장되지 않지만 내보내기 파일에는
    // 들어 있어서 여기서 갈라 준다.
    const applyServerSettings = useSettingsStore(s => s.applyServerSettings);
    const importSettings = useSettingsStore(s => s.importSettings);
    const applyLoadedSettings = useCallback((settings) => {
        if (!settings) return;
        if (settings.viewMode) setViewMode(settings.viewMode);
        applyServerSettings(settings);
    }, [setViewMode, applyServerSettings]);
    const applyImportedSettings = useCallback((settings) => {
        if (!settings) return;
        if (settings.viewMode) setViewMode(settings.viewMode);
        importSettings(settings);
    }, [setViewMode, importSettings]);

    // ── 서버 동기화 · 프로젝트 ───────────────────────
    const {
        isLoading,
        projects,
        activeProjectId,
        switchProject,
        createProject,
        renameProject,
        deleteProject,
        refreshProjects,
    } = useProjectSync({
        tasks,
        setTasks,
        setTasksSilent,
        resetTasks,
        applySettings: applyLoadedSettings,
        toast,
        onProjectSwitched: ui.resetViewState,
    });

    // ── 트리 조작 · 파일 입출력 ──────────────────────
    const actions = useTaskActions({ setTasks, setTasksSilent, onSelect: setSelectedTaskId });
    const io = useImportExport({ tasks, setTasks, applySettings: applyImportedSettings, toast });

    // ── 다크모드 ─────────────────────────────────────
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }, [darkMode]);

    const followSystemDarkMode = useSettingsStore(s => s.followSystemDarkMode);
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e) => followSystemDarkMode(e.matches);
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [followSystemDarkMode]);

    // ── 팝오버 ───────────────────────────────────────
    const handleContextMenu = useCallback((e, taskId, date = null, rangeId = null) => {
        e.preventDefault();
        openPopover({
            x: e.clientX,
            y: e.clientY,
            taskId,
            date: date || new Date(), // 날짜 없으면 오늘
            rangeId,
        });
    }, [openPopover]);

    const handlePopoverDelete = useCallback((id) => {
        actions.deleteTask(id);
        closePopover();
    }, [actions, closePopover]);

    const handlePopoverAddMilestone = useCallback(() => {
        if (!popoverInfo) return;
        const target = flattenTasks(tasks).find(t => t.id === popoverInfo.taskId);
        if (target) openMilestoneAdd({ task: target, date: popoverInfo.date });
        closePopover();
    }, [popoverInfo, tasks, openMilestoneAdd, closePopover]);

    const handleAddMilestone = useCallback((taskId, milestoneData) => {
        actions.addMilestone(taskId, milestoneData);
        closeMilestoneAdd();
    }, [actions, closeMilestoneAdd]);

    // ── 키보드 단축키 ────────────────────────────────
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
                io.exportToFile();
            }
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                actions.addTask();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, io, actions]);

    // 검색어 필터 — split 모드에서 중복 계산 방지
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

    // 선택 작업 대상 단축키(↑↓ 선택 이동, [ ] 일정 이동). 검색으로 걸러진 뒤의
    // 목록을 넘긴다 — 화면에 없는 작업으로 선택이 튀면 안 된다.
    useTaskKeyboard({
        tasks: filteredTasks,
        selectedTaskId,
        onSelect: setSelectedTaskId,
        onUpdateTask: actions.updateTask,
        toast,
    });

    return (
        <div className="app">
            <Header
                darkMode={darkMode}
                onToggleDarkMode={() => toggleSetting('darkMode')}
                onExport={() => ui.openExport()}
                onImport={ui.openImport}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onOpenPromptGuide={ui.openPromptGuide}
                onOpenSnapshots={ui.openSnapshots}
                projects={projects}
                activeProjectId={activeProjectId}
                onSwitchProject={switchProject}
                onCreateProject={createProject}
                onRenameProject={renameProject}
                onDeleteProject={deleteProject}
                onOpenProjectList={refreshProjects}
            />

            <Toolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                timeScale={timeScale}
                onTimeScaleChange={(v) => setSetting({ timeScale: v })}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onAddTask={() => actions.addTask()}
                // 타임라인 컨트롤
                zoomLevel={zoomLevel}
                onZoomIn={() => setSetting({ zoomLevel: zoomLevel + 0.1 })}
                onZoomOut={() => setSetting({ zoomLevel: Math.max(zoomLevel - 0.1, 0.1) })}
                showToday={showToday}
                onToggleToday={() => toggleSetting('showToday')}
                isCompact={isCompact}
                onToggleCompact={() => toggleSetting('isCompact')}
                showTaskNames={showTaskNames}
                onToggleTaskNames={() => toggleSetting('showTaskNames')}
                onCopyImage={() => timelineRef.current?.copyToClipboard()}
                snapEnabled={snapEnabled}
                onToggleSnap={() => toggleSetting('snapEnabled')}
                onHtmlExport={io.exportToHtml}
                showBarLabels={showBarLabels}
                onToggleBarLabels={() => toggleSetting('showBarLabels')}
                showBarDates={showBarDates}
                onToggleBarDates={() => toggleSetting('showBarDates')}
                chartTheme={chartTheme}
                onThemeChange={(v) => setSetting({ chartTheme: v })}
                colorMode={colorMode}
                onColorModeChange={(v) => setSetting({ colorMode: v })}
                showInspector={showInspector}
                onToggleInspector={() => toggleSetting('showInspector')}
            />

            <div className="main-content">
                {isLoading ? (
                    <div className="app-loading">
                        <span>⏳</span> 데이터 불러오는 중...
                    </div>
                ) : (
                    <>
                        {(viewMode === 'table' || viewMode === 'split') && (
                            <TableView
                                tasks={filteredTasks}
                                selectedTaskId={selectedTaskId}
                                onSelectTask={setSelectedTaskId}
                                onUpdateTask={actions.updateTask}
                                onUpdateTaskSilent={actions.updateTaskSilent}
                                onUpdateTasks={actions.updateTasks}
                                onDeleteTask={actions.deleteTask}
                                onAddTask={actions.addTask}
                                onReorderTasks={actions.reorderTasks}
                                onIndentTask={actions.indent}
                                onOutdentTask={actions.outdent}
                                onMoveTask={actions.moveTask}
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
                                onUpdateTask={actions.updateTask}
                                onUpdateTaskSilent={actions.updateTaskSilent}
                                onUpdateTasks={actions.updateTasks}
                                onDeleteTask={actions.deleteTask}
                                onAddTask={actions.addTask}
                                onMoveTask={actions.moveTask}
                                onIndentTask={actions.indent}
                                onOutdentTask={actions.outdent}
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
                                onOpenMilestoneAdd={openMilestoneAdd}
                                toast={toast}
                                chartTheme={chartTheme}
                                colorMode={colorMode}
                                darkMode={darkMode}
                            />
                        )}

                        {/* 인스펙터는 검색 필터가 아니라 전체 트리를 본다 —
                            의존성 상대가 필터에 걸려 없어지면 앞뒤 관계가 잘못 보인다 */}
                        {showInspector && (
                            <InspectorPanel
                                tasks={tasks}
                                selectedTaskId={selectedTaskId}
                                onUpdateTask={actions.updateTask}
                                onSelectTask={setSelectedTaskId}
                                onClose={() => toggleSetting('showInspector')}
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

                // 의존성 선택지가 될 모든 엔티티 (작업 + 마일스톤 + 타임레인지)
                const allEntities = collectEntities(flatList);

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
                // 후행: 자신의 dependencies 에 targetId 를 가진 엔티티
                const succs = allEntities.filter(e => (e.dependencies || []).includes(targetId));

                return (
                    <TimelineBarPopover
                        position={{ x: popoverInfo.x, y: popoverInfo.y }}
                        task={targetTask}
                        clickedDate={popoverInfo.date}
                        clickedRangeId={popoverInfo.rangeId}
                        predecessors={preds}
                        successors={succs}
                        onClose={closePopover}
                        onUpdate={actions.updateTask}
                        onDelete={handlePopoverDelete}
                        onAddMilestone={handlePopoverAddMilestone}
                        onStartLinking={() => {
                            // 특정 기간이 선택돼 있으면 그 기간에서, 아니면 작업에서 연결 시작
                            timelineRef.current?.startLinking(popoverInfo.rangeId || targetTask.id);
                            closePopover();
                        }}
                        onAddTimeRange={(taskId, date) => {
                            const newRanges = [...(targetTask.timeRanges || [])];
                            if (newRanges.length === 0 && (targetTask.startDate || targetTask.endDate)) {
                                // 마이그레이션이 안 된 레거시 작업 보정
                                newRanges.push({
                                    id: generateId(),
                                    startDate: targetTask.startDate,
                                    endDate: targetTask.endDate
                                });
                            }

                            // 1일 길이의 새 기간 추가
                            const day = new Date(date).toISOString().split('T')[0];
                            newRanges.push({ id: generateId(), startDate: day, endDate: day });

                            actions.updateTask(taskId, {
                                timeRanges: newRanges,
                                ...recalcTaskBounds(newRanges),
                            });
                        }}
                        onRemoveDependency={(holderId, dependencyId) => {
                            // holderId: 의존성을 보유한 엔티티 (Task/Range/Milestone ID)
                            // dependencyId: holder 의 dependencies 에서 제거할 ID
                            const owner = findOwnerOfEntity(flattenTasks(tasks), holderId);
                            if (!owner) return;

                            const stripDep = (deps) => (deps || []).filter(id => id !== dependencyId);

                            if (owner.kind === 'task') {
                                actions.updateTask(holderId, { dependencies: stripDep(owner.task.dependencies) });
                            } else if (owner.kind === 'range') {
                                actions.updateTask(owner.task.id, {
                                    timeRanges: owner.task.timeRanges.map(r =>
                                        r.id === holderId ? { ...r, dependencies: stripDep(r.dependencies) } : r
                                    ),
                                });
                            } else if (owner.kind === 'milestone') {
                                actions.updateTask(owner.task.id, {
                                    milestones: owner.task.milestones.map(m =>
                                        m.id === holderId ? { ...m, dependencies: stripDep(m.dependencies) } : m
                                    ),
                                });
                            }
                        }}
                    />
                );
            })()}

            {milestoneModalInfo && (
                <MilestoneQuickAdd
                    task={milestoneModalInfo.task}
                    date={milestoneModalInfo.date}
                    onClose={closeMilestoneAdd}
                    onAdd={handleAddMilestone}
                />
            )}

            <PromptGuideModal
                isOpen={isPromptGuideOpen}
                onClose={ui.closePromptGuide}
                toast={toast}
            />

            <SaveLoadModal
                isOpen={isSnapshotsOpen}
                onClose={ui.closeSnapshots}
                onLoad={(data) => io.processImportedData(data, false)}
                currentData={tasks}
                onExportSnapshot={io.exportSnapshot}
                toast={toast}
            />

            <ImportExportModal
                isOpen={!!ieModalMode}
                onClose={ui.closeIeModal}
                mode={ieModalMode}
                onImport={io.importFromFile}
                onExport={io.exportToFile}
                currentData={ieModalMode === 'EXPORT' ? (customExportData || io.getExportDataObject()) : null}
                toast={toast}
            />

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

export default App;
