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
    onSelect,
    onDragUpdate,
    onContextMenu,
    onMilestoneContextMenu,
    onMilestoneClick,
    showLabel = true,
    timeScale = 'monthly'
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [dragType, setDragType] = useState(null); // 'move', 'resize-start', 'resize-end'
    const [dragStart, setDragStart] = useState({ x: 0, taskStart: null, taskEnd: null });
    const barRef = useRef(null);

    const totalDays = dateUtils.getDaysBetween(startDate, endDate);

    // 타임라인 바의 위치 및 너비 계산
    const { width, offset } = dateUtils.calculateWidth(
        task.startDate,
        task.endDate,
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

    // 드래그 완료 시 최종 상태 저장 (히스토리 기록)
    const finalizeDrag = (finalStart, finalEnd) => {
        if (task.onDragEnd) {
            task.onDragEnd(task.id, finalStart, finalEnd);
        }
    };

    // 드래그 중
    useEffect(() => {
        if (!isDragging) return;

        let finalStart = task.startDate;
        let finalEnd = task.endDate;

        const handleMouseMove = (e) => {
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

                finalStart = snappedStart;
                finalEnd = snappedEnd;
                onDragUpdate(task.id, snappedStart, snappedEnd);
            } else if (dragType === 'resize-start') {
                // 시작일 변경
                const rawNewStart = dateUtils.addDays(dragStart.taskStart, deltaDays);
                const snappedStart = applySnapping(rawNewStart, 'start');

                if (snappedStart < dragStart.taskEnd) {
                    finalStart = snappedStart;
                    finalEnd = dragStart.taskEnd;
                    onDragUpdate(task.id, snappedStart, dragStart.taskEnd);
                }
            } else if (dragType === 'resize-end') {
                // 종료일 변경
                const rawNewEnd = dateUtils.addDays(dragStart.taskEnd, deltaDays);
                const snappedEnd = applySnapping(rawNewEnd, 'end');

                if (snappedEnd > dragStart.taskStart) {
                    finalStart = dragStart.taskStart;
                    finalEnd = snappedEnd;
                    onDragUpdate(task.id, dragStart.taskStart, snappedEnd);
                }
            }
        };

        const handleMouseUp = () => {
            // 드래그 완료 시 최종 상태를 히스토리에 기록
            finalizeDrag(finalStart, finalEnd);
            setIsDragging(false);
            setDragType(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragType, dragStart, containerWidth, totalDays, task.id, task.startDate, task.endDate, onDragUpdate]);

    // 마일스톤 렌더링
    const renderMilestones = () => {
        if (!task.milestones || task.milestones.length === 0) return null;

        return task.milestones.map((milestone) => {
            const milestoneDate = new Date(milestone.date);
            if (milestoneDate < new Date(startDate) || milestoneDate > new Date(endDate)) {
                return null;
            }

            const daysFromStart = dateUtils.getDaysBetween(startDate, milestone.date);
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
                    className="milestone-marker"
                    style={{
                        left: `${position}px`,
                    }}
                    title={`${milestone.label} (${milestone.date})`}
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
                    <div className="milestone-shape">
                        {shapeElement}
                    </div>
                    <span className="milestone-label" style={labelStyle}>{milestone.label}</span>
                </div>
            );
        });
    };

    // 날짜 유효성 확인
    const hasValidDates = startDate && endDate && task.startDate && task.endDate;

    return (
        <div className={`timeline-row level-${level}`}>
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
