import { useMemo, useRef, useEffect, useState } from 'react';
import { dateUtils } from '../utils/dateUtils';
import TimelineHeader from './TimelineHeader';
import TimelineBar from './TimelineBar';
import './TimelineView.css';

function TimelineView({
    tasks,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    timeScale,
    viewMode
}) {
    const containerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // 컨테이너 너비 감지
    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

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
                dates.push(new Date(item.startDate));
                dates.push(new Date(item.endDate));
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
        return {
            start: dateUtils.addDays(minDate, -padding),
            end: dateUtils.addDays(maxDate, padding),
        };
    }, [tasks]);

    // 타임라인 렌더링을 위한 플랫 리스트 생성
    const flattenTasks = (items, level = 0) => {
        const result = [];
        items.forEach(item => {
            result.push({ ...item, level });
            if (item.children && item.children.length > 0 && item.expanded) {
                result.push(...flattenTasks(item.children, level + 1));
            }
        });
        return result;
    };

    const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);

    // 드래그로 날짜 변경
    const handleDragUpdate = (taskId, newStartDate, newEndDate) => {
        onUpdateTask(taskId, {
            startDate: dateUtils.formatDate(newStartDate),
            endDate: dateUtils.formatDate(newEndDate),
        });
    };

    return (
        <div className={`timeline-view ${viewMode === 'split' ? 'split-mode' : ''}`} ref={containerRef}>
            <div className="timeline-scroll-container">
                {/* 타임라인 헤더 */}
                <TimelineHeader
                    startDate={dateRange.start}
                    endDate={dateRange.end}
                    timeScale={timeScale}
                    containerWidth={containerWidth}
                />

                {/* 타임라인 바들 */}
                <div className="timeline-content">
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
                                containerWidth={containerWidth}
                                isSelected={task.id === selectedTaskId}
                                onSelect={onSelectTask}
                                onDragUpdate={handleDragUpdate}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default TimelineView;
