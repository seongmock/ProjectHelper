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
    const timelineScrollRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [showTaskNames, setShowTaskNames] = useState(true);
    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingName, setEditingName] = useState('');

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
            {/* 작업명 토글 버튼 */}
            <div className="timeline-controls">
                <button
                    className={`toggle-names-btn ${showTaskNames ? 'active' : ''}`}
                    onClick={() => setShowTaskNames(!showTaskNames)}
                    title={showTaskNames ? '작업명 숨기기' : '작업명 표시'}
                >
                    {showTaskNames ? '📄 작업명 숨기기' : '📄 작업명 표시'}
                </button>
            </div>

            <div className={`timeline-container ${showTaskNames ? 'with-names' : ''}`}>
                {/* 왼쪽 작업명 컬럼 */}
                {showTaskNames && (
                    <div className="task-names-column">
                        <div className="task-names-header">작업명</div>
                        <div className="task-names-list">
                            {tasks.length === 0 ? (
                                <div className="empty-names">작업 없음</div>
                            ) : (
                                flatTasks.map((task) => (
                                    <div
                                        key={task.id}
                                        className={`task-name-item level-${task.level} ${task.id === selectedTaskId ? 'selected' : ''}`}
                                        onClick={() => onSelectTask(task.id)}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingTaskId(task.id);
                                            setEditingName(task.name);
                                        }}
                                        style={{ paddingLeft: `${task.level * 24 + 12}px` }}
                                    >
                                        {editingTaskId === task.id ? (
                                            <input
                                                type="text"
                                                className="task-name-edit-input"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onBlur={() => {
                                                    if (editingName.trim() !== task.name) {
                                                        onUpdateTask(task.id, { name: editingName });
                                                    }
                                                    setEditingTaskId(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        if (editingName.trim() !== task.name) {
                                                            onUpdateTask(task.id, { name: editingName });
                                                        }
                                                        setEditingTaskId(null);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingTaskId(null);
                                                    }
                                                }}
                                                autoFocus
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        ) : (
                                            task.name
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 타임라인 스크롤 컨테이너 */}
                <div className="timeline-scroll-container" ref={timelineScrollRef}>
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
                                    showLabel={!showTaskNames}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TimelineView;
