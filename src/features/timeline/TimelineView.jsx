// 간트 타임라인 뷰. 이 파일은 조립만 한다 — 로직은 훅과 순수함수로 나가 있다.
//
//   useTimelineScale   가로 축(컨테이너 실측 → 날짜 범위 → 오늘 마커)
//   useBarDrag         바/마일스톤 드래그 상태 + 드롭 결과 적용
//   useDependencyLink  의존성 연결 모드
//   useSidebarResize   작업명 컬럼 폭
//   useTimelineCapture PNG 캡처
//   timelineGeometry   좌표 계산 (순수)
//   timelineMutations  드롭 결과 계산 (순수)
import React, { useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { dateUtils } from '../../utils/dateUtils';
import TimelineHeader from './TimelineHeader';
import TimelineBar from './TimelineBar';
import TimelineLegend from './TimelineLegend';
import DependencyLayer from './DependencyLayer';
import { flattenTasks } from '../../utils/dataModel';
import { buildItemMap } from './timelineGeometry';
import { resolveDependencyLinks } from './dependencyLinks';
import { resolveRollup } from './rollupBars';
import { useTimelineScale } from './useTimelineScale';
import { useBarDrag } from './useBarDrag';
import { useDependencyLink } from './useDependencyLink';
import { useSidebarResize } from './useSidebarResize';
import { useTimelineCapture } from './useTimelineCapture';
import './TimelineView.css';

// 작업명 한 줄 — dnd-kit 정렬 대상
function SortableTaskNameItem({ task, selectedTaskId, editingTaskId, editingName, onSelect, onDoubleClick, onContextMenu, onEditChange, onEditBlur, onEditKeyDown, onToggleExpand }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : 1,
        position: 'relative',
        opacity: isDragging ? 0.5 : 1,
        paddingLeft: `${task.level * 24 + 12}px`,
        cursor: 'grab'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`task-name-item level-${task.level} ${task.id === selectedTaskId ? 'selected' : ''}`}
            onClick={() => onSelect(task.id)}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            {/* 접기 토글. 분할 뷰가 없어진 뒤로 이것이 타임라인에서 가지를 접는 유일한
                수단이다(접으면 자손의 일정은 요약 막대로 남는다 — rollupBars).
                DnD 센서가 pointerdown 을 잡으므로 여기서 끊어 줘야 클릭이 드래그로
                해석되지 않는다. */}
            {task.children?.length > 0 ? (
                <button
                    className="expand-toggle icon"
                    onClick={(e) => { e.stopPropagation(); onToggleExpand?.(task.id, !task.expanded); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={task.expanded ? '접기' : '펼치기'}
                    aria-expanded={!!task.expanded}
                >
                    {task.expanded ? '▼' : '▶'}
                </button>
            ) : (
                <span className="expand-spacer" />
            )}

            {editingTaskId === task.id ? (
                <input
                    type="text"
                    className="task-name-edit-input"
                    value={editingName}
                    onChange={onEditChange}
                    onBlur={onEditBlur}
                    onKeyDown={(e) => {
                        onEditKeyDown(e);
                        e.stopPropagation(); // DnD 센서 차단
                    }}
                    onKeyUp={(e) => e.stopPropagation()} // DnD 센서 차단
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()} // 드래그 방지
                    onPointerDown={(e) => e.stopPropagation()} // 드래그 방지
                />
            ) : (
                <span className="task-name-text" title={task.name}>{task.name}</span>
            )}
            {/* 구분선 (Divider) */}
            {task.divider && task.divider.enabled && (
                <div
                    className="task-divider"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        width: '100%',
                        borderBottom: `${task.divider.thickness}px ${task.divider.style} ${task.divider.color}`,
                        pointerEvents: 'none',
                        zIndex: 0
                    }}
                />
            )}
        </div>
    );
}

