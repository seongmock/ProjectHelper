import React, { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
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
import { dateUtils } from '../utils/dateUtils';
import TimelineHeader from './TimelineHeader';
import TimelineBar from './TimelineBar';
import TimelineBarPopover from './TimelineBarPopover';
import MilestoneEditPopover from './MilestoneEditPopover';
import { generateId, flattenTasks } from '../utils/dataModel';
import html2canvas from 'html2canvas';
import './TimelineView.css';

// Sortable Wrapper for Task Name
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
        cursor: 'grab' // 커서 변경
    };

    // 드래그 중이 아닐 때만 클릭/더블클릭 허용 (dnd-kit이 알아서 처리하지만 명시적 제어 가능)

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
                        zIndex: 10
                    }}
                />
            )}
        </div>
    );
}



const TimelineView = forwardRef(({
    tasks = [], // Default value to prevent crash
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onUpdateTasks, // 여러 작업 동시 업데이트용
    onDeleteTask, // Add prop
    onMoveTask,
    onIndentTask, // Add prop
    onOutdentTask, // Add prop

    onContextMenu, // Add prop
    onOpenMilestoneAdd, // App from prop
    timeScale,
    viewMode,
    // Props from App
    zoomLevel = 1.0,
    showToday = true,
    isCompact = false,
    showTaskNames = true,

    showBarLabels = false,
    showBarDates = false,
    snapEnabled = true, // 기본값 true
    darkMode // 다크 모드
}, ref) => {
    const containerRef = useRef(null);
    const timelineScrollRef = useRef(null);
    const taskNamesScrollRef = useRef(null); // 작업명 스크롤 컨테이너
    const captureRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingName, setEditingName] = useState('');
    // Remove local popoverInfo

    const [milestoneEditInfo, setMilestoneEditInfo] = useState(null); // { x, y, task, milestone }

    // Sidebar Resize State
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarRef = useRef(null); // To track mouse move globally when resizing

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

    // 타임라인 데이터 준비 (핸들러보다 먼저 선언)
    const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);
    const items = useMemo(() => flatTasks.map(t => t.id), [flatTasks]);

    // 드래그 시작 시 확장된 작업 접기
    const [draggedTaskExpanded, setDraggedTaskExpanded] = useState(false);

    const handleDragStart = (event) => {
        const { active } = event;
        const task = flatTasks.find(t => t.id === active.id);

        if (task && task.children && task.children.length > 0 && task.expanded) {
            setDraggedTaskExpanded(true);
            onUpdateTask(task.id, { expanded: false });
        } else {
            setDraggedTaskExpanded(false);
        }
    };

    const handleDragEnd = (event) => {
        const { active, over, delta } = event;

        // 원래 상태 복구
        if (draggedTaskExpanded) {
            onUpdateTask(active.id, { expanded: true });
            setDraggedTaskExpanded(false);
        }

        // X축 이동에 따른 계층 변경
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

    // 의존성 연결 모드 상태
    const [isLinkingMode, setIsLinkingMode] = useState(false);
    const [linkSourceTaskId, setLinkSourceTaskId] = useState(null);

    // 컨테이너 너비 감지 (타임라인 스크롤 영역 기준)
    useEffect(() => {
        if (!timelineScrollRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        resizeObserver.observe(timelineScrollRef.current);
        return () => resizeObserver.disconnect();
    }, [showTaskNames]);

    // 스크롤 동기화: 타임라인 스크롤 -> 작업명 스크롤
    useEffect(() => {
        const timelineScroll = timelineScrollRef.current;
        const taskNamesScroll = taskNamesScrollRef.current;

        if (!timelineScroll || !taskNamesScroll) return;

        const handleTimelineScroll = () => {
            // 타임라인의 수직 스크롤을 작업명으로 동기화
            taskNamesScroll.scrollTop = timelineScroll.scrollTop;
        };

        timelineScroll.addEventListener('scroll', handleTimelineScroll);
        return () => timelineScroll.removeEventListener('scroll', handleTimelineScroll);
    }, [showTaskNames]);


    // ESC 키로 연결 모드 취소
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isLinkingMode) {
                setIsLinkingMode(false);
                setLinkSourceTaskId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLinkingMode]);

    // 전체 작업의 날짜 범위 계산
    const dateRange = useMemo(() => {
        if (tasks.length === 0) {
            return {
                start: new Date(),
                end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90일 후
            };
        }

        const getAllDates = (items) => {
            const dates = [];
            items.forEach(item => {
                // 다중 기간 지원
                if (item.timeRanges && item.timeRanges.length > 0) {
                    item.timeRanges.forEach(range => {
                        if (range.startDate) dates.push(new Date(range.startDate));
                        if (range.endDate) dates.push(new Date(range.endDate));
                    });
                } else {
                    if (item.startDate) dates.push(new Date(item.startDate));
                    if (item.endDate) dates.push(new Date(item.endDate));
                }

                // 마일스톤 날짜도 포함
                if (item.milestones && item.milestones.length > 0) {
                    item.milestones.forEach(ms => {
                        if (ms.date) dates.push(new Date(ms.date));
                    });
                }

                if (item.children && item.children.length > 0) {
                    dates.push(...getAllDates(item.children));
                }
            });
            return dates;
        };

        const allDates = getAllDates(tasks);
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));

        // 약간의 여유 공간 추가
        const padding = 14; // 14일
        const paddedStart = dateUtils.addDays(minDate, -padding);
        const paddedEnd = dateUtils.addDays(maxDate, padding);

        let start, end;

        if (timeScale === 'quarterly') {
            // 분기별 보기일 경우 분기 시작/끝으로 맞춤
            const startQuarter = Math.floor(paddedStart.getMonth() / 3) + 1;
            start = dateUtils.getQuarterStart(paddedStart.getFullYear(), startQuarter);

            const endQuarter = Math.floor(paddedEnd.getMonth() / 3) + 1;
            end = dateUtils.getQuarterEnd(paddedEnd.getFullYear(), endQuarter);
        } else {
            // 월별 보기일 경우 월 시작/끝으로 맞춤
            start = new Date(paddedStart.getFullYear(), paddedStart.getMonth(), 1);
            end = new Date(paddedEnd.getFullYear(), paddedEnd.getMonth() + 1, 0);
        }

        return { start, end };
    }, [tasks, timeScale]);





    // 1. 모든 항목(작업 + 마일스톤)을 ID로 매핑하여 위치 정보 미리 계산
    const itemMap = useMemo(() => {
        const map = new Map();
        flatTasks.forEach((task, index) => {
            // 작업의 시작/종료일 계산 (다중 기간인 경우 전체 범위)
            let minStart = task.startDate;
            let maxEnd = task.endDate;

            if (task.timeRanges && task.timeRanges.length > 0) {
                const starts = task.timeRanges.map(r => new Date(r.startDate).getTime());
                const ends = task.timeRanges.map(r => new Date(r.endDate).getTime());
                minStart = new Date(Math.min(...starts));
                maxEnd = new Date(Math.max(...ends));
            }

            // 1. Task ID 매핑 (Legacy 호환 및 그룹핑용) - 첫 번째 Range 또는 전체 범위
            map.set(task.id, {
                type: 'task',
                data: task,
                index: index,
                startDate: minStart,
                endDate: maxEnd,
                name: task.name
            });

            // 2. Individual Time Range 매핑 (New)
            if (task.timeRanges && task.timeRanges.length > 0) {
                task.timeRanges.forEach(range => {
                    // 범위별 고유 ID가 있어야 함
                    if (range.id) {
                        map.set(range.id, {
                            type: 'range',
                            data: range,
                            parentId: task.id,
                            index: index,
                            startDate: new Date(range.startDate).getTime(),
                            endDate: new Date(range.endDate).getTime(),
                            name: task.name,
                            color: range.color || task.color // Range color override
                        });
                    }
                });
            }

            // 마일스톤 정보 저장
            if (task.milestones) {
                task.milestones.forEach(ms => {
                    map.set(ms.id, {
                        type: 'milestone',
                        data: ms,
                        parentIndex: index, // 마일스톤은 부모 작업의 행에 위치
                        date: ms.date,
                        name: ms.label || '마일스톤'
                    });
                });
            }
        });
        return map;
    }, [flatTasks]);

    // 가이드라인 상태
    const [guideLineX, setGuideLineX] = useState(null);
    // 드래그 타겟 작업 ID (하이라이트용)
    const [dragTargetTaskId, setDragTargetTaskId] = useState(null);

    // Helper to get task from Y coordinate
    const getTaskFromY = useCallback((clientY) => {
        const timelineRows = document.querySelectorAll('.timeline-row[data-task-id]');
        for (let row of timelineRows) {
            const rect = row.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const taskId = row.getAttribute('data-task-id');
                return flatTasks.find(t => t.id === taskId);
            }
        }
        return null; // Not over any row
    }, [flatTasks]);

    // 드래그로 날짜 변경 & 타겟 찾기
    const handleDragUpdate = useCallback((taskId, newStartDate, newEndDate, rangeId, clientY) => {
        // Highlight logic
        if (clientY !== undefined) {
            const targetTask = getTaskFromY(clientY);
            if (targetTask) {
                setDragTargetTaskId(targetTask.id);
            }
        }

        // Silent update for global state is NOT needed as TimelineBar handles local visual state.
        // Removed `setTasksSilent` block which caused ReferenceError.
    }, [getTaskFromY]);

    // 타임라인 바 드래그 완료 시 최종 상태를 히스토리에 기록
    const handleTimelineBarDragEnd = useCallback((taskId, finalStart, finalEnd, rangeId, clientY, isCopyMode) => {
        setDragTargetTaskId(null); // Clear highlight

        let targetTask = null;
        if (clientY !== undefined) {
            targetTask = getTaskFromY(clientY);
        }

        const sourceTask = flatTasks.find(t => t.id === taskId);
        if (!sourceTask) return;

        // Determine effective target
        const effectiveTargetTask = (targetTask && targetTask.id !== taskId) ? targetTask : null;

        // If copy mode (Ctrl pressed) OR moving to another task
        if (isCopyMode || effectiveTargetTask) {
            const rangeMoving = (sourceTask.timeRanges || []).find(r => r.id === rangeId) ||
                (rangeId === 'legacy' ? { id: generateId(), startDate: sourceTask.startDate, endDate: sourceTask.endDate } : null);

            if (!rangeMoving) return;

            const updates = [];

            // 1. Handle Source (Remove only if NOT copy mode)
            if (!isCopyMode) {
                const newSourceRanges = (sourceTask.timeRanges || []).filter(r => String(r.id) !== String(rangeId));

                let sourceStart = sourceTask.startDate;
                let sourceEnd = sourceTask.endDate;
                if (newSourceRanges.length > 0) {
                    const dates = newSourceRanges.flatMap(r => [new Date(r.startDate), new Date(r.endDate)]);
                    sourceStart = dateUtils.formatDate(new Date(Math.min(...dates)));
                    sourceEnd = dateUtils.formatDate(new Date(Math.max(...dates)));
                } else {
                    sourceStart = null;
                    sourceEnd = null;
                }

                updates.push({
                    taskId: taskId,
                    updates: {
                        timeRanges: newSourceRanges,
                        startDate: sourceStart,
                        endDate: sourceEnd
                    }
                });
            }

            // 2. Add to Target (Effective Target or Source if Copying to Self)
            const destTask = effectiveTargetTask || sourceTask;

            const newRange = {
                ...rangeMoving,
                id: isCopyMode ? generateId() : rangeMoving.id, // Generate new ID if copying
                startDate: dateUtils.formatDate(finalStart),
                endDate: dateUtils.formatDate(finalEnd),
                color: rangeMoving.color || sourceTask.color // Preserve color
            };

            // Calculate destination ranges
            // If dest is source (Copy to self), we need to append to *current* ranges (but care for simultaneous updates if we removed above? No, we prepare `updates` list).
            // Actually if dest == source (Copy Self), `updates` list might conflict if we push two updates for same task?
            // `onUpdateTasks` handles array.
            // If we have two entries for one task, it might be issue.
            // So we should merge logic.

            let destRanges = [];
            if (destTask.id === taskId && !isCopyMode) {
                // Should not reach here because `effectiveTargetTask` is null.
                // Logic falls through to "else" block below for standard move.
                // BUT what if `isCopyMode` is true and `effectiveTargetTask` is null? (Copy to self)
                // We are in this block.
                destRanges = [...(sourceTask.timeRanges || [])]; // Original ranges
            } else if (destTask.id === taskId && isCopyMode) {
                // Copy to self. Source ranges are NOT removed.
                destRanges = [...(sourceTask.timeRanges || [])];
            } else {
                // Moving/Copying to another task
                destRanges = [...(destTask.timeRanges || [])];
            }

            // Add new range
            destRanges.push(newRange);

            // Recalc Dest Min/Max
            const destDates = destRanges.flatMap(r => [new Date(r.startDate), new Date(r.endDate)]);
            const destStart = dateUtils.formatDate(new Date(Math.min(...destDates)));
            const destEnd = dateUtils.formatDate(new Date(Math.max(...destDates)));

            // If Copying to Self (destTask.id === taskId), we only need ONE update entry.
            if (destTask.id === taskId && isCopyMode) {
                updates.push({
                    taskId: taskId,
                    updates: {
                        timeRanges: destRanges,
                        startDate: destStart,
                        endDate: destEnd
                    }
                });
            } else if (destTask.id !== taskId) {
                // Target update
                updates.push({
                    taskId: destTask.id,
                    updates: {
                        timeRanges: destRanges,
                        startDate: destStart,
                        endDate: destEnd
                    }
                });
            }

            if (onUpdateTasks) {
                onUpdateTasks(updates, true);
            } else {
                updates.forEach(u => onUpdateTask(u.taskId, u.updates, true));
            }

        } else {
            // Standard Move (Same Task, No Copy)
            let newRanges = sourceTask.timeRanges ? [...sourceTask.timeRanges] : [{ id: 'legacy', startDate: sourceTask.startDate, endDate: sourceTask.endDate }];
            const rangeIndex = newRanges.findIndex(r => r.id === rangeId);

            if (rangeIndex >= 0) {
                newRanges[rangeIndex] = {
                    ...newRanges[rangeIndex],
                    startDate: dateUtils.formatDate(finalStart),
                    endDate: dateUtils.formatDate(finalEnd)
                };
            } else if (rangeId === 'legacy') {
                newRanges = [{ id: generateId(), startDate: dateUtils.formatDate(finalStart), endDate: dateUtils.formatDate(finalEnd) }];
            }

            const allDates = newRanges.flatMap(r => [new Date(r.startDate), new Date(r.endDate)]);
            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));

            onUpdateTask(taskId, {
                timeRanges: newRanges,
                startDate: dateUtils.formatDate(minDate),
                endDate: dateUtils.formatDate(maxDate)
            }, true);
        }
    }, [flatTasks, onUpdateTask, onUpdateTasks, getTaskFromY]);

    // 가이드라인 이동 핸들러
    const handleGuideMove = (offset) => {
        setGuideLineX(offset);
    };

    const handleMilestoneDragMove = (mouseY) => {
        const targetTask = getTaskFromY(mouseY);
        setDragTargetTaskId(targetTask ? targetTask.id : null);
    };

    const handleMilestoneDragEnd = (sourceTaskId, milestoneId, newDate, isCopyMode) => {
        setDragTargetTaskId(null); // Clear highlight immediately

        // 대상 작업 결정 (세로 드래그 했으면 dragTargetTaskId, 아니면 원래 작업)
        const targetTaskId = dragTargetTaskId || sourceTaskId;

        // 원본 작업에서 마일스톤 찾기
        const sourceTask = flatTasks.find(t => t.id === sourceTaskId);
        if (!sourceTask || !sourceTask.milestones) return;

        const milestone = sourceTask.milestones.find(m => m.id === milestoneId);
        if (!milestone) return;

        // Effective Target
        const targetTask = flatTasks.find(t => t.id === targetTaskId);
        if (!targetTask) return;

        // Check if we are really moving/copying to a different task OR same task
        const isSameTask = (targetTaskId === sourceTaskId);

        // Case 1: Same Task Update (Move) or Copy to Self
        if (isSameTask && !isCopyMode) {
            const updatedMilestones = sourceTask.milestones.map(m =>
                m.id === milestoneId
                    ? { ...m, date: newDate }
                    : m
            );
            onUpdateTask(sourceTaskId, { milestones: updatedMilestones }, true);
            setDragTargetTaskId(null);
            return;
        }

        // Case 2: Cross Task Move/Copy OR Same Task Copy

        // 1. Handle Source (Remove only if NOT copy mode)
        let updatedSourceMilestones = sourceTask.milestones;
        if (!isCopyMode) {
            updatedSourceMilestones = sourceTask.milestones.filter(m => m.id !== milestoneId);
        }

        // 2. Handle Target (Add)
        // If Copying, generate new ID. If Moving, keep ID (unless conflict? IDs are UUIDs usually).
        const newMilestone = {
            ...milestone,
            id: isCopyMode ? generateId() : milestone.id,
            date: newDate
        };

        // Special Case: Copy to Self
        // If Copy to Self, `targetTask` IS `sourceTask`.
        // `updatedSourceMilestones` ALREADY contains the original (because we didn't filter).
        // So we appending `newMilestone` to `updatedSourceMilestones` is correct.
        // BUT if `!isCopyMode`, we filtered it out. So appending `newMilestone` to `updatedSourceMilestones` (which is filtered) is effectively a Move (Update).

        let finalTargetMilestones = [];

        if (isSameTask) {
            // Same Task: Source and Target are same.
            // `updatedSourceMilestones` holds state after removal (if move).
            finalTargetMilestones = [...updatedSourceMilestones, newMilestone];

            // Single Update
            onUpdateTask(sourceTaskId, { milestones: finalTargetMilestones }, true);
        } else {
            // Cross Task
            // Source Update (if changed)
            const updates = [];

            if (!isCopyMode) {
                updates.push({
                    taskId: sourceTaskId,
                    updates: { milestones: updatedSourceMilestones }
                });
            }

            // Target Update
            const currentTargetMilestones = targetTask.milestones || [];
            finalTargetMilestones = [...currentTargetMilestones, newMilestone];

            updates.push({
                taskId: targetTaskId,
                updates: { milestones: finalTargetMilestones }
            });

            if (onUpdateTasks) {
                onUpdateTasks(updates, true);
            } else {
                updates.forEach(u => onUpdateTask(u.taskId, u.updates, true));
            }
        }

        setDragTargetTaskId(null);
    };

    // 줌 레벨에 따른 컨텐츠 너비
    const contentWidth = containerWidth * zoomLevel;

    // 오늘 날짜 마커 위치 계산
    const todayPosition = useMemo(() => {
        if (!showToday) return null;
        const today = new Date();
        // 타임라인 범위 밖이어도 계산은 하되, 렌더링 시 클리핑되거나 안보일 수 있음
        // 하지만 사용자 요청대로 전체 높이 바를 그리려면 여기 있어야 함
        const rangeDuration = dateUtils.getDuration(dateRange.start, dateRange.end);
        const daysFromStart = dateUtils.getDaysBetween(dateRange.start, today);

        // 범위 체크 (선택사항, 하지만 범위 밖이면 안그리는게 나을 수 있음)
        if (today < dateRange.start || today > dateRange.end) return null;

        return (daysFromStart / rangeDuration) * contentWidth;
    }, [showToday, dateRange, contentWidth]);

    // 작업 클릭 핸들러 (연결 모드 처리)
    const handleTaskClick = (taskId, rangeId) => {
        if (isLinkingMode) {
            // 소스 (Task or Range)
            // If linking FROM a range, linkSourceTaskId is assumed to be an ID (Task or Range).

            // Allow linking if IDs are different.
            // Even if taskId is same, if rangeId is valid and different from linkSourceTaskId, it's allowed.

            if (taskId === linkSourceTaskId) {
                // Task ID matches source.
                // Check if it is a Range-to-Range link within same task
                if (!rangeId) {
                    // Clicked on Task itself (or legacy), and Source is same Task. Block.
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                    return;
                }

                if (rangeId === linkSourceTaskId) {
                    // Clicked on SAME Range. Block.
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                    return;
                }

                // If rangeId != linkSourceTaskId, we proceed (Same Task, Different Range)
            } else if (rangeId && rangeId === linkSourceTaskId) {
                // Should be covered above, but safe check
                setIsLinkingMode(false);
                setLinkSourceTaskId(null);
                return;
            }

            // 의존성 추가 (Target: Range if rangeId present, else Task)
            // We want to add dependency TO the specific range if clicked.

            const targetTask = flatTasks.find(t => t.id === taskId);
            if (targetTask) {
                // If rangeId is provided, look up the range
                let targetId = taskId;
                let currentDependencies = targetTask.dependencies || [];

                if (rangeId) {
                    const targetRange = (targetTask.timeRanges || []).find(r => r.id === rangeId);
                    if (targetRange) {
                        targetId = rangeId; // Link to range
                        currentDependencies = targetRange.dependencies || [];
                    }
                }

                // Check existence
                if (currentDependencies.includes(linkSourceTaskId)) {
                    alert('이미 연결된 항목입니다.');
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                    return;
                }

                // Check cyclic (Simplified: strict check difficult without graph traversal, skipping for now or basic check)

                // Update
                if (rangeId && targetId === rangeId) {
                    // Update Range
                    const newRanges = targetTask.timeRanges.map(r => {
                        if (r.id === rangeId) {
                            return { ...r, dependencies: [...(r.dependencies || []), linkSourceTaskId] };
                        }
                        return r;
                    });
                    onUpdateTask(taskId, { timeRanges: newRanges });
                } else {
                    // Update Task (Legacy)
                    const newDependencies = [...(targetTask.dependencies || []), linkSourceTaskId];
                    onUpdateTask(taskId, { dependencies: newDependencies });
                }

                setIsLinkingMode(false);
                setLinkSourceTaskId(null);
            }
        } else {
            onSelectTask(taskId);
        }
    };

    // 마일스톤 클릭 핸들러 (연결 모드 처리)
    const handleMilestoneClick = (e, milestone) => {
        e.stopPropagation();

        if (isLinkingMode) {
            if (milestone.id === linkSourceTaskId) {
                setIsLinkingMode(false);
                setLinkSourceTaskId(null);
                return;
            }

            // 의존성 추가 (Target: Milestone)
            // 마일스톤이 속한 작업을 찾아서 업데이트해야 함
            const parentTask = flatTasks.find(t => t.milestones && t.milestones.some(m => m.id === milestone.id));

            if (parentTask) {
                const updatedMilestones = parentTask.milestones.map(m => {
                    if (m.id === milestone.id) {
                        const currentDeps = m.dependencies || [];
                        if (currentDeps.includes(linkSourceTaskId)) {
                            alert('이미 연결된 마일스톤입니다.');
                            return m;
                        }
                        return { ...m, dependencies: [...currentDeps, linkSourceTaskId] };
                    }
                    return m;
                });

                // 변경사항이 있을 때만 업데이트
                const targetMilestone = updatedMilestones.find(m => m.id === milestone.id);
                if (targetMilestone.dependencies.length !== (milestone.dependencies || []).length) {
                    onUpdateTask(parentTask.id, { milestones: updatedMilestones });
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                } else {
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                }
            }
        }
    };

    // Sidebar Resize Handler
    useEffect(() => {
        if (!isResizingSidebar) return;

        const handleMouseMove = (e) => {
            if (containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect();
                let newWidth = e.clientX - containerRect.left;

                // Constraints
                if (newWidth < 100) newWidth = 100;
                if (newWidth > 600) newWidth = 600;

                setSidebarWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizingSidebar(false);
            document.body.style.cursor = 'default';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };
    }, [isResizingSidebar]);

    // 우클릭 핸들러
    const handleContextMenu = (e, task, date, rangeId) => {
        e.preventDefault();
        setMilestoneEditInfo(null); // 마일스톤 팝오버 닫기
        if (onContextMenu) {
            // Pass rangeId to App
            onContextMenu(e, task.id, date, rangeId);
        }
    };

    // 마일스톤 우클릭 핸들러
    const handleMilestoneContextMenu = (e, task, milestone) => {
        e.preventDefault();
        setMilestoneEditInfo({
            x: e.clientX,
            y: e.clientY,
            task,
            milestone
        });
    };





    const handleUpdateMilestone = (milestoneId, updates) => {
        if (!milestoneEditInfo) return;

        const { task } = milestoneEditInfo;
        const currentTask = flatTasks.find(t => t.id === task.id);

        if (currentTask && currentTask.milestones) {
            const updatedMilestones = currentTask.milestones.map(m =>
                m.id === milestoneId ? { ...m, ...updates } : m
            );
            onUpdateTask(task.id, { milestones: updatedMilestones });

            // 업데이트 후 팝오버 정보도 갱신 (즉시 반영을 위해)
            const updatedMilestone = updatedMilestones.find(m => m.id === milestoneId);
            setMilestoneEditInfo(prev => ({
                ...prev,
                milestone: updatedMilestone
            }));
        }
    };

    const handleDeleteMilestone = (milestoneId) => {
        if (!milestoneEditInfo) return;

        const { task } = milestoneEditInfo;
        const currentTask = flatTasks.find(t => t.id === task.id);

        if (currentTask && currentTask.milestones) {
            const updatedMilestones = currentTask.milestones.filter(m => m.id !== milestoneId);
            onUpdateTask(task.id, { milestones: updatedMilestones });
            setMilestoneEditInfo(null);
        }
    };

    // 연결 모드 시작
    const startLinking = (taskId) => {
        setIsLinkingMode(true);
        setLinkSourceTaskId(taskId);
    };

    // 이미지 복사 핸들러
    const handleCopyToClipboard = async () => {
        if (!captureRef.current) return;

        try {
            // 캡처 시작: 클래스 추가
            if (containerRef.current) {
                containerRef.current.classList.add('capturing');
            }

            // 전체 스크롤 영역 확보를 위한 임시 스타일 적용
            const captureContainer = captureRef.current; // captureContainer 선언을 최상단으로 이동

            const scrollContainer = timelineScrollRef.current;
            const taskNamesContainer = taskNamesScrollRef.current;

            const originalScrollOverflow = scrollContainer.style.overflow;
            const originalScrollWidth = scrollContainer.style.width;

            // 작업명 컬럼 스타일 백업
            let originalTaskNamesOverflow = '';
            let originalTaskNamesHeight = '';

            // 타임라인 컨테이너 확장 (스크롤 내용이 다 보이도록)
            scrollContainer.style.overflow = 'visible';
            // scrollContainer.style.width = 'max-content'; // 또는 contentWidth + px

            // 작업명 컬럼 확장
            if (taskNamesContainer) {
                originalTaskNamesOverflow = taskNamesContainer.style.overflowY;
                originalTaskNamesHeight = taskNamesContainer.style.height;
                taskNamesContainer.style.overflowY = 'visible';
                taskNamesContainer.style.height = 'auto';
            }

            // 높이 결정: 데이터 기반 (DOM 의존성 제거, Stale Closure 방지 위해 flatTasks 직접 참조)
            const header = captureContainer.querySelector('.timeline-header');
            const headerHeight = header ? header.offsetHeight : (isCompact ? 50 : 70);
            const rowHeightVal = isCompact ? 28 : 40;

            // timelineContent 요소 참조 (스타일 조작을 위해 필요)
            const timelineContent = captureContainer.querySelector('.timeline-content');

            // DOM 쿼리 대신 현재 데이터(flatTasks) 개수 사용
            // flatTasks는 컴포넌트 렌더링에 사용되는 데이터이므로 가장 정확함
            let rowCount = 0;
            if (flatTasks && flatTasks.length > 0) {
                rowCount = flatTasks.length;
            } else if (timelineContent) {
                // 혹시 flatTasks가 캡처 시점에 비어있다면(거의 없음) DOM fallback
                const bars = timelineContent.querySelectorAll('.timeline-bar');
                rowCount = bars.length;
            }

            // 여유 버퍼 완전 제거 (0px) - 사용자 요청 (흰색 여백 제거)
            let contentHeight = headerHeight + (rowCount * rowHeightVal);

            // 만약 여전히 0이면 기존 방식으로 fallback
            if (contentHeight <= headerHeight + 5) { // 헤더만 있는 수준이면
                const scrollContainer = timelineScrollRef.current;
                contentHeight = Math.max(contentHeight, scrollContainer.scrollHeight);
            } else {
                // 정확히 계산된 높이 사용 (불필요한 공백 제거)
                // 너무 작지 않게 최소값 보정 (헤더만 찍히는 경우 방지)
                contentHeight = Math.max(contentHeight, headerHeight + 50);
            }

            const captureHeight = `${contentHeight}px`;

            // captureContainer는 상단에서 이미 선언됨
            const originalCaptureWidth = captureContainer.style.width;
            const originalCaptureHeight = captureContainer.style.height;
            const originalCaptureOverflow = captureContainer.style.overflow;
            const originalCaptureBg = captureContainer.style.backgroundColor; // 백업

            captureContainer.style.width = 'max-content';
            captureContainer.style.height = captureHeight; // max-content 대신 측정된 높이 사용
            captureContainer.style.overflow = 'visible'; // 캡처 시 overflow 해제
            captureContainer.style.backgroundColor = darkMode ? '#1E1E1E' : '#FFFFFF'; // 배경색 강제 적용 (여백 포함)

            // timeline-content의 min-height 무력화 및 높이 강제 설정 (배경색 끊김 방지)
            let originalMinHeight = '';
            let originalHeight = '';
            if (timelineContent) {
                originalMinHeight = timelineContent.style.minHeight;
                originalHeight = timelineContent.style.height;
                timelineContent.style.minHeight = '0';
                timelineContent.style.height = '100%'; // 컨테이너 높이에 맞춤
            }

            // html2canvas 옵션에 측정된 높이 적용
            const canvas = await html2canvas(captureRef.current, {
                scale: 2, // 고해상도
                useCORS: true,
                logging: false,
                backgroundColor: darkMode ? '#1E1E1E' : '#FFFFFF',
                width: captureContainer.scrollWidth,
                height: contentHeight,
                windowWidth: captureContainer.scrollWidth,
                windowHeight: contentHeight,
                onclone: (clonedDoc) => {
                    // 클론된 문서에서 추가적인 스타일 조정이 필요할 경우 여기서 처리
                    const clonedContent = clonedDoc.querySelector('.timeline-content');
                    if (clonedContent) {
                        clonedContent.style.minHeight = '0';
                        clonedContent.style.height = 'auto';
                    }
                }
            });

            // 스타일 복구
            scrollContainer.style.overflow = originalScrollOverflow;
            scrollContainer.style.width = originalScrollWidth;

            if (taskNamesContainer) {
                taskNamesContainer.style.overflowY = originalTaskNamesOverflow;
                taskNamesContainer.style.height = originalTaskNamesHeight;
            }

            captureContainer.style.width = originalCaptureWidth;
            captureContainer.style.height = originalCaptureHeight;
            captureContainer.style.overflow = originalCaptureOverflow;
            captureContainer.style.backgroundColor = originalCaptureBg; // 복구

            // min-height 및 height 복구
            if (timelineContent) {
                timelineContent.style.minHeight = originalMinHeight;
                timelineContent.style.height = originalHeight;
            }

            // 컨테이너 클래스 제거
            if (containerRef.current) {
                containerRef.current.classList.remove('capturing');
            }

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    alert('이미지 생성 실패');
                    return;
                }
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    alert('타임라인 이미지가 클립보드에 복사되었습니다.');
                } catch (err) {
                    console.error('클립보드 복사 실패:', err);
                    // 클립보드 복사 실패 시 (보안 정책 등) 이미지 다운로드로 대체
                    try {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `timeline-capture-${new Date().toISOString().slice(0, 10)}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        alert('클립보드 접근 권한 문제로 이미지를 다운로드했습니다.');
                    } catch (downloadErr) {
                        console.error('다운로드 실패:', downloadErr);
                        alert('이미지 저장에 실패했습니다.');
                    }
                }
            });
        } catch (err) {
            console.error('이미지 캡처 실패:', err);
            alert(`이미지 캡처 중 오류가 발생했습니다: ${err.message}`);
        }
    };



    // 의존성 선 렌더링
    const renderDependencies = () => {
        const lines = [];
        const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
        const rowHeight = isCompact ? 28 : 40;

        // 2. 의존성 선 그리기
        flatTasks.forEach((task) => {
            // A. Time Ranges 의존성 처리
            if (task.timeRanges) {
                task.timeRanges.forEach(range => {
                    if (range.dependencies) {
                        range.dependencies.forEach(depId => {
                            const source = itemMap.get(depId);
                            // Target is current range
                            const target = itemMap.get(range.id);

                            if (source && target) {
                                lines.push(drawDependencyLine(source, target, totalDays, contentWidth, rowHeight));
                            }
                        });
                    }
                });
            }

            // Legacy / Fallback for task.dependencies (if any left) -> map to first range?
            // itemMap.get(task.id) points to Task object.
            // But we prefer Range-to-Range. 
            // If data is migrated, task.dependencies should be empty.

            // B. 마일스톤 의존성 처리
            if (task.milestones) {
                task.milestones.forEach(ms => {
                    if (ms.dependencies) {
                        ms.dependencies.forEach(depId => {
                            const source = itemMap.get(depId);
                            const target = itemMap.get(ms.id);

                            if (source && target) {
                                lines.push(drawDependencyLine(source, target, totalDays, contentWidth, rowHeight));
                            }
                        });
                    }
                });
            }
        });

        return (
            <svg className="dependency-layer" style={{ width: contentWidth, height: flatTasks.length * (isCompact ? 28 : 40) }}>
                <defs>
                    <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                    >
                        <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
                    </marker>
                </defs>
                {lines}
            </svg>
        );
    };

    // 의존성 선 그리기 헬퍼 함수
    const drawDependencyLine = (source, target, totalDays, contentWidth, rowHeight) => {
        let startX, startY, endX, endY;

        // 시작점 계산 (Source)
        if (source.type === 'task' || source.type === 'range') {
            // 작업/범위인 경우: 종료일 기준
            const sourceDate = new Date(source.endDate); // itemMap stores timestamp or string
            const sourceDays = dateUtils.getDuration(dateRange.start, sourceDate);
            startX = (sourceDays / totalDays) * contentWidth;

            if (source.type === 'range') {
                startY = source.index * rowHeight + rowHeight / 2; // Same row as task
            } else {
                startY = source.index * rowHeight + rowHeight / 2;
            }
        } else {
            // 마일스톤인 경우: 해당 날짜 기준
            const sourceDays = dateUtils.getDuration(dateRange.start, source.date);
            startX = (sourceDays / totalDays) * contentWidth;
            startY = source.parentIndex * rowHeight + rowHeight / 2;
        }

        // 끝점 계산 (Target)
        if (target.type === 'task' || target.type === 'range') {
            // 작업/범위인 경우: 시작일 기준
            const targetDate = new Date(target.startDate);
            const targetDays = dateUtils.getDaysBetween(dateRange.start, targetDate);
            endX = (targetDays / totalDays) * contentWidth;

            if (target.type === 'range') {
                endY = target.index * rowHeight + rowHeight / 2;
            } else {
                endY = target.index * rowHeight + rowHeight / 2;
            }
        } else {
            // 마일스톤인 경우: 해당 날짜 기준
            const targetDays = dateUtils.getDaysBetween(dateRange.start, target.date);
            endX = (targetDays / totalDays) * contentWidth;
            endY = target.parentIndex * rowHeight + rowHeight / 2;
        }

        // 경로 생성 로직
        const midX = startX + 20;
        let path = '';

        if (startX < endX - 40) {
            path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
        } else if (startY === endY && startX < endX) {
            // Same row, forward direction (even if gap is small) -> Straight Line
            path = `M ${startX} ${startY} L ${endX} ${endY}`;
        } else {
            const backX = startX + 10;
            const forwardX = endX - 30;
            const midY = (startY + endY) / 2;
            path = `M ${startX} ${startY} L ${backX} ${startY} L ${backX} ${midY} L ${forwardX} ${midY} L ${forwardX} ${endY} L ${endX} ${endY}`;
        }

        return (
            <path
                key={`${source.data.id}-${target.data.id}`}
                d={path}
                fill="none"
                stroke="#999"
                strokeWidth="2"
                strokeDasharray="4 2"
                markerEnd="url(#arrowhead)"
            />
        );
    };



    // 마일스톤용 선행/후행 찾기
    const milestonePredecessors = useMemo(() => {
        if (!milestoneEditInfo) return [];
        const { milestone } = milestoneEditInfo;
        const preds = [];
        if (milestone.dependencies) {
            milestone.dependencies.forEach(depId => {
                const item = itemMap.get(depId);
                if (item) preds.push({ id: item.data.id, name: item.name });
            });
        }
        return preds;
    }, [milestoneEditInfo, itemMap]);

    const milestoneSuccessors = useMemo(() => {
        if (!milestoneEditInfo) return [];
        const { milestone } = milestoneEditInfo;
        const succs = [];

        // 1. 작업이 마일스톤을 의존하는 경우
        flatTasks.forEach(t => {
            if (t.dependencies && t.dependencies.includes(milestone.id)) {
                succs.push({ id: t.id, name: t.name });
            }
        });

        // 2. 다른 마일스톤이 이 마일스톤을 의존하는 경우
        flatTasks.forEach(t => {
            if (t.milestones) {
                t.milestones.forEach(ms => {
                    if (ms.dependencies && ms.dependencies.includes(milestone.id)) {
                        succs.push({ id: ms.id, name: ms.label || '마일스톤' });
                    }
                });
            }
        });

        return succs;
    }, [milestoneEditInfo, flatTasks, itemMap]);

    // 의존성 제거 핸들러
    const handleRemoveDependency = (targetId, dependencyId) => {
        // 1. Target이 작업인 경우
        const targetTask = flatTasks.find(t => t.id === targetId);
        if (targetTask) {
            const newDeps = targetTask.dependencies.filter(id => id !== dependencyId);
            onUpdateTask(targetId, { dependencies: newDeps });
            return;
        }

        // 2. Target이 마일스톤인 경우
        const parentTask = flatTasks.find(t => t.milestones && t.milestones.some(m => m.id === targetId));
        if (parentTask) {
            const updatedMilestones = parentTask.milestones.map(m => {
                if (m.id === targetId) {
                    const newDeps = (m.dependencies || []).filter(id => id !== dependencyId);
                    return { ...m, dependencies: newDeps };
                }
                return m;
            });
            onUpdateTask(parentTask.id, { milestones: updatedMilestones });

            // 팝오버 정보 갱신
            if (milestoneEditInfo && milestoneEditInfo.milestone.id === targetId) {
                const updatedMilestone = updatedMilestones.find(m => m.id === targetId);
                setMilestoneEditInfo(prev => ({ ...prev, milestone: updatedMilestone }));
            }
        }
    };

    // Expose copyToClipboard to parent
    useImperativeHandle(ref, () => ({
        copyToClipboard: handleCopyToClipboard,
        startLinking
    }), [handleCopyToClipboard, startLinking]);

    return (
        <div className={`timeline-view ${viewMode === 'split' ? 'split-mode' : ''} ${isCompact ? 'compact-mode' : ''}`} ref={containerRef}>
            <div className={`timeline-container ${showTaskNames ? 'with-names' : ''}`} ref={captureRef}>
                {/* ... (Existing JSX) ... */}
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
                    {/* Resize Handle */}
                    <div
                        className="sidebar-resize-handle"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setIsResizingSidebar(true);
                            if (containerRef.current) {
                                sidebarRef.current = e.clientX;
                            }
                        }}
                        style={{
                            width: '4px',
                            cursor: 'col-resize',
                            backgroundColor: isResizingSidebar ? 'var(--color-primary)' : 'transparent',
                            zIndex: 10,
                            position: 'relative',
                            marginLeft: '-2px', // Overlap slightly for easier grabbing? Or just put it between.
                            // Flex layout handles position.
                            flex: '0 0 4px',
                        }}
                    />
                </>)}

                {/* 타임라인 스크롤 컨테이너 */}
                <div className="timeline-scroll-container" ref={timelineScrollRef}>
                    {/* 오늘 날짜 마커 (전체 높이) */}
                    {todayPosition !== null && (
                        <div className="today-marker" style={{ left: `${todayPosition}px` }} />
                    )}

                    {/* 타임라인 헤더 */}
                    <TimelineHeader
                        startDate={dateRange.start}
                        endDate={dateRange.end}
                        timeScale={timeScale}
                        containerWidth={contentWidth}
                        showToday={showToday}
                        onClick={() => onSelectTask(null)}
                    />

                    {/* 타임라인 바들 */}
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

                                // Use new context menu prop for empty space too?
                                // User request was "Right click on TableView".
                                // For Timeline empty space "Add Milestone" is existing feature.
                                // I should preserve "Add Milestone" logic here if I can't pass it to App easily.
                                // NOTE: I am moving 'Context Menu' logic to App, but 'Add Milestone' modal logic is still local.
                                // So I will keep this logic but maybe invoke it differently?
                                // Actually user didn't ask to change Timeline Empty Space behavior.
                                // But `TimelineBar` right click behaviour WAS changed to use `handleContextMenu`.
                                // Let's keep empty space behavior as is (Milestone Add), OR unify?
                                // User said "Support context menu in TableView".
                                // TimelineView already had context menu on Tasks.
                                // I moved the 'Task Settings' popover to App.
                                // So TimelineBar right click triggers App's popover.
                                // Empty space right click triggers... Milestone Modal (local state). This is fine.

                                const targetTask = flatTasks.find(t => t.id === selectedTaskId) || flatTasks[0];

                                if (targetTask) {
                                    if (onOpenMilestoneAdd) {
                                        onOpenMilestoneAdd({ task: targetTask, date: clickedDate });
                                    }
                                }
                            }
                        }}
                    >
                        {/* 가이드라인 (드래그 시에만 표시) */}
                        {guideLineX !== null && (
                            <div
                                className="timeline-guide-line"
                                style={{ left: guideLineX }}
                            />
                        )}
                        {/* 의존성 라인 레이어 */}
                        {renderDependencies()}

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
                                    onSelect={(taskId, rangeId) => handleTaskClick(taskId, rangeId)}
                                    onDragUpdate={handleDragUpdate}
                                    onDragEnd={handleTimelineBarDragEnd}
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
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Remove TimelineBarPopover as it is now in App.jsx */}



            {/* 마일스톤 편집 팝오버 */}
            {
                milestoneEditInfo && (
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
                )
            }


        </div >
    );
});

export default TimelineView;
