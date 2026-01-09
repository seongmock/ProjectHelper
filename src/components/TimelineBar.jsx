import { useState, useRef, useEffect } from 'react';
import { dateUtils } from '../utils/dateUtils';
import Tooltip from './Tooltip';
import './TimelineBar.css';

function TimelineBar({
    task,
    level,
    startDate,
    endDate,
    containerWidth,
    isSelected,
    isDragTarget,
    onSelect,
    onDragUpdate,
    onDragEnd, // 드래그 완료 콜백
    onMilestoneDragEnd, // 마일스톤 드래그 완료 콜백
    onMilestoneDragMove,
    onGuideMove, // 가이드라인 이동 콜백
    onContextMenu,
    onMilestoneContextMenu,
    onMilestoneClick,
    showLabel = true,
    timeScale = 'monthly',
    snapEnabled = true // 기본값
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [dragType, setDragType] = useState(null); // 'move', 'resize-start', 'resize-end'
    const [dragStart, setDragStart] = useState({ x: 0, taskStart: null, taskEnd: null });

    // 드래그 중 시각적 피드백을 위한 로컬 상태
    const [draggedDates, setDraggedDates] = useState(null);

    // 마일스톤 드래그 상태
    const [draggingMilestone, setDraggingMilestone] = useState(null); // milestone.id
    const [milestoneDragStart, setMilestoneDragStart] = useState({ x: 0, y: 0, originalDate: null });
    const [draggedMilestoneDate, setDraggedMilestoneDate] = useState(null);
    const [draggedMilestoneY, setDraggedMilestoneY] = useState(0);

    const barRef = useRef(null);

    const totalDays = dateUtils.getDaysBetween(startDate, endDate);

    // 렌더링에 사용할 날짜 (드래그 중이면 draggedDates, 아니면 task의 날짜)
    const displayStartDate = draggedDates?.startDate || task.startDate;
    const displayEndDate = draggedDates?.endDate || task.endDate;

    // 타임라인 바의 위치 및 너비 계산
    const { width, offset } = dateUtils.calculateWidth(
        displayStartDate,
        displayEndDate,
        startDate,
        endDate,
        containerWidth
    );

    // 드래그 시작
    const handleMouseDown = (e, type) => {
        e.stopPropagation();
        setIsDragging(true);
        setDragType(type);
        setDragStart({
            x: e.clientX,
            taskStart: new Date(task.startDate),
            taskEnd: new Date(task.endDate),
        });

        // 드래그 시작 시 초기 상태 저장 (여기서 한 번만 수행)
        finalDragState.current = {
            start: new Date(task.startDate),
            end: new Date(task.endDate)
        };

        onSelect(task.id);
    };

    // 드래그 중 최종 상태 추적 (useRef 사용하여 매 렌더링마다 초기화 방지)
    const finalDragState = useRef({ start: null, end: null });

    // 드래그 중
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - dragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            // 적응형 스냅 로직: 전체 타임라인 범위에 따라 스냅 단위 자동 조정
            const applySnapping = (date, type) => {
                if (snapEnabled) {
                    return dateUtils.snapAdaptive(date, type, totalDays);
                }
                return dateUtils.snapToDay(date, type);
            };

            let guideDate = null;

            if (dragType === 'move') {
                // 바 전체 이동
                const rawNewStart = dateUtils.addDays(dragStart.taskStart, deltaDays);

                // 시작일을 스냅
                const snappedStart = applySnapping(rawNewStart, 'start');

                // 기간 유지하며 종료일 계산
                const duration = dateUtils.getDaysBetween(dragStart.taskStart, dragStart.taskEnd);
                const snappedEnd = dateUtils.addDays(snappedStart, duration);

                finalDragState.current = { start: snappedStart, end: snappedEnd };

                // 로컬 상태 업데이트 (시각적 피드백)
                setDraggedDates({
                    startDate: dateUtils.formatDate(snappedStart),
                    endDate: dateUtils.formatDate(snappedEnd)
                });
                onDragUpdate(task.id, snappedStart, snappedEnd);

                // 가이드라인은 시작점에 맞춤
                guideDate = snappedStart;
            } else if (dragType === 'resize-start') {
                // 시작일 변경
                const rawNewStart = dateUtils.addDays(dragStart.taskStart, deltaDays);
                const snappedStart = applySnapping(rawNewStart, 'start');

                if (snappedStart < dragStart.taskEnd) {
                    finalDragState.current = { start: snappedStart, end: dragStart.taskEnd };

                    // 로컬 상태 업데이트 (시각적 피드백)
                    setDraggedDates({
                        startDate: dateUtils.formatDate(snappedStart),
                        endDate: dateUtils.formatDate(dragStart.taskEnd)
                    });
                    onDragUpdate(task.id, snappedStart, dragStart.taskEnd);

                    // 가이드라인은 시작점에 맞춤
                    guideDate = snappedStart;
                }
            } else if (dragType === 'resize-end') {
                // 종료일 변경
                const rawNewEnd = dateUtils.addDays(dragStart.taskEnd, deltaDays);
                const snappedEnd = applySnapping(rawNewEnd, 'end');

                if (snappedEnd > dragStart.taskStart) {
                    finalDragState.current = { start: dragStart.taskStart, end: snappedEnd };

                    // 로컬 상태 업데이트 (시각적 피드백)
                    setDraggedDates({
                        startDate: dateUtils.formatDate(dragStart.taskStart),
                        endDate: dateUtils.formatDate(snappedEnd)
                    });
                    onDragUpdate(task.id, dragStart.taskStart, snappedEnd);

                    // 가이드라인은 종료점에 맞춤
                    guideDate = snappedEnd;
                }
            }

            // 가이드라인 업데이트 (스냅된 날짜 기준)
            if (onGuideMove && guideDate) {
                const guideDays = dateUtils.getDaysBetween(startDate, guideDate);
                const guideOffset = (guideDays / totalDays) * containerWidth;
                onGuideMove(guideOffset);
            }
        };

        const handleMouseUp = () => {
            // 가이드라인 제거
            if (onGuideMove) onGuideMove(null);

            // 드래그 완료 시 최종 상태를 히스토리에 기록
            if (onDragEnd && finalDragState.current.start && finalDragState.current.end) {
                onDragEnd(task.id, finalDragState.current.start, finalDragState.current.end);
            }

            // 로컬 드래그 상태 클리어
            setDraggedDates(null);
            setIsDragging(false);
            setDragType(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragType, dragStart, containerWidth, totalDays, task.id, task.startDate, task.endDate, onDragUpdate, onDragEnd, onGuideMove]);

    // 마일스톤 드래그 처리
    useEffect(() => {
        if (!draggingMilestone) return;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - milestoneDragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            const rawNewDate = dateUtils.addDays(milestoneDragStart.originalDate, deltaDays);
            // 스냅 적용
            // 스냅 적용
            let snappedDate;
            if (snapEnabled) {
                // 기존 적응형 스냅
                snappedDate = dateUtils.snapAdaptive(rawNewDate, 'closest', totalDays);
            } else {
                // 스냅 끔: 일 단위로만 반올림 (부드러운 드래그)
                snappedDate = dateUtils.snapToDay(rawNewDate, 'closest');
            }

            // Y축 이동 계산
            const deltaY = e.clientY - milestoneDragStart.y;

            // 로컬 상태 업데이트 (시각적 피드백)
            setDraggedMilestoneDate(dateUtils.formatDate(snappedDate));
            setDraggedMilestoneY(deltaY);

            // 가이드라인 업데이트 (스냅된 날짜 기준)
            if (onGuideMove) {
                const guideDays = dateUtils.getDaysBetween(startDate, snappedDate);
                const guideOffset = (guideDays / totalDays) * containerWidth;
                onGuideMove(guideOffset);
            }

            // Y 위치를 부모로 전달 (세로 이동 감지용)
            if (onMilestoneDragMove) {
                onMilestoneDragMove(e.clientY);
            }
        };

        const handleMouseUp = () => {
            // 가이드라인 제거
            if (onGuideMove) onGuideMove(null);

            // 드래그 완료 시 최종 날짜를 히스토리에 기록
            if (onMilestoneDragEnd && draggedMilestoneDate) {
                onMilestoneDragEnd(task.id, draggingMilestone, draggedMilestoneDate);
            }

            // 로컬 드래그 상태 클리어
            setDraggingMilestone(null);
            setDraggingMilestone(null);
            setDraggedMilestoneDate(null);
            setDraggedMilestoneY(0);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingMilestone, milestoneDragStart, containerWidth, totalDays, task.id, onMilestoneDragEnd, onMilestoneDragMove, draggedMilestoneDate, onGuideMove]);

    // 마일스톤 렌더링
    const renderMilestones = () => {
        if (!task.milestones || task.milestones.length === 0) return null;

        return task.milestones.map((milestone) => {
            // 드래그 중이면 draggedMilestoneDate 사용, 아니면 milestone.date
            const currentDate = (draggingMilestone === milestone.id && draggedMilestoneDate)
                ? draggedMilestoneDate
                : milestone.date;

            const milestoneDate = new Date(currentDate);
            if (milestoneDate < new Date(startDate) || milestoneDate > new Date(endDate)) {
                return null;
            }

            const daysFromStart = dateUtils.getDaysBetween(startDate, currentDate);
            const position = (daysFromStart / totalDays) * containerWidth;

            const shape = milestone.shape || 'diamond';

            // 모양별 스타일
            let shapeElement;
            const baseStyle = {
                width: '16px',
                height: '16px',
                backgroundColor: milestone.color,
                border: '2px solid white',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            };

            switch (shape) {
                case 'circle':
                    shapeElement = (
                        <div style={{ ...baseStyle, borderRadius: '50%' }} />
                    );
                    break;
                case 'triangle':
                    shapeElement = (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M12 2L22 22H2L12 2Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                    );
                    break;
                case 'square':
                    shapeElement = (
                        <div style={{ ...baseStyle, borderRadius: '2px' }} />
                    );
                    break;
                case 'star':
                    shapeElement = (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                    );
                    break;
                case 'flag':
                    shapeElement = (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M14.4 6L14 4H5V21H7V14H12L12.4 16H22V6H14.4Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                    );
                    break;
                case 'diamond':
                default:
                    shapeElement = (
                        <div style={{
                            ...baseStyle,
                            transform: 'rotate(45deg)',
                        }} />
                    );
                    break;
            }

            // 레이블 위치 스타일
            let labelStyle = {};
            const labelPos = milestone.labelPosition || 'bottom';

            switch (labelPos) {
                case 'top':
                    labelStyle = { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '4px' };
                    break;
                case 'left':
                    labelStyle = { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '8px' };
                    break;
                case 'right':
                    labelStyle = { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '8px' };
                    break;
                case 'bottom':
                default:
                    labelStyle = { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '4px' };
                    break;
            }

            return (
                <div
                    key={milestone.id}
                    className={`milestone-marker ${draggingMilestone === milestone.id ? 'dragging' : ''}`}
                    style={{
                        left: `${position}px`,
                        ...(draggingMilestone === milestone.id ? {
                            transform: `translate(-50%, -50%) translateY(${draggedMilestoneY}px)`,
                            zIndex: 1000
                        } : {})
                    }}
                    title={`${milestone.label} (${currentDate})`}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onMilestoneContextMenu(e, milestone);
                    }}
                    onClick={(e) => {
                        if (onMilestoneClick) {
                            onMilestoneClick(e, milestone);
                        }
                    }}
                >
                    <div
                        className="milestone-shape"
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingMilestone(milestone.id);
                            setMilestoneDragStart({
                                x: e.clientX,
                                y: e.clientY,
                                originalDate: new Date(milestone.date)
                            });
                            setDraggedMilestoneDate(milestone.date);
                        }}
                    >
                        {shapeElement}

                        {/* 드래그 중 날짜 표시 라벨 */}
                        {draggingMilestone === milestone.id && draggedMilestoneDate && (
                            <div className="milestone-date-label">
                                {dateUtils.formatDate(new Date(draggedMilestoneDate), 'MM.DD')}
                            </div>
                        )}
                    </div>
                    <span className="milestone-label" style={labelStyle}>{milestone.label}</span>
                </div>
            );
        });
    };

    // 날짜 유효성 확인
    const hasValidDates = startDate && endDate && task.startDate && task.endDate;

    const barContent = (
        <div
            ref={barRef}
            className={`timeline-bar ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={{
                left: `${offset}px`,
                width: `${width}px`,
                backgroundColor: task.color,
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect(task.id);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();

                // 클릭 위치에 따른 날짜 계산
                const rect = barRef.current.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const width = rect.width;
                const totalDays = dateUtils.getDaysBetween(task.startDate, task.endDate);
                const daysToAdd = Math.round((offsetX / width) * totalDays);
                const clickDate = dateUtils.addDays(task.startDate, daysToAdd);

                onContextMenu(e, clickDate);
            }}
        >
            {/* 드래그 중 날짜 라벨 */}
            {isDragging && draggedDates && (
                <>
                    {/* 이동 시: 중앙 표시 */}
                    {dragType === 'move' && (
                        <div className="timeline-date-label label-center">
                            {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')} ~ {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                        </div>
                    )}
                    {/* 시작 사이즈 조절: 왼쪽 표시 */}
                    {dragType === 'resize-start' && (
                        <div className="timeline-date-label label-left">
                            {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')}
                        </div>
                    )}
                    {/* 종료 사이즈 조절: 오른쪽 표시 */}
                    {dragType === 'resize-end' && (
                        <div className="timeline-date-label label-right">
                            {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                        </div>
                    )}
                </>
            )}

            {/* 시작 핸들 */}
            <div
                className="resize-handle resize-start"
                onMouseDown={(e) => handleMouseDown(e, 'resize-start')}
                onMouseEnter={(e) => e.stopPropagation()}
            />

            {/* 바 내용 */}
            <div
                className="bar-content"
                onMouseDown={(e) => handleMouseDown(e, 'move')}
            >
                {showLabel && (
                    <span className="bar-label">
                        {task.name}
                    </span>
                )}
            </div>

            {/* 종료 핸들 */}
            <div
                className="resize-handle resize-end"
                onMouseDown={(e) => handleMouseDown(e, 'resize-end')}
                onMouseEnter={(e) => e.stopPropagation()}
            />
        </div>
    );

    return (
        <div
            className={`timeline-row level-${level} ${isDragTarget ? 'drag-target' : ''}`}
            data-task-id={task.id}
        >
            {hasValidDates ? (
                // 드래그 중이 아닐 때만 툴팁 표시 (잔영 제거)
                !isDragging ? (
                    <Tooltip content={task.description} position="top">
                        {barContent}
                    </Tooltip>
                ) : (
                    barContent
                )
            ) : null}
            {/* 마일스톤 마커들 */}
            {renderMilestones()}

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

export default TimelineBar;
