import { useState, useRef, useEffect } from 'react';
import { dateUtils } from '../utils/dateUtils';
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
    showLabel = true
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

    // 드래그 중
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - dragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            if (dragType === 'move') {
                // 바 전체 이동
                const newStart = dateUtils.addDays(dragStart.taskStart, deltaDays);
                const newEnd = dateUtils.addDays(dragStart.taskEnd, deltaDays);
                onDragUpdate(task.id, newStart, newEnd);
            } else if (dragType === 'resize-start') {
                // 시작일 변경
                const newStart = dateUtils.addDays(dragStart.taskStart, deltaDays);
                if (newStart < dragStart.taskEnd) {
                    onDragUpdate(task.id, newStart, dragStart.taskEnd);
                }
            } else if (dragType === 'resize-end') {
                // 종료일 변경
                const newEnd = dateUtils.addDays(dragStart.taskEnd, deltaDays);
                if (newEnd > dragStart.taskStart) {
                    onDragUpdate(task.id, dragStart.taskStart, newEnd);
                }
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setDragType(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragType, dragStart, containerWidth, totalDays, task.id, onDragUpdate]);

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

            return (
                <div
                    key={milestone.id}
                    className="milestone-marker"
                    style={{
                        left: `${position}px`,
                    }}
                    title={`${milestone.label} (${milestone.date})`}
                >
                    <div className="milestone-shape">
                        {shapeElement}
                    </div>
                    <span className="milestone-label">{milestone.label}</span>
                </div>
            );
        });
    };

    return (
        <div className={`timeline-row level-${level}`}>
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

            {/* 마일스톤 마커들 */}
            {renderMilestones()}
        </div>
    );
}

export default TimelineBar;
