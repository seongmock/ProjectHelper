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
import MilestoneEditPopover from './MilestoneEditPopover';
import DependencyLayer from './DependencyLayer';
import { flattenTasks } from '../../utils/dataModel';
import { buildItemMap } from './timelineGeometry';
import { useTimelineScale } from './useTimelineScale';
import { useBarDrag } from './useBarDrag';
import { useDependencyLink } from './useDependencyLink';
import { useSidebarResize } from './useSidebarResize';
import { useTimelineCapture } from './useTimelineCapture';
import './TimelineView.css';

// 작업명 한 줄 — dnd-kit 정렬 대상
function SortableTaskNameItem({ task, selectedTaskId, editingTaskId, editingName, onSelect, onDoubleClick, onContextMenu, onEditChange, onEditBlur, onEditKeyDown }) {
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
                task.name
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
    onOpenMilestoneAdd,
    timeScale,
    viewMode,
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
}, ref) => {
    const containerRef = useRef(null);
    const captureRef = useRef(null);

    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingName, setEditingName] = useState('');
    const [milestoneEditInfo, setMilestoneEditInfo] = useState(null); // { x, y, task, milestone }

    const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);
    const items = useMemo(() => flatTasks.map(t => t.id), [flatTasks]);
    const itemMap = useMemo(() => buildItemMap(flatTasks), [flatTasks]);
    const rowHeight = isCompact ? 28 : 40;

    const { timelineScrollRef, taskNamesScrollRef, dateRange, contentWidth, todayPosition } =
        useTimelineScale({ tasks, timeScale, showToday, zoomLevel, showTaskNames });

    const {
        guideLineX, dragTargetTaskId, handleGuideMove, handleDragUpdate,
        handleBarDragEnd, handleMilestoneDragMove, handleMilestoneDragEnd,
    } = useBarDrag({ flatTasks, onUpdateTask, onUpdateTasks });

    const { isLinkingMode, startLinking, handleTaskClick, handleMilestoneClick, removeDependency } =
        useDependencyLink({ flatTasks, onUpdateTask, onSelectTask, toast });

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
        setMilestoneEditInfo(null); // 마일스톤 팝오버 닫기
        if (onContextMenu) onContextMenu(e, task.id, date, rangeId);
    };

    const handleMilestoneContextMenu = (e, task, milestone) => {
        e.preventDefault();
        setMilestoneEditInfo({ x: e.clientX, y: e.clientY, task, milestone });
    };

    const handleUpdateMilestone = (milestoneId, updates) => {
        if (!milestoneEditInfo) return;
        const currentTask = flatTasks.find(t => t.id === milestoneEditInfo.task.id);
        if (!currentTask || !currentTask.milestones) return;

        const milestones = currentTask.milestones.map(m =>
            m.id === milestoneId ? { ...m, ...updates } : m
        );
        onUpdateTask(currentTask.id, { milestones });
        // 열려 있는 팝오버에 즉시 반영
        setMilestoneEditInfo(prev => ({ ...prev, milestone: milestones.find(m => m.id === milestoneId) }));
    };

    const handleDeleteMilestone = (milestoneId) => {
        if (!milestoneEditInfo) return;
        const currentTask = flatTasks.find(t => t.id === milestoneEditInfo.task.id);
        if (!currentTask || !currentTask.milestones) return;

        onUpdateTask(currentTask.id, {
            milestones: currentTask.milestones.filter(m => m.id !== milestoneId),
        });
        setMilestoneEditInfo(null);
    };

    const handleRemoveDependency = (targetId, dependencyId) => {
        const updatedMilestone = removeDependency(targetId, dependencyId);
        if (updatedMilestone && milestoneEditInfo?.milestone.id === targetId) {
            setMilestoneEditInfo(prev => ({ ...prev, milestone: updatedMilestone }));
        }
    };

    // 팝오버에 표시할 마일스톤의 선행/후행
    const milestonePredecessors = useMemo(() => {
        if (!milestoneEditInfo) return [];
        return (milestoneEditInfo.milestone.dependencies || [])
            .map(depId => itemMap.get(depId))
            .filter(Boolean)
            .map(item => ({ id: item.data.id, name: item.name }));
    }, [milestoneEditInfo, itemMap]);

    const milestoneSuccessors = useMemo(() => {
        if (!milestoneEditInfo) return [];
        const { id } = milestoneEditInfo.milestone;
        const succs = [];
        flatTasks.forEach(t => {
            if (t.dependencies && t.dependencies.includes(id)) {
                succs.push({ id: t.id, name: t.name });
            }
            (t.milestones || []).forEach(ms => {
                if (ms.dependencies && ms.dependencies.includes(id)) {
                    succs.push({ id: ms.id, name: ms.label || '마일스톤' });
                }
            });
        });
        return succs;
    }, [milestoneEditInfo, flatTasks]);

    useImperativeHandle(ref, () => ({
        copyToClipboard,
        startLinking,
    }), [copyToClipboard, startLinking]);

    return (
        <div className={`timeline-view ${viewMode === 'split' ? 'split-mode' : ''} ${isCompact ? 'compact-mode' : ''}`} ref={containerRef} data-chart-theme={chartTheme}>
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
                                <div className="empty-names">작업 없음</div>
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
                            flatTasks={flatTasks}
                            itemMap={itemMap}
                            dateRange={dateRange}
                            contentWidth={contentWidth}
                            rowHeight={rowHeight}
                        />

                        {tasks.length === 0 ? (
                            <div className="empty-timeline">
                                <p>작업을 추가하여 타임라인을 시작하세요</p>
                            </div>
                        ) : (
                            flatTasks.map((task) => (
                                <TimelineBar
                                    key={task.id}
                                    task={task}
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
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {milestoneEditInfo && (
                <MilestoneEditPopover
                    position={{ x: milestoneEditInfo.x, y: milestoneEditInfo.y }}
                    milestone={milestoneEditInfo.milestone}
                    predecessors={milestonePredecessors}
                    successors={milestoneSuccessors}
                    onClose={() => setMilestoneEditInfo(null)}
                    onUpdate={handleUpdateMilestone}
                    onDelete={handleDeleteMilestone}
                    onStartLinking={() => startLinking(milestoneEditInfo.milestone.id)}
                    onRemoveDependency={handleRemoveDependency}
                />
            )}
        </div>
    );
});

export default TimelineView;
