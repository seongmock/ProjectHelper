import { useState, useRef, useEffect } from 'react';
import { dateUtils } from '../utils/dateUtils';
import Tooltip from './Tooltip';
import './TimelineBar.css';

function TimelineBar({
    task,
    level,
    startDate, // View start date
    endDate,   // View end date
    containerWidth,
    isSelected,
    isDragTarget,
    onSelect,
    onDragUpdate,
    onDragEnd, // Callback with rangeId
    onMilestoneDragEnd,
    onMilestoneDragMove,
    onGuideMove,
    onContextMenu,
    onMilestoneContextMenu,
    onMilestoneClick,
    showLabel = true,
    showBarLabels = true, // Toolbar toggle
    showBarDates = true, // Toolbar toggle
    showPeriodLabels = false,
    timeScale = 'monthly',
    snapEnabled = true
}) {
    const [activeRangeId, setActiveRangeId] = useState(null); // ID of range being dragged
    const [dragType, setDragType] = useState(null); // 'move', 'resize-start', 'resize-end'
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, rangeStart: null, rangeEnd: null });
    const [draggedRangeY, setDraggedRangeY] = useState(0);

    // Local state for visual feedback during drag
    const [draggedDates, setDraggedDates] = useState(null);

    // Milestone drag state
    const [draggingMilestone, setDraggingMilestone] = useState(null);
    const [milestoneDragStart, setMilestoneDragStart] = useState({ x: 0, y: 0, originalDate: null });
    const [draggedMilestoneDate, setDraggedMilestoneDate] = useState(null);
    const [draggedMilestoneY, setDraggedMilestoneY] = useState(0);

    // Copy Mode State
    const [isCopyMode, setIsCopyMode] = useState(false);

    const barRefs = useRef({}); // Refs for each range bar
    const totalDays = dateUtils.getDaysBetween(startDate, endDate);

    // Helper to get time ranges (fallback to legacy)
    const timeRanges = (task.timeRanges && task.timeRanges.length > 0)
        ? task.timeRanges
        : [{ id: 'legacy', startDate: task.startDate, endDate: task.endDate }];

    // Handle Drag Start for a specific range
    const handleMouseDown = (e, type, range) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setActiveRangeId(range.id);
        setDragType(type);
        setDragStart({
            x: e.clientX,
            y: e.clientY,
            rangeStart: new Date(range.startDate),
            rangeEnd: new Date(range.endDate),
        });

        finalDragState.current = {
            start: new Date(range.startDate),
            end: new Date(range.endDate)
        };

        onSelect(task.id, range.id);
    };

    const finalDragState = useRef({ start: null, end: null });

    // Drag Logic
    useEffect(() => {
        if (!activeRangeId) return;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - dragStart.x;
            const deltaY = e.clientY - dragStart.y;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            setIsCopyMode(e.ctrlKey);

            setDraggedRangeY(deltaY);

            const applySnapping = (date, type) => {
                if (snapEnabled) {
                    return dateUtils.snapAdaptive(date, type, totalDays);
                }
                return dateUtils.snapToDay(date, type);
            };

            let guideDate = null;

            if (dragType === 'move') {
                const rawNewStart = dateUtils.addDays(dragStart.rangeStart, deltaDays);
                const snappedStart = applySnapping(rawNewStart, 'start');
                const duration = dateUtils.getDaysBetween(dragStart.rangeStart, dragStart.rangeEnd);
                const snappedEnd = dateUtils.addDays(snappedStart, duration);

                finalDragState.current = { start: snappedStart, end: snappedEnd };

                setDraggedDates({
                    startDate: dateUtils.formatDate(snappedStart),
                    endDate: dateUtils.formatDate(snappedEnd)
                });
                // Update specific range locally
                onDragUpdate(task.id, snappedStart, snappedEnd, activeRangeId, e.clientY);
                guideDate = snappedStart;

            } else if (dragType === 'resize-start') {
                const rawNewStart = dateUtils.addDays(dragStart.rangeStart, deltaDays);
                const snappedStart = applySnapping(rawNewStart, 'start');

                if (snappedStart < dragStart.rangeEnd) {
                    finalDragState.current = { start: snappedStart, end: dragStart.rangeEnd };
                    setDraggedDates({
                        startDate: dateUtils.formatDate(snappedStart),
                        endDate: dateUtils.formatDate(dragStart.rangeEnd)
                    });
                    onDragUpdate(task.id, snappedStart, dragStart.rangeEnd, activeRangeId, e.clientY);
                    guideDate = snappedStart;
                }
            } else if (dragType === 'resize-end') {
                const rawNewEnd = dateUtils.addDays(dragStart.rangeEnd, deltaDays);
                const snappedEnd = applySnapping(rawNewEnd, 'end');

                if (snappedEnd > dragStart.rangeStart) {
                    finalDragState.current = { start: dragStart.rangeStart, end: snappedEnd };
                    setDraggedDates({
                        startDate: dateUtils.formatDate(dragStart.rangeStart),
                        endDate: dateUtils.formatDate(snappedEnd)
                    });
                    onDragUpdate(task.id, dragStart.rangeStart, snappedEnd, activeRangeId, e.clientY);
                    guideDate = snappedEnd;
                }
            }

            if (onGuideMove && guideDate) {
                const guideDays = dateUtils.getDaysBetween(startDate, guideDate);
                const guideOffset = (guideDays / totalDays) * containerWidth;
                onGuideMove(guideOffset);
            }
        };

        const handleMouseUp = (e) => {
            if (onGuideMove) onGuideMove(null);

            if (onDragEnd && finalDragState.current.start && finalDragState.current.end) {
                onDragEnd(task.id, finalDragState.current.start, finalDragState.current.end, activeRangeId, e.clientY, e.ctrlKey);
            }

            setDraggedDates(null);
            setDraggedRangeY(0);
            setActiveRangeId(null);
            setDragType(null);
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();

                // Cancel Drag
                finalDragState.current = { start: null, end: null }; // Invalidate final state
                if (onGuideMove) onGuideMove(null);

                // Notify parent to clear highlight (pass null rangeId to ensure safe exit)
                if (onDragEnd) {
                    onDragEnd(task.id, null, null, null, null, false);
                }

                setDraggedDates(null);
                setDraggedRangeY(0);
                setActiveRangeId(null);
                setDragType(null);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeRangeId, dragType, dragStart, containerWidth, totalDays, task.id, onDragUpdate, onDragEnd, onGuideMove, snapEnabled, startDate]);


    // Milestone Drag Logic (Same as before)
    useEffect(() => {
        if (!draggingMilestone) return;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - milestoneDragStart.x;
            const deltaDays = Math.round((deltaX / containerWidth) * totalDays);

            setIsCopyMode(e.ctrlKey); // Update copy mode support

            const rawNewDate = dateUtils.addDays(milestoneDragStart.originalDate, deltaDays);

            let snappedDate;
            if (snapEnabled) {
                snappedDate = dateUtils.snapAdaptive(rawNewDate, 'closest', totalDays);
            } else {
                snappedDate = dateUtils.snapToDay(rawNewDate, 'closest');
            }

            const deltaY = e.clientY - milestoneDragStart.y;

            setDraggedMilestoneDate(dateUtils.formatDate(snappedDate));
            setDraggedMilestoneY(deltaY);

            if (onGuideMove) {
                const guideDays = dateUtils.getDaysBetween(startDate, snappedDate);
                const guideOffset = (guideDays / totalDays) * containerWidth;
                onGuideMove(guideOffset);
            }

            if (onMilestoneDragMove) {
                onMilestoneDragMove(e.clientY);
            }
        };

        const handleMouseUp = (e) => {
            if (onGuideMove) onGuideMove(null);

            if (onMilestoneDragEnd && draggedMilestoneDate) {
                onMilestoneDragEnd(task.id, draggingMilestone, draggedMilestoneDate, e.ctrlKey);
            }

            setDraggingMilestone(null);
            setDraggedMilestoneDate(null);
            setDraggedMilestoneY(0);
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();

                if (onGuideMove) onGuideMove(null);

                // Notify parent to clear highlight
                if (onMilestoneDragEnd) {
                    onMilestoneDragEnd(task.id, null, null, false);
                }

                setDraggingMilestone(null);
                setDraggedMilestoneDate(null);
                setDraggedMilestoneY(0);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [draggingMilestone, milestoneDragStart, containerWidth, totalDays, task.id, onMilestoneDragEnd, onMilestoneDragMove, draggedMilestoneDate, onGuideMove, snapEnabled, startDate]);


    // Render Milestones (Same as before)
    const renderMilestones = () => {
        if (!task.milestones || task.milestones.length === 0) return null;

        const preparedMilestones = task.milestones
            .filter(m => {
                const d = new Date(m.date);
                return d >= new Date(startDate) && d <= new Date(endDate);
            })
            .map(m => {
                const daysFromStart = dateUtils.getDaysBetween(startDate, m.date);
                const x = (daysFromStart / totalDays) * containerWidth;
                const width = (m.label.length * 14) + 10;
                return { ...m, x, width };
            })
            .sort((a, b) => a.x - b.x);

        const occupied = [];
        const preparedMap = preparedMilestones.map(m => {
            // Reserve Manual Positions
            if (m.labelPosition && m.labelPosition !== 'auto') {
                let start, end;
                if (m.labelPosition === 'right') {
                    start = m.x + 10;
                    end = m.x + 10 + m.width;
                } else if (m.labelPosition === 'left') {
                    start = m.x - 10 - m.width;
                    end = m.x - 10;
                } else {
                    start = m.x - (m.width / 2);
                    end = m.x + (m.width / 2);
                }
                occupied.push({ start, end, type: m.labelPosition, id: m.id });
                return { ...m, finalLabelPos: m.labelPosition };
            }
            return m;
        });

        const checkCollision = (start, end, type) => {
            return occupied.some(item => {
                if (item.type !== type) return false;
                return (start < item.end && end > item.start);
            });
        };

        const resolvedPositions = {};

        preparedMap.forEach(m => {
            if (m.finalLabelPos) {
                resolvedPositions[m.id] = m.finalLabelPos;
                return;
            }

            const topStart = m.x - (m.width / 2);
            const topEnd = m.x + (m.width / 2);
            if (!checkCollision(topStart, topEnd, 'top')) {
                resolvedPositions[m.id] = 'top';
                occupied.push({ start: topStart, end: topEnd, type: 'top', id: m.id });
                return;
            }

            const bottomStart = m.x - (m.width / 2);
            const bottomEnd = m.x + (m.width / 2);
            if (!checkCollision(bottomStart, bottomEnd, 'bottom')) {
                resolvedPositions[m.id] = 'bottom';
                occupied.push({ start: bottomStart, end: bottomEnd, type: 'bottom', id: m.id });
                return;
            }

            const rightStart = m.x + 10;
            const rightEnd = m.x + 10 + m.width;
            if (!checkCollision(rightStart, rightEnd, 'right')) {
                resolvedPositions[m.id] = 'right';
                occupied.push({ start: rightStart, end: rightEnd, type: 'right', id: m.id });
                return;
            }

            resolvedPositions[m.id] = 'top';
            occupied.push({ start: topStart, end: topEnd, type: 'top', id: m.id });
        });

        return task.milestones.map((milestone) => {
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
            const finalLabelPos = resolvedPositions[milestone.id] || 'top';

            let shapeElement;
            const baseStyle = {
                width: '16px',
                height: '16px',
                backgroundColor: milestone.color,
                border: '2px solid white',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            };

            // Simplified shape rendering for brevity, can expand later if needed
            // For now trusting component has it. I will copy the svg paths from previous read if possible or keep simple
            const getShape = () => {
                switch (shape) {
                    case 'circle': return <div style={{ ...baseStyle, borderRadius: '50%' }} />;
                    case 'square': return <div style={{ ...baseStyle, borderRadius: '2px' }} />;
                    case 'diamond': return <div style={{ ...baseStyle, transform: 'rotate(45deg)' }} />;
                    case 'triangle': return (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M12 2L22 22H2L12 2Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>);
                    case 'star': return (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>);
                    case 'flag': return (
                        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                            <path d="M14.4 6L14 4H5V21H7V14H12L12.4 16H22V6H14.4Z" fill={milestone.color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                        </svg>);
                    default: return <div style={{ ...baseStyle, transform: 'rotate(45deg)' }} />;
                }
            };

            let labelStyle = {};
            switch (finalLabelPos) {
                case 'top': labelStyle = { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '4px' }; break;
                case 'left': labelStyle = { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '8px' }; break;
                case 'right': labelStyle = { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '8px' }; break;
                case 'bottom': default: labelStyle = { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '4px' }; break;
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
                        e.preventDefault(); e.stopPropagation();
                        onMilestoneContextMenu(e, milestone);
                    }}
                    onClick={(e) => onMilestoneClick && onMilestoneClick(e, milestone)}
                >
                    <div
                        className="milestone-shape"
                        onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setDraggingMilestone(milestone.id);
                            setMilestoneDragStart({ x: e.clientX, y: e.clientY, originalDate: new Date(milestone.date) });
                            setDraggedMilestoneDate(milestone.date);
                        }}
                    >
                        {getShape()}
                        {draggingMilestone === milestone.id && isCopyMode && (
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                right: '100%',
                                marginRight: '12px',
                                transform: 'translateY(-50%)',
                                background: '#4CAF50',
                                color: 'white',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap',
                                zIndex: 102,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                pointerEvents: 'none',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                            }}>
                                <span>+</span> Copy
                            </div>
                        )}
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

    return (
        <div
            className={`timeline-row level-${level} ${isDragTarget ? 'drag-target' : ''}`}
            data-task-id={task.id}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const totalDays = dateUtils.getDaysBetween(startDate, endDate);
                const daysToAdd = Math.round((offsetX / containerWidth) * totalDays);
                const clickDate = dateUtils.addDays(startDate, daysToAdd);
                onContextMenu(e, clickDate);
            }}
        >
            {timeRanges.map(range => {
                const isActive = activeRangeId === range.id;

                // Use dragged date if active, else range date
                const displayStart = (isActive && draggedDates) ? draggedDates.startDate : range.startDate;
                const displayEnd = (isActive && draggedDates) ? draggedDates.endDate : range.endDate;

                if (!displayStart || !displayEnd) return null;

                const { width, offset } = dateUtils.calculateWidth(
                    displayStart,
                    displayEnd,
                    startDate,
                    endDate,
                    containerWidth
                );

                return (
                    <div
                        key={range.id}
                        ref={(el) => (barRefs.current[range.id] = el)}
                        className={`timeline-bar ${isSelected ? 'selected' : ''} ${isActive ? 'dragging' : ''}`}
                        style={{
                            left: `${offset}px`,
                            width: `${width}px`,
                            backgroundColor: range.color || task.color,
                            transform: isActive ? `translateY(calc(-50% + ${draggedRangeY}px))` : undefined,
                            zIndex: isActive ? 100 : 1,
                            boxShadow: isActive ? '0 4px 8px rgba(0,0,0,0.3)' : 'none',
                            cursor: isActive ? (isCopyMode ? 'copy' : 'grabbing') : 'grab'
                        }}
                        title={`${task.name} (${dateUtils.formatDate(new Date(range.startDate), 'YYYY.MM.DD')} ~ ${dateUtils.formatDate(new Date(range.endDate), 'YYYY.MM.DD')})`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(task.id, range.id); // Pass rangeId
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const offsetX = e.clientX - rect.left;
                            const barTotalDays = dateUtils.getDaysBetween(range.startDate, range.endDate);
                            const daysToAdd = Math.round((offsetX / rect.width) * barTotalDays);
                            const clickDate = dateUtils.addDays(range.startDate, daysToAdd);
                            onContextMenu(e, clickDate, range.id); // Pass rangeId
                        }}
                    >
                        {isActive && isCopyMode && (
                            <div style={{
                                position: 'absolute',
                                top: '-24px',
                                right: '-8px',
                                background: '#4CAF50', // Green for Copy
                                color: 'white',
                                padding: '4px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                zIndex: 102,
                                boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                <span>+</span> Copy
                            </div>
                        )}
                        {/* Drag Labels */}
                        {isActive && draggedDates && (
                            <>
                                {dragType === 'move' && (
                                    <div className="timeline-date-label label-center">
                                        {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')} ~ {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                                    </div>
                                )}
                                {dragType === 'resize-start' && (
                                    <div className="timeline-date-label label-left">
                                        {dateUtils.formatDate(new Date(draggedDates.startDate), 'MM.DD')}
                                    </div>
                                )}
                                {dragType === 'resize-end' && (
                                    <div className="timeline-date-label label-right">
                                        {dateUtils.formatDate(new Date(draggedDates.endDate), 'MM.DD')}
                                    </div>
                                )}
                            </>
                        )}

                        {/* Handles */}
                        <div
                            className="resize-handle resize-start"
                            onMouseDown={(e) => handleMouseDown(e, 'resize-start', range)}
                            onMouseEnter={(e) => e.stopPropagation()}
                        />
                        <div
                            className="bar-content"
                            onMouseDown={(e) => handleMouseDown(e, 'move', range)}
                        >
                            {/* Label Logic:
                                Show Name if: sidebar hidden (showLabel) OR explicit "Name" toggle (showBarLabels) is ON.
                                Show Date if: explicit "Date" toggle (showBarDates) is ON.
                            */}
                            {((showLabel || showBarLabels) || showBarDates) && (
                                <span className="bar-label">
                                    {(() => {
                                        const showName = showLabel || showBarLabels;
                                        const nameText = range.label || task.name;
                                        const dateText = `(${dateUtils.formatDate(new Date(range.startDate), 'YYYY.MM.DD')} ~ ${dateUtils.formatDate(new Date(range.endDate), 'MM.DD')})`;

                                        if (showName && showBarDates) return `${nameText} ${dateText}`;
                                        if (showName) return nameText;
                                        if (showBarDates) return dateText;
                                        return '';
                                    })()}
                                </span>
                            )}
                        </div>
                        <div
                            className="resize-handle resize-end"
                            onMouseDown={(e) => handleMouseDown(e, 'resize-end', range)}
                            onMouseEnter={(e) => e.stopPropagation()}
                        />
                    </div>
                );
            })}

            {renderMilestones()}

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



