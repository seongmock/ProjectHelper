import { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { dateUtils } from '../utils/dateUtils';
import TimelineHeader from './TimelineHeader';
import TimelineBar from './TimelineBar';
import TimelineBarPopover from './TimelineBarPopover';
import MilestoneQuickAdd from './MilestoneQuickAdd';
import MilestoneEditPopover from './MilestoneEditPopover';
import { generateId } from '../utils/dataModel';
import html2canvas from 'html2canvas';
import './TimelineView.css';

const TimelineView = forwardRef(({
    tasks,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    timeScale,
    viewMode,
    // Props from App
    zoomLevel = 1.0,
    showToday = true,
    isCompact = false,
    showTaskNames = true
}, ref) => {
    const containerRef = useRef(null);
    const timelineScrollRef = useRef(null);
    const captureRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingName, setEditingName] = useState('');
    const [popoverInfo, setPopoverInfo] = useState(null); // { x, y, taskId, date }
    const [milestoneModalInfo, setMilestoneModalInfo] = useState(null); // { task, date }
    const [milestoneEditInfo, setMilestoneEditInfo] = useState(null); // { x, y, task, milestone }

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

            const canvas = await html2canvas(captureRef.current, {
                scale: 2, // 고해상도
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff'
            });

            // 캡처 종료: 클래스 제거
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
                    alert('클립보드 복사에 실패했습니다.');
                }
            });
        } catch (err) {
            console.error('이미지 캡처 실패:', err);
            alert('이미지 캡처 중 오류가 발생했습니다.');
        }
    };

    // 줌 레벨에 따른 컨텐츠 너비
    const contentWidth = containerWidth * zoomLevel;

    // 의존성 선 렌더링
    const renderDependencies = () => {
        const lines = [];
        const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
        const rowHeight = isCompact ? 28 : 40;

        // 1. 모든 항목(작업 + 마일스톤)을 ID로 매핑하여 위치 정보 미리 계산
        const itemMap = new Map();

        flatTasks.forEach((task, index) => {
            // 작업 정보 저장
            itemMap.set(task.id, {
                type: 'task',
                data: task,
                index: index,
                startDate: task.startDate,
                endDate: task.endDate
            });

            // 마일스톤 정보 저장
            if (task.milestones) {
                task.milestones.forEach(ms => {
                    itemMap.set(ms.id, {
                        type: 'milestone',
                        data: ms,
                        parentIndex: index, // 마일스톤은 부모 작업의 행에 위치
                        date: ms.date
                    });
                });
            }
        });

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

    // 후행 작업(Successors) 찾기
    const successors = popoverTask ? flatTasks.filter(t => t.dependencies && t.dependencies.includes(popoverTask.id)) : [];

    // 선행 작업(Predecessors) 찾기
    const predecessors = popoverTask ? flatTasks.filter(t => popoverTask.dependencies && popoverTask.dependencies.includes(t.id)) : [];

    return (
        <div className={`timeline-view ${viewMode === 'split' ? 'split-mode' : ''} ${isCompact ? 'compact-mode' : ''}`} ref={containerRef}>
            <div className={`timeline-container ${showTaskNames ? 'with-names' : ''}`} ref={captureRef}>
                {/* ... (Existing JSX) ... */}
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
                                        onClick={() => handleTaskClick(task.id)}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingTaskId(task.id);
                                            setEditingName(task.name);
                                        }}
                                        onContextMenu={(e) => handleContextMenu(e, task, dateRange.start)}
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
                        containerWidth={contentWidth}
                        showToday={showToday}
                    />

                    {/* 타임라인 바들 */}
                    <div
                        className={`timeline-content ${isLinkingMode ? 'linking-mode' : ''}`}
                        style={{ width: `${contentWidth}px` }}
                    >
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
                                    onSelect={() => handleTaskClick(task.id)}
                                    onDragUpdate={handleDragUpdate}
                                    onContextMenu={(e, date) => handleContextMenu(e, task, date)}
                                    onMilestoneContextMenu={(e, milestone) => handleMilestoneContextMenu(e, task, milestone)}
                                    onMilestoneClick={handleMilestoneClick}
                                    showLabel={!showTaskNames}
                                    timeScale={timeScale}
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
                    onClose={() => setMilestoneEditInfo(null)}
                    onUpdate={handleUpdateMilestone}
                    onDelete={handleDeleteMilestone}
                    onStartLinking={() => startLinking(milestoneEditInfo.milestone.id)}
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
