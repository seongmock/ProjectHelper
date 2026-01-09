import React, { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
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
import MilestoneQuickAdd from './MilestoneQuickAdd';
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
    onMoveTask,
    onIndentTask, // Add prop
    onOutdentTask, // Add prop
    timeScale,
    viewMode,
    // Props from App
    zoomLevel = 1.0,
    showToday = true,
    isCompact = false,
    showTaskNames = true,
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
    const [popoverInfo, setPopoverInfo] = useState(null); // { x, y, taskId, date }
    const [milestoneModalInfo, setMilestoneModalInfo] = useState(null); // { task, date }
    const [milestoneEditInfo, setMilestoneEditInfo] = useState(null); // { x, y, task, milestone }

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

    // Expose copyToClipboard to parent
    useImperativeHandle(ref, () => ({
        copyToClipboard: handleCopyToClipboard
    }));

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
                if (item.startDate) dates.push(new Date(item.startDate));
                if (item.endDate) dates.push(new Date(item.endDate));

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
            // 작업 정보 저장
            map.set(task.id, {
                type: 'task',
                data: task,
                index: index,
                startDate: task.startDate,
                endDate: task.endDate,
                name: task.name
            });

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

    // 드래그로 날짜 변경 - 드래그 중에는 호출하지 않음 (시각적 피드백은 로컬 상태로)
    const handleDragUpdate = (taskId, newStartDate, newEndDate) => {
        // 드래그 중에는 아무것도 하지 않음 - 로컬 DOM만 업데이트됨
        // onUpdateTask는 호출하지 않아서 히스토리 오염 방지
    };

    // 타임라인 바 드래그 완료 시 최종 상태를 히스토리에 기록
    const handleTimelineBarDragEnd = (taskId, finalStart, finalEnd) => {
        onUpdateTask(taskId, {
            startDate: dateUtils.formatDate(finalStart),
            endDate: dateUtils.formatDate(finalEnd),
        }, true); // 히스토리에 추가
    };

    // 가이드라인 상태
    const [guideLineX, setGuideLineX] = useState(null);

    // 가이드라인 이동 핸들러 (이제 clientX가 아닌 상대적 offset을 받음)
    const handleGuideMove = (offset) => {
        setGuideLineX(offset);
    };

    // 마일스톤 드래그 완료 시 날짜 업데이트
    const [dragTargetTaskId, setDragTargetTaskId] = useState(null);

    const handleMilestoneDragMove = (mouseY) => {
        // 마우스 Y 위치로 대상 작업 찾기
        const timelineRows = document.querySelectorAll('.timeline-row[data-task-id]');
        let targetTask = null;

        timelineRows.forEach((row) => {
            const rect = row.getBoundingClientRect();
            if (mouseY >= rect.top && mouseY <= rect.bottom) {
                const taskId = row.getAttribute('data-task-id');
                targetTask = taskId;
            }
        });

        setDragTargetTaskId(targetTask);
    };

    const handleMilestoneDragEnd = (sourceTaskId, milestoneId, newDate) => {
        // 대상 작업 결정 (세로 드래그 했으면 dragTargetTaskId, 아니면 원래 작업)
        const targetTaskId = dragTargetTaskId || sourceTaskId;

        // 원본 작업에서 마일스톤 찾기
        const sourceTask = flatTasks.find(t => t.id === sourceTaskId);
        if (!sourceTask || !sourceTask.milestones) return;

        const milestone = sourceTask.milestones.find(m => m.id === milestoneId);
        if (!milestone) return;

        // 같은 작업이면 날짜만 업데이트
        if (targetTaskId === sourceTaskId) {
            const updatedMilestones = sourceTask.milestones.map(m =>
                m.id === milestoneId
                    ? { ...m, date: newDate }
                    : m
            );
            onUpdateTask(sourceTaskId, {
                milestones: updatedMilestones
            }, true);
        } else {
            // 다른 작업으로 이동 - 두 작업을 동시에 업데이트
            const targetTask = flatTasks.find(t => t.id === targetTaskId);
            if (!targetTask) return;

            // 1. 원본에서 제거
            const updatedSourceMilestones = sourceTask.milestones.filter(m => m.id !== milestoneId);

            // 2. 대상에 추가 (with new date)
            const updatedTargetMilestones = [
                ...(targetTask.milestones || []),
                { ...milestone, date: newDate }
            ];

            // 3. 원자적 업데이트 (Undo 시 한 번에 되돌리기 위함)
            if (onUpdateTasks) {
                onUpdateTasks([
                    { taskId: sourceTaskId, updates: { milestones: updatedSourceMilestones } },
                    { taskId: targetTaskId, updates: { milestones: updatedTargetMilestones } }
                ], true);
            } else {
                // Fallback (기존 방식 - 문제점: undo 시 마일스톤 증발 가능성)
                onUpdateTask(sourceTaskId, { milestones: updatedSourceMilestones }, false);
                onUpdateTask(targetTaskId, { milestones: updatedTargetMilestones }, true);
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
    const handleTaskClick = (taskId) => {
        if (isLinkingMode) {
            if (taskId === linkSourceTaskId) {
                // 자기 자신 선택 시 취소
                setIsLinkingMode(false);
                setLinkSourceTaskId(null);
                return;
            }

            // 의존성 추가 (Target: Task)
            const targetTask = flatTasks.find(t => t.id === taskId);
            if (targetTask) {
                // 이미 존재하는지 확인
                if (targetTask.dependencies && targetTask.dependencies.includes(linkSourceTaskId)) {
                    alert('이미 연결된 작업입니다.');
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                    return;
                }

                // 순환 참조 방지 (간단한 체크 - 소스가 작업인 경우만)
                const sourceTask = flatTasks.find(t => t.id === linkSourceTaskId);
                if (sourceTask && sourceTask.dependencies && sourceTask.dependencies.includes(taskId)) {
                    alert('순환 참조가 발생할 수 있어 연결할 수 없습니다.');
                    setIsLinkingMode(false);
                    setLinkSourceTaskId(null);
                    return;
                }

                const newDependencies = [...(targetTask.dependencies || []), linkSourceTaskId];
                onUpdateTask(taskId, { dependencies: newDependencies });
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

    // 우클릭 핸들러
    const handleContextMenu = (e, task, date) => {
        e.preventDefault();
        setMilestoneEditInfo(null); // 마일스톤 팝오버 닫기
        setPopoverInfo({
            x: e.clientX,
            y: e.clientY,
            taskId: task.id, // ID만 저장
            date // 클릭한 날짜 정보 추가
        });
    };

    // 마일스톤 우클릭 핸들러
    const handleMilestoneContextMenu = (e, task, milestone) => {
        e.preventDefault();
        setPopoverInfo(null); // 작업 팝오버 닫기
        setMilestoneEditInfo({
            x: e.clientX,
            y: e.clientY,
            task,
            milestone
        });
    };



    const handleAddMilestone = (taskId, milestoneData) => {
        const task = tasks.find(t => t.id === taskId);
        const newMilestone = {
            id: generateId(),
            ...milestoneData
        };

        const currentTask = flatTasks.find(t => t.id === taskId);
        if (currentTask) {
            const updatedMilestones = [...(currentTask.milestones || []), newMilestone];
            onUpdateTask(taskId, { milestones: updatedMilestones });
        }
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
        setPopoverInfo(null); // 팝오버 닫기
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

            // 실제 콘텐츠 높이를 DOM에서 측정 (계산 오류 방지)
            const leftColumnHeight = (taskNamesContainer ? taskNamesContainer.scrollHeight : 0) + (isCompact ? 50 : 70); // 리스트 + 헤더 추정치 (또는 헤더 요소 측정)
            // timelineScrollRef는 헤더와 콘텐츠를 모두 포함함
            const rightColumnHeight = scrollContainer.scrollHeight;

            // 더 큰 높이 사용
            const contentHeight = Math.max(leftColumnHeight, rightColumnHeight);

            // 여분을 조금 두거나 딱 맞게 설정
            const captureHeight = `${contentHeight}px`;

            const captureContainer = captureRef.current;
            const originalCaptureWidth = captureContainer.style.width;
            const originalCaptureHeight = captureContainer.style.height;
            captureContainer.style.width = 'max-content';
            captureContainer.style.height = captureHeight; // max-content 대신 측정된 높이 사용

            // timeline-content의 min-height 무력화
            const timelineContent = captureContainer.querySelector('.timeline-content');
            let originalMinHeight = '';
            if (timelineContent) {
                originalMinHeight = timelineContent.style.minHeight;
                timelineContent.style.minHeight = '0';
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

            // min-height 복구
            if (timelineContent) {
                timelineContent.style.minHeight = originalMinHeight;
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
            alert('이미지 캡처 중 오류가 발생했습니다.');
        }
    };



    // 의존성 선 렌더링
    const renderDependencies = () => {
        const lines = [];
        const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
        const rowHeight = isCompact ? 28 : 40;

        // 2. 의존성 선 그리기
        flatTasks.forEach((task) => {
            // 작업의 의존성 처리
            if (task.dependencies) {
                task.dependencies.forEach(depId => {
                    const source = itemMap.get(depId);
                    const target = itemMap.get(task.id);

                    if (source && target) {
                        lines.push(drawDependencyLine(source, target, totalDays, contentWidth, rowHeight));
                    }
                });
            }

            // 마일스톤의 의존성 처리 (데이터 모델에 milestones 내 dependencies가 있다고 가정하거나, 
            // 현재 구조상 마일스톤 객체에 dependencies 필드가 없으면 추가해야 함.
            // 일단 기존 데이터 구조를 유지하면서, 마일스톤 객체에 dependencies가 추가될 수 있다고 가정)
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
        if (source.type === 'task') {
            // 작업인 경우: 종료일 기준
            const sourceDays = dateUtils.getDuration(dateRange.start, source.endDate);
            startX = (sourceDays / totalDays) * contentWidth;
            startY = source.index * rowHeight + rowHeight / 2;
        } else {
            // 마일스톤인 경우: 해당 날짜 기준
            const sourceDays = dateUtils.getDuration(dateRange.start, source.date);
            startX = (sourceDays / totalDays) * contentWidth;
            startY = source.parentIndex * rowHeight + rowHeight / 2;
        }

        // 끝점 계산 (Target)
        if (target.type === 'task') {
            // 작업인 경우: 시작일 기준
            const targetDays = dateUtils.getDaysBetween(dateRange.start, target.startDate);
            endX = (targetDays / totalDays) * contentWidth;
            endY = target.index * rowHeight + rowHeight / 2;
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

    // 팝오버를 위한 현재 작업 찾기
    const popoverTask = popoverInfo ? flatTasks.find(t => t.id === popoverInfo.taskId) : null;

    // 후행 작업(Successors) 찾기 (작업용)
    const successors = popoverTask ? flatTasks.filter(t => t.dependencies && t.dependencies.includes(popoverTask.id)) : [];

    // 선행 작업(Predecessors) 찾기 (작업용)
    const predecessors = popoverTask ? flatTasks.filter(t => popoverTask.dependencies && popoverTask.dependencies.includes(t.id)) : [];

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

    return (
        <div className={`timeline-view ${viewMode === 'split' ? 'split-mode' : ''} ${isCompact ? 'compact-mode' : ''}`} ref={containerRef}>
            <div className={`timeline-container ${showTaskNames ? 'with-names' : ''}`} ref={captureRef}>
                {/* ... (Existing JSX) ... */}
                {/* 왼쪽 작업명 컬럼 */}
                {showTaskNames && (
                    <div className="task-names-column">
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
                )}

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

                                const targetTask = flatTasks.find(t => t.id === selectedTaskId) || flatTasks[0];

                                if (targetTask) {
                                    setMilestoneModalInfo({ task: targetTask, date: clickedDate });
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
                                    onSelect={() => handleTaskClick(task.id)}
                                    onDragUpdate={handleDragUpdate}
                                    onDragEnd={handleTimelineBarDragEnd}
                                    onMilestoneDragEnd={handleMilestoneDragEnd}
                                    onMilestoneDragMove={handleMilestoneDragMove}
                                    onGuideMove={handleGuideMove}
                                    onContextMenu={(e, date) => handleContextMenu(e, task, date)}
                                    onMilestoneContextMenu={(e, milestone) => handleMilestoneContextMenu(e, task, milestone)}
                                    onMilestoneClick={handleMilestoneClick}
                                    showLabel={!showTaskNames}
                                    timeScale={timeScale}
                                    snapEnabled={snapEnabled}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 컨텍스트 메뉴 팝오버 */}
            {popoverInfo && popoverTask && (
                <TimelineBarPopover
                    position={{ x: popoverInfo.x, y: popoverInfo.y }}
                    task={popoverTask}
                    successors={successors}
                    predecessors={predecessors}
                    onClose={() => setPopoverInfo(null)}
                    onUpdate={(taskId, updates) => {
                        onUpdateTask(taskId, updates);
                    }}
                    onDelete={(taskId) => {
                        onUpdateTask(taskId, { deleted: true });
                    }}
                    onAddMilestone={() => {
                        setMilestoneModalInfo({
                            task: popoverTask,
                            date: popoverInfo.date
                        });
                        setPopoverInfo(null);
                    }}
                    onStartLinking={() => startLinking(popoverTask.id)}
                />
            )}

            {/* 마일스톤 편집 팝오버 */}
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

            {/* 마일스톤 추가 모달 */}
            {milestoneModalInfo && (
                <MilestoneQuickAdd
                    task={milestoneModalInfo.task}
                    date={milestoneModalInfo.date}
                    onClose={() => setMilestoneModalInfo(null)}
                    onAdd={handleAddMilestone}
                />
            )}
        </div>
    );
});

export default TimelineView;