const TimelineView = forwardRef(({
    tasks = [],
    // 검색 필터를 거치지 않은 전체 트리. 그리는 것은 tasks 로 하고, **의존성 간선의 해석만**
    // 이것을 본다 — 상대가 필터 밖에 있어도 그 연결은 여전히 존재한다.
    allTasks = null,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onUpdateTaskSilent,
    onUpdateTasks,
    onDeleteTask,
    onMoveTask,
    onIndentTask,
    onOutdentTask,
    onContextMenu,
    onMilestoneContextMenu,
    onToggleExpand,
    onOpenMilestoneAdd,
    timeScale,
    zoomLevel = 1.0,
    showToday = true,
    isCompact = false,
    showTaskNames = true,
    showBarLabels = false,
    showBarDates = false,
    snapEnabled = true,
    darkMode,
    toast,
    chartTheme = 'default',
    colorMode = 'task',
    dependencyIssues,
    isSearching = false,
}, ref) => {
    const containerRef = useRef(null);
    const captureRef = useRef(null);

    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingName, setEditingName] = useState('');

    const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);
    const items = useMemo(() => flatTasks.map(t => t.id), [flatTasks]);
    const itemMap = useMemo(() => buildItemMap(flatTasks), [flatTasks]);
    const rowHeight = isCompact ? 28 : 40;

    // 의존성 간선의 해석은 **전체 트리**를 봐야 한다. itemMap 에는 화면에 행이 있는 것만
    // 들어 있어서, 접힌 가지나 검색 밖의 끝은 여기 없다 — 예전에는 그런 간선이 조용히
    // 사라졌다(연결을 지운 것과 구별되지 않았다).
    const { links, hiddenEdges } = useMemo(
        () => resolveDependencyLinks(itemMap, allTasks || tasks),
        [itemMap, allTasks, tasks],
    );

    // 접힌 가지의 일정을 대표 행으로 끌어올린다. 기준은 **그리는 트리**(tasks)다 —
    // 검색이 걸러낸 작업까지 되살리면 "이것만 보여 달라"를 뒤집는다(rollupBars.js 주석).
    const rollups = useMemo(() => {
        const map = new Map();
        flatTasks.forEach(task => {
            const rollup = resolveRollup(task);
            if (rollup) map.set(task.id, rollup);
        });
        return map;
    }, [flatTasks]);

    const { timelineScrollRef, taskNamesScrollRef, dateRange, contentWidth, todayPosition } =
        useTimelineScale({ tasks, timeScale, showToday, zoomLevel, showTaskNames });

    const {
        guideLineX, dragTargetTaskId, handleGuideMove, handleDragUpdate,
        handleBarDragEnd, handleMilestoneDragMove, handleMilestoneDragEnd,
    } = useBarDrag({ flatTasks, onUpdateTask, onUpdateTasks });

    const { isLinkingMode, startLinking, handleTaskClick, handleMilestoneClick } =
        useDependencyLink({
            flatTasks,
            onUpdateTask,
            onSelectTask,
            toast,
            // 순환 판정은 전체 트리 기준이다 — flatTasks 는 검색·접기로 걸러진 목록이라
            // 여기 없는 작업을 거쳐 도는 순환을 놓친다.
            dependencySuccessors: dependencyIssues?.successors,
        });

    const { sidebarWidth, isResizing, startResize } = useSidebarResize(containerRef);

    const copyToClipboard = useTimelineCapture({
        containerRef, captureRef, timelineScrollRef, taskNamesScrollRef,
        flatTasks, isCompact, darkMode, toast,
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // 작업명 컬럼 DnD — 드래그 중에는 펼쳐진 그룹을 접어 두고 끝나면 되돌린다.
    // 접기/펼치기는 시각적 임시 상태라 undo 히스토리에 남기지 않는다.
    const [draggedTaskExpanded, setDraggedTaskExpanded] = useState(false);
    const silentUpdate = onUpdateTaskSilent || onUpdateTask;

    const handleDragStart = (event) => {
        const task = flatTasks.find(t => t.id === event.active.id);
        // 검색 중에는 접지 않는다 — 화면에는 효과가 없고(필터가 강제로 펼친다) 저장
        // 데이터의 expanded 만 뒤집힌다. TableView 와 같은 판단이다.
        if (isSearching) {
            setDraggedTaskExpanded(false);
            return;
        }
        if (task && task.children && task.children.length > 0 && task.expanded) {
            setDraggedTaskExpanded(true);
            silentUpdate(task.id, { expanded: false });
        } else {
            setDraggedTaskExpanded(false);
        }
    };

    const handleDragCancel = (event) => {
        if (draggedTaskExpanded && event.active) {
            silentUpdate(event.active.id, { expanded: true });
            setDraggedTaskExpanded(false);
        }
    };

    const handleDragEnd = (event) => {
        const { active, over, delta } = event;

        if (draggedTaskExpanded) {
            silentUpdate(active.id, { expanded: true });
            setDraggedTaskExpanded(false);
        }

        // 가로로 충분히 끌었으면 순서 변경이 아니라 계층 변경이다
        const HORIZONTAL_THRESHOLD = 40;
        if (delta.x > HORIZONTAL_THRESHOLD) {
            onIndentTask && onIndentTask(active.id);
            return;
        } else if (delta.x < -HORIZONTAL_THRESHOLD) {
            onOutdentTask && onOutdentTask(active.id);
            return;
        }

        if (over && active.id !== over.id) {
            onMoveTask && onMoveTask(active.id, over.id);
        }
    };

    const handleContextMenu = (e, task, date, rangeId) => {
        e.preventDefault();
        if (onContextMenu) onContextMenu(e, task.id, date, rangeId);
    };

    // v3: 마일스톤 우클릭도 팝오버가 아니라 인스펙터다. 여기서는 소유 작업과 마일스톤 id 만
    // 올려 보내고, 편집은 전부 패널이 한다.
    const handleMilestoneContextMenu = (e, task, milestone) => {
        e.preventDefault();
        if (onMilestoneContextMenu) onMilestoneContextMenu(e, task.id, milestone.id);
    };

    useImperativeHandle(ref, () => ({
        copyToClipboard,
        startLinking,
    }), [copyToClipboard, startLinking]);

    return (
        <div className={`timeline-view ${isCompact ? 'compact-mode' : ''}`} ref={containerRef} data-chart-theme={chartTheme}>
            <div className={`timeline-container ${showTaskNames ? 'with-names' : ''}`} ref={captureRef}>
                {/* 왼쪽 작업명 컬럼 */}
                {showTaskNames && (<>
                    <div
                        className="task-names-column"
                        style={{ width: `${sidebarWidth}px`, flex: `0 0 ${sidebarWidth}px` }}
                    >
                        <div className="task-names-header" onClick={() => onSelectTask(null)}>작업명</div>
                        <div className="task-names-list" ref={taskNamesScrollRef}>
                            {tasks.length === 0 ? (
                                <div className="empty-names">{isSearching ? '검색 결과 없음' : '작업 없음'}</div>
                            ) : (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragStart={handleDragStart}
                                    onDragEnd={handleDragEnd}
                                    onDragCancel={handleDragCancel}
                                >
                                    <SortableContext
                                        items={items}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {flatTasks.map((task) => (
                                            <SortableTaskNameItem
                                                key={task.id}
                                                task={task}
                                                selectedTaskId={selectedTaskId}
                                                editingTaskId={editingTaskId}
                                                editingName={editingName}
                                                onSelect={handleTaskClick}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingTaskId(task.id);
                                                    setEditingName(task.name);
                                                }}
                                                onContextMenu={(e) => handleContextMenu(e, task, dateRange.start)}
                                                onToggleExpand={onToggleExpand}
                                                onEditChange={(e) => setEditingName(e.target.value)}
                                                onEditBlur={() => {
                                                    if (editingName.trim() !== task.name) {
                                                        onUpdateTask(task.id, { name: editingName });
                                                    }
                                                    setEditingTaskId(null);
                                                }}
                                                onEditKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        if (editingName.trim() !== task.name) {
                                                            onUpdateTask(task.id, { name: editingName });
                                                        }
                                                        setEditingTaskId(null);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingTaskId(null);
                                                    }
                                                }}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>
                    </div>
                    {/* 폭 조절 핸들 */}
                    <div
                        className={`sidebar-resize-handle ${isResizing ? 'resizing' : ''}`}
                        onMouseDown={startResize}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="작업명 컬럼 폭 조절"
                    />
                </>)}

                {/* 타임라인 스크롤 컨테이너 */}
                <div className="timeline-scroll-container" ref={timelineScrollRef}>
                    {/* 오늘 날짜 마커 (전체 높이) */}
                    {todayPosition !== null && (
                        <div className="today-marker" style={{ left: `${todayPosition}px` }} />
                    )}

                    <TimelineHeader
                        startDate={dateRange.start}
                        endDate={dateRange.end}
                        timeScale={timeScale}
                        containerWidth={contentWidth}
                        showToday={showToday}
                        onClick={() => onSelectTask(null)}
                    />

                    <div
                        className={`timeline-content ${isLinkingMode ? 'linking-mode' : ''}`}
                        style={{ width: `${contentWidth}px` }}
                        onClick={(e) => {
                            // 빈 영역 클릭 시 선택 해제
                            if (e.target.classList.contains('timeline-content') || e.target.classList.contains('empty-timeline')) {
                                onSelectTask(null);
                            }
                        }}
                        onContextMenu={(e) => {
                            // 빈 영역 우클릭 시 마일스톤 추가 (타임라인 바가 아닌 곳)
                            if (!e.target.closest('.timeline-bar') && !e.target.closest('.milestone-marker')) {
                                e.preventDefault();
                                if (isLinkingMode) return;

                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const totalDays = dateUtils.getDaysBetween(dateRange.start, dateRange.end);
                                const daysFromStart = Math.round((x / contentWidth) * totalDays);
                                const clickedDate = dateUtils.addDays(dateRange.start, daysFromStart);

                                // 빈 영역 우클릭은 로컬 '마일스톤 추가' 모달 유지
                                // (바 우클릭은 App 레벨 컨텍스트 메뉴 팝오버 사용)
                                const targetTask = flatTasks.find(t => t.id === selectedTaskId) || flatTasks[0];
                                if (targetTask && onOpenMilestoneAdd) {
                                    onOpenMilestoneAdd({ task: targetTask, date: clickedDate });
                                }
                            }
                        }}
                    >
                        {/* 가이드라인 (드래그 시에만 표시) */}
                        {guideLineX !== null && (
                            <div className="timeline-guide-line" style={{ left: guideLineX }} />
                        )}

                        <DependencyLayer
                            links={links}
                            hiddenEdges={hiddenEdges}
                            rowCount={flatTasks.length}
                            dateRange={dateRange}
                            contentWidth={contentWidth}
                            rowHeight={rowHeight}
                            edgeIssues={dependencyIssues?.edgeIssues}
                        />

                        {tasks.length === 0 ? (
                            <div className="empty-timeline">
                                <p>{isSearching ? '검색 결과가 없습니다.' : '작업을 추가하여 타임라인을 시작하세요'}</p>
                            </div>
                        ) : (
                            flatTasks.map((task) => (
                                <TimelineBar
                                    key={task.id}
                                    task={task}
                                    rollup={rollups.get(task.id)}
                                    level={task.level}
                                    startDate={dateRange.start}
                                    endDate={dateRange.end}
                                    containerWidth={contentWidth}
                                    isSelected={task.id === selectedTaskId}
                                    isDragTarget={dragTargetTaskId === task.id}
                                    onSelect={handleTaskClick}
                                    onDragUpdate={handleDragUpdate}
                                    onDragEnd={handleBarDragEnd}
                                    onMilestoneDragEnd={handleMilestoneDragEnd}
                                    onMilestoneDragMove={handleMilestoneDragMove}
                                    onGuideMove={handleGuideMove}
                                    onContextMenu={(e, date, rangeId) => handleContextMenu(e, task, date, rangeId)}
                                    onMilestoneContextMenu={(e, milestone) => handleMilestoneContextMenu(e, task, milestone)}
                                    onMilestoneClick={handleMilestoneClick}
                                    showLabel={!showTaskNames}
                                    showBarLabels={showBarLabels}
                                    showBarDates={showBarDates}
                                    timeScale={timeScale}
                                    snapEnabled={snapEnabled}
                                    chartTheme={chartTheme}
                                    colorMode={colorMode}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 범례는 캡처 대상(captureRef = .timeline-container) 밖이다 —
                PNG 캡처는 높이를 행 수로 계산하므로 안에 넣으면 계산이 어긋난다.
                HTML 내보내기는 자체 범례를 그린다(htmlExporter.js). */}
            {colorMode === 'status' && <TimelineLegend />}
        </div>
    );
});

export default TimelineView;
