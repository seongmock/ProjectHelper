import { useMemo, useRef, useEffect, useState } from 'react';
import { dateUtils } from '../utils/dateUtils';
import TimelineHeader from './TimelineHeader';
import TimelineBar from './TimelineBar';
import TimelineBarPopover from './TimelineBarPopover';
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
    const [popoverInfo, setPopoverInfo] = useState(null); // { x, y, task }

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

    // 우클릭 핸들러
    const handleContextMenu = (e, task) => {
        e.preventDefault();
        setPopoverInfo({
            x: e.clientX,
            y: e.clientY,
            task
        });
    };

    const handleDeleteTask = (taskId) => {
        // 실제 삭제 로직은 상위 컴포넌트(App)에서 처리하도록 onUpdateTask 대신 별도 prop이 필요할 수 있음
        // 현재 구조상 onUpdateTask를 통해 삭제를 알리거나, tasks 배열을 직접 수정해야 함
        // 여기서는 간단히 console.log만 하고, 실제로는 App.jsx에 onDeleteTask prop을 추가하는 것이 좋음
        // 임시로 onUpdateTask에 null을 보내 삭제 신호로 사용하거나, 별도 prop 추가 필요
        // 일단은 알림만 띄움 (구현 필요)
        console.log('Delete task:', taskId);
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
                                    isSelected={task.id === selectedTaskId}
                                    onSelect={onSelectTask}
                                    onDragUpdate={handleDragUpdate}
                                    onContextMenu={(e) => handleContextMenu(e, task)}
                                    showLabel={!showTaskNames}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 컨텍스트 메뉴 팝오버 */}
            {popoverInfo && (
                <TimelineBarPopover
                    position={{ x: popoverInfo.x, y: popoverInfo.y }}
                    task={popoverInfo.task}
                    onClose={() => setPopoverInfo(null)}
                    onUpdate={(taskId, updates) => {
                        onUpdateTask(taskId, updates);
                        // 색상 변경 등 즉시 반영을 위해 팝오버 닫지 않음 (선택 사항)
                    }}
                    onDelete={(taskId) => {
                        // onDeleteTask(taskId); // App.jsx에서 prop으로 받아야 함
                        // 현재는 임시로 tasks에서 필터링하는 로직이 App.jsx에 있어야 함
                        // 일단 onUpdateTask를 통해 처리하거나 별도 구현 필요
                        // 여기서는 onUpdateTask에 deleted 플래그를 보내는 방식으로 우회 가능
                        // 또는 상위에서 onDeleteTask prop을 내려줘야 함.
                        // 일단은 onUpdateTask만 호출
                        onUpdateTask(taskId, { deleted: true });
                    }}
                />
            )}
        </div>
    );
}

export default TimelineView;
