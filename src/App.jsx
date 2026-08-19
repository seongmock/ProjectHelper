// 앱 조립부. 상태는 여기 두지 않는다:
//   - 작업 트리       → useUndoRedo
//   - 저장되는 설정   → stores/settingsStore
//   - 화면 상태/모달  → stores/uiStore
//   - 서버 동기화     → hooks/useProjectSync
//   - 트리 조작       → hooks/useTaskActions (로직은 utils/taskTree.js)
//   - 파일 입출력     → hooks/useImportExport
import { useEffect, useCallback, useRef, useMemo } from 'react';
import { getSampleData } from './utils/dataModel';
import { flattenAll, planDependencyRemoval, expandAncestors, findDependencyIssues, filterTasksByQuery, taskMatchesQuery } from './utils/taskTree';
import { resolveGlobalShortcut, isTextEditableTarget, hasOverlay } from './shared/keyboard';
import { useUndoRedo } from './shared/hooks/useUndoRedo';
import { useToast } from './shared/hooks/useToast';
import { useProjectSync } from './features/projects/useProjectSync';
import { useTaskActions } from './features/tasks/useTaskActions';
import { useTaskKeyboard, scrollSelectedTaskIntoView } from './features/tasks/useTaskKeyboard';
import { useImportExport } from './features/io/useImportExport';
import { useSettingsStore } from './stores/settingsStore';
import { useUiStore } from './stores/uiStore';
import Header from './features/shell/Header';
import Toolbar from './features/shell/Toolbar';
import TableView from './features/table/TableView';
import TimelineView from './features/timeline/TimelineView';
import PromptGuideModal from './features/io/PromptGuideModal';
import ImportExportModal from './features/io/ImportExportModal';
import ProjectManagerModal from './features/projects/ProjectManagerModal';
import ProjectRail from './features/projects/ProjectRail';
import MilestoneQuickAdd from './features/timeline/MilestoneQuickAdd';
import InspectorPanel from './features/tasks/InspectorPanel';
import CommandPalette from './features/shell/CommandPalette';
import { buildCommands } from './features/shell/commandPalette';
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
    const railExpanded = useSettingsStore(s => s.railExpanded);
    const darkMode = useSettingsStore(s => s.darkMode);
    const setSetting = useSettingsStore(s => s.setSetting);
    const toggleSetting = useSettingsStore(s => s.toggleSetting);

    // ── 화면 상태 ────────────────────────────────────
    const viewMode = useUiStore(s => s.viewMode);
    const setViewMode = useUiStore(s => s.setViewMode);
    const searchQuery = useUiStore(s => s.searchQuery);
    const setSearchQuery = useUiStore(s => s.setSearchQuery);
    const searchCollapsedIds = useUiStore(s => s.searchCollapsedIds);
    const toggleSearchCollapsed = useUiStore(s => s.toggleSearchCollapsed);
    const selectedTaskId = useUiStore(s => s.selectedTaskId);
    const setSelectedTaskId = useUiStore(s => s.setSelectedTaskId);
    const selectedRangeId = useUiStore(s => s.selectedRangeId);
    const setSelectedRangeId = useUiStore(s => s.setSelectedRangeId);
    const selectedMilestoneId = useUiStore(s => s.selectedMilestoneId);
    const setSelectedMilestoneId = useUiStore(s => s.setSelectedMilestoneId);
    const milestoneModalInfo = useUiStore(s => s.milestoneModalInfo);
    const openMilestoneAdd = useUiStore(s => s.openMilestoneAdd);
    const closeMilestoneAdd = useUiStore(s => s.closeMilestoneAdd);
    const isPromptGuideOpen = useUiStore(s => s.isPromptGuideOpen);
    const projectManagerTab = useUiStore(s => s.projectManagerTab);
    const ieModalMode = useUiStore(s => s.ieModalMode);
    const customExportData = useUiStore(s => s.customExportData);
    const isPaletteOpen = useUiStore(s => s.isPaletteOpen);

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
        syncState,
        retrySave,
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

    // ── 우클릭 → 인스펙터 ────────────────────────────
    // v2 부터 우클릭은 팝오버를 띄우지 않는다. 선택을 그 작업(과 지목한 기간)으로 옮기고
    // 인스펙터를 연다 — 편집 표면이 하나여야 "지금 무엇을 고치고 있는지"가 흔들리지 않는다.
    // v3 에서 마일스톤 우클릭도 같은 경로로 들어온다. 기간 포커스와 마일스톤 포커스는
    // 배타적이다 — 둘 다 남아 있으면 "연결 추가"의 주체가 무엇인지 화면에서 읽을 수 없다.
    const focusInInspector = useCallback((taskId, { rangeId = null, milestoneId = null } = {}) => {
        setSelectedTaskId(taskId);
        setSelectedRangeId(rangeId);
        setSelectedMilestoneId(milestoneId);
        if (!showInspector) setSetting({ showInspector: true });
    }, [setSelectedTaskId, setSelectedRangeId, setSelectedMilestoneId, showInspector, setSetting]);

    const handleContextMenu = useCallback((e, taskId, _date = null, rangeId = null) => {
        e.preventDefault();
        focusInInspector(taskId, { rangeId });
    }, [focusInInspector]);

    const handleMilestoneContextMenu = useCallback((e, taskId, milestoneId) => {
        e.preventDefault();
        focusInInspector(taskId, { milestoneId });
    }, [focusInInspector]);

    // v4: 표의 마일스톤 칼럼은 더 이상 자체 편집 모달을 갖지 않는다 — 타임라인의 마일스톤
    // 우클릭과 **같은 경로**로 인스펙터를 지목한다. 마일스톤이 없는 작업이면 포커스 없이
    // 열리고, 인스펙터의 "마일스톤 추가"가 유일한 추가 경로다.
    const handleOpenMilestones = useCallback((taskId, milestoneId) => {
        focusInInspector(taskId, { milestoneId });
    }, [focusInInspector]);

    // 표의 의존성 배지도 같은 경로다 — 표는 연결의 **존재**만 말하고, 상대 목록과 제거는
    // 인스펙터가 갖는다. 기간·마일스톤 포커스는 지우고 연다(배지는 작업 단위 요약이라
    // 어느 기간의 연결인지 지목하지 않는다 — 지목한 척하면 "연결 추가"의 주체가 흔들린다).
    const handleOpenDependencies = useCallback((taskId) => {
        focusInInspector(taskId);
    }, [focusInInspector]);

    // 인스펙터의 "마일스톤 추가" → 기존 MilestoneQuickAdd 모달 재사용.
    // 로컬 자정으로 파싱한다 — new Date('2026-06-20') 는 UTC 자정이라 음수 오프셋 지역에서
    // 모달이 하루 이른 날짜를 보여 준다.
    const handleOpenMilestoneAdd = useCallback((task, dateStr) => {
        openMilestoneAdd({ task, date: dateStr ? new Date(`${dateStr}T00:00:00`) : new Date() });
    }, [openMilestoneAdd]);

    const handleAddMilestone = useCallback((taskId, milestoneData) => {
        actions.addMilestone(taskId, milestoneData);
        closeMilestoneAdd();
    }, [actions, closeMilestoneAdd]);

    // 의존성 제거: 어느 종류가 보유하고 있는지에 따라 갱신 필드가 다르다 → 순수함수가 판단
    const handleRemoveDependency = useCallback((holderId, dependencyId) => {
        const plan = planDependencyRemoval(flattenAll(tasks), holderId, dependencyId);
        if (plan) actions.updateTask(plan.taskId, plan.updates);
    }, [tasks, actions]);

    // 작업 추가의 유일한 관문. **추가는 추가한 것이 보이는 상태로 끝나야 한다.**
    // 검색 중에는 새 작업('새 작업')이 질의에 걸리지 않아 필터 밖에 만들어졌다 — 화면에는
    // 아무 일도 일어나지 않은 것으로 보이고, 정작 선택은 그 보이지 않는 작업으로 옮겨가
    // 인스펙터에서 이름을 고쳐도 행은 나타나지 않았다. 그러면 질의를 지운다(질의에 걸리는
    // 이름이면 그대로 둔다 — 검색 상태를 이유 없이 버리지 않는다).
    // 새 작업은 목록 끝에 붙으므로, 필터와 무관하게 화면 안으로 들여놓는다.
    const handleAddTask = useCallback((parentId = null) => {
        const created = actions.addTask(parentId);
        if (!taskMatchesQuery(created, searchQuery)) {
            setSearchQuery('');
            toast.info('새 작업을 보여주기 위해 검색을 해제했습니다');
        }
        scrollSelectedTaskIntoView();
    }, [actions, searchQuery, setSearchQuery, toast]);

    // 명령 팔레트의 "작업으로 이동". 접힌 부모 아래 숨어 있으면 조상을 펼쳐야 보인다 —
    // 펼치기는 접기/펼치기와 마찬가지로 **히스토리에 남기지 않는다**(시각적 상태).
    const jumpToTask = useCallback((taskId) => {
        setTasksSilent(prev => expandAncestors(prev, taskId) ?? prev);
        setSelectedTaskId(taskId);
        setSelectedRangeId(null);
        setSelectedMilestoneId(null);
        scrollSelectedTaskIntoView();
    }, [setTasksSilent, setSelectedTaskId, setSelectedRangeId, setSelectedMilestoneId]);

    // ── 전역 단축키 ──────────────────────────────────
    // 판정은 shared/keyboard.js 하나가 한다(선택 작업 단축키도 같은 가드를 쓴다).
    // 명령이 나올 때에만 preventDefault 한다 — 입력 중의 Ctrl+Z 를 먹으면 사용자는
    // 방금 친 글자를 되돌릴 방법을 잃는다.
    useEffect(() => {
        const run = {
            palette: ui.togglePalette,
            undo,
            redo,
            exportFile: io.exportToFile,
            addTask: () => handleAddTask(),
        };
        const handleKeyDown = (e) => {
            const command = resolveGlobalShortcut(e, {
                textEditing: isTextEditableTarget(e.target),
                overlay: hasOverlay(),
            });
            if (!command) return;
            e.preventDefault(); // 브라우저 기본(주소창 검색·페이지 저장 등)을 먹는다
            run[command]();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, io, handleAddTask]);

    // 검색어 필터 — 뷰가 바뀌어도 다시 계산되지 않게 useMemo 로 둔다
    const isSearching = searchQuery.trim().length > 0;
    const filteredTasks = useMemo(
        () => filterTasksByQuery(tasks, searchQuery, searchCollapsedIds),
        [tasks, searchQuery, searchCollapsedIds]
    );

    // 접기/펼치기의 유일한 관문. **검색 중과 아닐 때가 다른 곳에 쓴다.**
    // 검색 중에는 필터가 일치를 드러내려고 조상을 강제로 펼치므로, 저장 데이터에 써 봐야
    // 화면에는 반영되지 않는다(화살표는 ▼ 그대로고, 값만 조용히 문서에 남아 저장된다).
    // 그래서 그때의 접기는 화면 상태(uiStore)로 받고 검색을 지울 때 함께 버린다.
    // 검색 중이 아니면 트리에 쓴다 — 단 **히스토리에는 남기지 않는다**. 접기는 시각적
    // 상태라(드래그 중 접기와 같은 판단) 되돌리기 20칸을 접기로 채우면 정작 직전의 편집을
    // 되돌릴 수 없다.
    const handleToggleExpand = useCallback((taskId, nextExpanded) => {
        if (isSearching) {
            toggleSearchCollapsed(taskId);
            return;
        }
        actions.updateTaskSilent(taskId, { expanded: nextExpanded });
    }, [isSearching, toggleSearchCollapsed, actions]);

    // 드래그 재배치의 유일한 관문. **어디에 놓였는지는 화면이 정한다.**
    // 검색 중에는 필터가 조상을 강제로 펼치므로 트리에서는 접혀 있는 작업도 화면에서는
    // 드래그된다 — 트리 기준으로 판정하면 그 드래그는 아무것도 하지 않고(제자리),
    // 들여쓰기는 화면에 없던 형제 밑으로 들어간다. 그래서 판정 기준으로 filteredTasks 를
    // 함께 넘긴다(검색 중이 아니면 tasks 와 같은 참조다 — 분기가 필요 없다).
    const handleMoveTask = useCallback((activeId, overId) => {
        actions.moveTask(activeId, overId, filteredTasks);
    }, [actions, filteredTasks]);

    const handleIndentTask = useCallback((taskId) => {
        actions.indent(taskId, filteredTasks);
    }, [actions, filteredTasks]);

    // 의존성 정합성. **검색 필터가 아니라 전체 트리**를 본다 — 상대가 필터에 걸려
    // 사라지면 멀쩡한 연결이 dangling 으로 보인다(인스펙터가 tasks 를 받는 것과 같은 이유).
    const dependencyIssues = useMemo(() => findDependencyIssues(tasks), [tasks]);

    // 선택 작업 대상 단축키(↑↓ 선택 이동, [ ] 일정 이동). 검색으로 걸러진 뒤의
    // 목록을 넘긴다 — 화면에 없는 작업으로 선택이 튀면 안 된다.
    useTaskKeyboard({
        tasks: filteredTasks,
        selectedTaskId,
        onSelect: setSelectedTaskId,
        onUpdateTask: actions.updateTask,
        toast,
    });

    // 팔레트 목록. 핸들러는 전부 이미 툴바·헤더가 쓰고 있는 것들이다 — 여기서 새로 만들지 않는다.
    const commands = useMemo(() => buildCommands({
        viewMode,
        settings: {
            showInspector, darkMode, timeScale, colorMode,
            showTaskNames, showBarLabels, showBarDates, showToday, isCompact, snapEnabled,
        },
        canUndo,
        canRedo,
        projects,
        activeProjectId,
        handlers: {
            addTask: () => handleAddTask(),
            undo,
            redo,
            setViewMode,
            setSetting,
            toggleSetting,
            zoomIn: () => setSetting({ zoomLevel: zoomLevel + 0.1 }),
            zoomOut: () => setSetting({ zoomLevel: Math.max(zoomLevel - 0.1, 0.1) }),
            copyImage: () => timelineRef.current?.copyToClipboard(),
            exportFile: io.exportToFile,
            importFile: ui.openImport,
            exportHtml: io.exportToHtml,
            openProjectManager: ui.openProjectManager,
            openPromptGuide: ui.openPromptGuide,
            switchProject,
        },
    }), [
        viewMode, showInspector, darkMode, timeScale, colorMode, showTaskNames, showBarLabels,
        showBarDates, showToday, isCompact, snapEnabled, zoomLevel, canUndo, canRedo,
        projects, activeProjectId, handleAddTask, undo, redo, setViewMode, setSetting, toggleSetting,
        io, switchProject,
    ]);

    const activeProjectName = projects.find(p => p.id === activeProjectId)?.name;

    return (
        <div className="app">
            <ProjectRail
                projects={projects}
                activeProjectId={activeProjectId}
                expanded={railExpanded}
                onToggleExpanded={() => toggleSetting('railExpanded')}
                onSwitch={switchProject}
                // 만들기는 관리 모달의 입력란 하나뿐이다 — 레일에 두 번째 입력을 두면
                // 같은 일을 하는 UI 가 다시 둘이 된다
                onCreate={() => ui.openProjectManager('projects')}
            />

            <div className="app-shell">
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
                    onOpenProjectManager={() => ui.openProjectManager('versions')}
                    projectName={activeProjectName}
                    syncState={syncState}
                    onRetrySave={retrySave}
                />

                <Toolbar
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    timeScale={timeScale}
                    onTimeScaleChange={(v) => setSetting({ timeScale: v })}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onAddTask={() => handleAddTask()}
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
                    onOpenPalette={ui.openPalette}
                />

                <div className="main-content">
                    {isLoading ? (
                        <div className="app-loading">
                            <span>⏳</span> 데이터 불러오는 중...
                        </div>
                    ) : (
                        <>
                            {viewMode === 'table' && (
                                <TableView
                                    tasks={filteredTasks}
                                    selectedTaskId={selectedTaskId}
                                    onSelectTask={setSelectedTaskId}
                                    onUpdateTask={actions.updateTask}
                                    onUpdateTaskSilent={actions.updateTaskSilent}
                                    onUpdateTasks={actions.updateTasks}
                                    onToggleExpand={handleToggleExpand}
                                    onDeleteTask={actions.deleteTask}
                                    onAddTask={handleAddTask}
                                    onReorderTasks={actions.reorderTasks}
                                    onIndentTask={handleIndentTask}
                                    onOutdentTask={actions.outdent}
                                    onMoveTask={handleMoveTask}
                                    onContextMenu={handleContextMenu}
                                    onOpenMilestones={handleOpenMilestones}
                                    onOpenDependencies={handleOpenDependencies}
                                    // 그리는 것은 filteredTasks 지만 연결은 전체 트리를 봐야
                                    // 한다 — 타임라인 화살표·인스펙터와 같은 이유다.
                                    allTasks={tasks}
                                    dependencyIssues={dependencyIssues}
                                    isSearching={isSearching}
                                />
                            )}

                            {viewMode === 'timeline' && (
                                <TimelineView
                                    ref={timelineRef}
                                    tasks={filteredTasks}
                                    selectedTaskId={selectedTaskId}
                                    onSelectTask={setSelectedTaskId}
                                    onUpdateTask={actions.updateTask}
                                    onUpdateTaskSilent={actions.updateTaskSilent}
                                    onUpdateTasks={actions.updateTasks}
                                    onDeleteTask={actions.deleteTask}
                                    onAddTask={handleAddTask}
                                    onMoveTask={handleMoveTask}
                                    onIndentTask={handleIndentTask}
                                    onOutdentTask={actions.outdent}
                                    onContextMenu={handleContextMenu}
                                    onMilestoneContextMenu={handleMilestoneContextMenu}
                                    // 접기는 표와 같은 게이트를 쓴다 — 검색 중 여부에 따라
                                    // 기록 위치가 다르고, 그 판단은 handleToggleExpand 에만 있다
                                    onToggleExpand={handleToggleExpand}
                                    timeScale={timeScale}
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
                                    dependencyIssues={dependencyIssues}
                                    // 그리는 것은 filteredTasks 지만, 의존성 간선은 전체 트리를
                                    // 봐야 한다 — 상대가 필터 밖이라고 연결이 없어지지 않는다
                                    // (dependencyIssues 를 tasks 로 내는 것과 같은 이유).
                                    allTasks={tasks}
                                    isSearching={isSearching}
                                />
                            )}

                            {/* 인스펙터는 검색 필터가 아니라 전체 트리를 본다 —
                                의존성 상대가 필터에 걸려 없어지면 앞뒤 관계가 잘못 보인다 */}
                            {showInspector && (
                                <InspectorPanel
                                    tasks={tasks}
                                    selectedTaskId={selectedTaskId}
                                    selectedRangeId={selectedRangeId}
                                    selectedMilestoneId={selectedMilestoneId}
                                    onUpdateTask={actions.updateTask}
                                    onSelectTask={setSelectedTaskId}
                                    onDeleteTask={actions.deleteTask}
                                    onDeleteRange={actions.deleteRange}
                                    onDeleteMilestone={actions.deleteMilestone}
                                    onAddMilestone={handleOpenMilestoneAdd}
                                    onRemoveDependency={handleRemoveDependency}
                                    dependencyIssues={dependencyIssues}
                                    // 연결은 타임라인의 명령형 핸들이 필요하다 — 표 뷰에서는 버튼을 잠근다
                                    canLink={viewMode !== 'table'}
                                    onStartLinking={(entityId) => timelineRef.current?.startLinking(entityId)}
                                    onClose={() => toggleSetting('showInspector')}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            {milestoneModalInfo && (
                <MilestoneQuickAdd
                    task={milestoneModalInfo.task}
                    date={milestoneModalInfo.date}
                    onClose={closeMilestoneAdd}
                    onAdd={handleAddMilestone}
                />
            )}

            {/* 열 때마다 새로 마운트한다 — 질의를 effect 로 비우면 열자마자 친 글자가 지워진다 */}
            {isPaletteOpen && (
                <CommandPalette
                    onClose={ui.closePalette}
                    commands={commands}
                    tasks={tasks}
                    onJumpToTask={jumpToTask}
                />
            )}

            <PromptGuideModal
                isOpen={isPromptGuideOpen}
                onClose={ui.closePromptGuide}
                toast={toast}
            />

            <ProjectManagerModal
                isOpen={!!projectManagerTab}
                initialTab={projectManagerTab || 'projects'}
                onClose={ui.closeProjectManager}
                projects={projects}
                activeProjectId={activeProjectId}
                onSwitchProject={switchProject}
                onCreateProject={createProject}
                onRenameProject={renameProject}
                onDeleteProject={deleteProject}
                onRefreshProjects={refreshProjects}
                currentData={tasks}
                onLoadSnapshot={(data) => io.processImportedData(data, false)}
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
