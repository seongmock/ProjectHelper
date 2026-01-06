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
    onDragUpdate
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
                    {/* 진행률 표시 */}
                    <div
                        className="progress-fill"
                        style={{ width: `${task.progress}%` }}
                    />

                    {/* 작업명 레이블 */}
                    <span className="bar-label">
                        {task.name}
                    </span>
                </div>

                {/* 종료 핸들 */}
                <div
                    className="resize-handle resize-end"
                    onMouseDown={(e) => handleMouseDown(e, 'resize-end')}
                    title="종료일 조정"
                />
            </div>
        </div>
    );
}

export default TimelineBar;
