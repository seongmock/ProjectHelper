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
    timeScale = 'monthly'
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [dragType, setDragType] = useState(null); // 'move', 'resize-start', 'resize-end'
    const [dragStart, setDragStart] = useState({ x: 0, taskStart: null, taskEnd: null });

    // 드래그 중 시각적 피드백을 위한 로컬 상태
    const [draggedDates, setDraggedDates] = useState(null);

    // 마일스톤 드래그 상태
    const [draggingMilestone, setDraggingMilestone] = useState(null); // milestone.id
    const [milestoneDragStart, setMilestoneDragStart] = useState({ x: 0, originalDate: null });
    const [draggedMilestoneDate, setDraggedMilestoneDate] = useState(null);

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
        onSelect(task.id);
    };

    // 드래그 중 최종 상태 추적 (useRef 사용하여 매 렌더링마다 초기화 방지)
    const finalDragState = useRef({ start: null, end: null });

    // 드래그 중
    useEffect(() => {
        if (!isDragging) return;

        // 드래그 시작 시 초기 상태 저장
        finalDragState.current = {
            start: new Date(task.startDate),
            end: new Date(task.endDate)
        };

        const handleMouseMove = (e) => {
            // 가이드라인 업데이트
            if (onGuideMove) onGuideMove(e.clientX);

            const deltaX = e.clientX - dragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            // 적응형 스냅 로직: 전체 타임라인 범위에 따라 스냅 단위 자동 조정
            const applySnapping = (date, type) => {
                return dateUtils.snapAdaptive(date, type, totalDays);
            };

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
            } else if (dragType === 'resize-start') {
                // 시작일 변경
                const rawNewStart = dateUtils.addDays(dragStart.taskStart, deltaDays);
                const snappedStart = applySnapping(rawNewStart, 'start');

                if (snappedStart < dragStart.taskEnd) {
                    finalDragState.current = { start: snappedStart, end: dragStart.taskEnd };

                    // 로컬 상태 업데이트 (시각적 피드백)
                    setDraggedDates({
                        startDate: dateUtils.formatDate(snappedStart),
                        endDate: task.endDate
                    });
                    onDragUpdate(task.id, snappedStart, dragStart.taskEnd);
                }
            } else if (dragType === 'resize-end') {
                // 종료일 변경
                const rawNewEnd = dateUtils.addDays(dragStart.taskEnd, deltaDays);
                const snappedEnd = applySnapping(rawNewEnd, 'end');

                if (snappedEnd > dragStart.taskStart) {
                    finalDragState.current = { start: dragStart.taskStart, end: snappedEnd };

                    // 로컬 상태 업데이트 (시각적 피드백)
                    setDraggedDates({
                        startDate: task.startDate,
                        endDate: dateUtils.formatDate(snappedEnd)
                    });
                    onDragUpdate(task.id, dragStart.taskStart, snappedEnd);
                }
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
            // 가이드라인 업데이트
            if (onGuideMove) onGuideMove(e.clientX);

            const deltaX = e.clientX - milestoneDragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            const rawNewDate = dateUtils.addDays(milestoneDragStart.originalDate, deltaDays);
            const snappedDate = dateUtils.snapAdaptive(rawNewDate, 'closest', totalDays);

            // 로컬 상태 업데이트 (시각적 피드백)
            setDraggedMilestoneDate(dateUtils.formatDate(snappedDate));

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
            setDraggedMilestoneDate(null);
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
                        <div style={{
                            width: 0,
                            height: 0,
                            borderLeft: '10px solid transparent',
                            borderRight: '10px solid transparent',
                            borderBottom: `18px solid ${milestone.color}`,
                            filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
                        }} />
                    );
                    break;
                case 'square':
                    shapeElement = (
                        <div style={{ ...baseStyle, borderRadius: '2px' }} />
                    );
                    break;
                case 'star':
                    shapeElement = (
                        <div style={{
                            color: milestone.color,
                            fontSize: '20px',
                            filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
                            lineHeight: 1,
                        }}>★</div>
                    );
                    break;
                case 'flag':
                    shapeElement = (
                        <div style={{
                            color: milestone.color,
                            fontSize: '20px',
                            filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
                            lineHeight: 1,
                        }}>⚑</div>
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

    return (
        <div
            className={`timeline-row level-${level} ${isDragTarget ? 'drag-target' : ''}`}
            data-task-id={task.id}
        >
            {hasValidDates && (
                <Tooltip content={task.description} position="top">
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
                        {/* 시작 핸들 */}
                        <div
                            className="resize-handle resize-start"
                            onMouseDown={(e) => handleMouseDown(e, 'resize-start')}
                            title="시작일 조정"
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
                            title="종료일 조정"
                        />

                        {/* 드래그 시 날짜 라벨 표시 */}
                        {isDragging && draggedDates && (
                            <>
                                {dragType === 'move' && (
                                    <div className="task-drag-label center">
                                        {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')} ~ {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                                    </div>
                                )}
                                {dragType === 'resize-start' && (
                                    <div className="task-drag-label start">
                                        {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')}
                                    </div>
                                )}
                                {dragType === 'resize-end' && (
                                    <div className="task-drag-label end">
                                        {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </Tooltip>
            )}

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

            {/* 드래그 툴팁 */}
            {isDragging && (
                <div className="drag-tooltip" style={{
                    position: 'absolute',
                    top: '-30px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    zIndex: 100,
                    pointerEvents: 'none'
                }}>
                    {dragType === 'move' && `${dateUtils.formatDate(task.startDate)} ~ ${dateUtils.formatDate(task.endDate)}`}
                    {dragType === 'resize-start' && dateUtils.formatDate(task.startDate)}
                    {dragType === 'resize-end' && dateUtils.formatDate(task.endDate)}
                </div>
            )}
        </div>
    );
}

export default TimelineBar;
