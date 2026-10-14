import { useState, useRef, useEffect } from 'react';
import { dateUtils } from '../../utils/dateUtils';
import { isTaskOverdue, getTaskStatus } from '../../utils/taskTree';
import { getStatusColor, getTheme, themeColor } from '../../themes/index.js';
import { rollupSegmentTitle, rollupMilestoneTitle, chainStepTitle, tintOver, CHAIN_BACKGROUND, readableTextOn, DARK_TEXT } from './rollupBars';
import { placeMilestoneLabels, milestoneLabelStyle } from './milestoneLabels';
import { visibleMilestoneItems, milestoneLabelText, isDateInRange } from './timelineGeometry';
import { rollupMilestoneItems } from './rollupLabels';
import { milestoneShape } from '../../shared/milestoneShapes';
import './TimelineBar.css';

function TimelineBar({
    task,
    // 첫 행 라벨은 아래를 먼저 쓴다 — 위로 쌓으면 그만큼 빈 여백을 늘 잡아 둬야 한다
    isFirstRow = false,
    // 접혀 있는 가지의 요약 (rollupBars.resolveRollup) — 접혀 있지 않으면 undefined
    rollup = null,
    // 숨은 마일스톤 중 라벨을 달 것과 그 배치 — TimelineView 가 화면 전체를 보고 정한다(rollupLabels.js)
    rollupLabels = null,
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
    showMilestoneDates = false, // 표시 옵션 — 마일스톤 라벨을 날짜로
    showPhaseChain = true, // 표시 옵션 — 접힌 가지를 단계 체인(쉐브론)으로
    darkMode = false,
    isCompact = false,
    timeScale = 'monthly',
    snapEnabled = true,
    chartTheme = 'default',
    colorMode = 'task',
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

    // 진행률/지연 상태 (렌더 시 계산 — 저장 상태 없음)
    const today = dateUtils.formatDate(new Date());
    const progress = task.progress ?? 0;
    const overdue = isTaskOverdue(task, today);
    // 상태 색상 모드에서만 바 색을 일정 상태로 덮는다. 날짜 없는 작업('none')은
    // getStatusColor 가 undefined 를 주므로 아래 폴백이 작업 색을 그대로 쓴다.
    const statusColor = colorMode === 'status'
        ? getStatusColor(getTaskStatus(task, today), chartTheme)
        : undefined;
    // 옅은 막대 테마(미니멀): 바탕은 색의 28%, 진행률 구간만 진한 색, 그룹(레벨 0)은 회색 띠.
    // 테두리·그림자·지연 표시줄은 그리지 않는다 — 지연은 색(상태/색 매핑)이 말한다.
    const tint = getTheme(chartTheme).barFill === 'tint';

    // Handle Drag Start for a specific range
    const handleMouseDown = (e, type, range) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        // 기본 동작(텍스트 선택)을 막는다. 남은 선택은 다음 드래그를 브라우저의 네이티브
        // drag 로 바꿔 막대가 커서를 따라오지 않았다. 대가로 포커스 이동도 막히므로 blur 를
        // 직접 일으킨다 — blur 에 커밋하는 입력칸이 값을 놓치지 않게(구간 드래그 줌과 같은 처리).
        e.preventDefault();
        document.activeElement?.blur?.();
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
                // 하루도 움직이지 않았으면 원래 날짜 그대로다 — 클릭할 때 1px 만 흔들려도 스냅이 원래 시작일을
                // 월·주 경계로 끌어당겨 저장했다(행만 바꾸는 세로 드래그도 날짜가 바뀌었다).
                if (deltaDays === 0) return date;
                if (snapEnabled) {
                    // timeScale에 맞춰 스냅 단위 결정
                    switch (timeScale) {
                        case 'daily':   return dateUtils.snapToDay(date, type);
                        case 'weekly':  return dateUtils.snapToWeek(date, type);
                        case 'monthly': return dateUtils.snapToMonth(date, type);
                        case 'quarterly':
                        case 'yearly':  return dateUtils.snapToQuarter(date, type);
                        default:        return dateUtils.snapAdaptive(date, type, totalDays);
                    }
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
                switch (timeScale) {
                    case 'daily':     snappedDate = dateUtils.snapToDay(rawNewDate, 'closest'); break;
                    case 'weekly':    snappedDate = dateUtils.snapToWeek(rawNewDate, 'start'); break;
                    case 'monthly':   snappedDate = dateUtils.snapToMonth(rawNewDate, 'closest'); break;
                    case 'quarterly':
                    case 'yearly':    snappedDate = dateUtils.snapToQuarter(rawNewDate, 'start'); break;
                    default:          snappedDate = dateUtils.snapAdaptive(rawNewDate, 'closest', totalDays);
                }
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


    // 라벨 배치는 milestoneLabels.js 가 판정한다(순수 — 단위테스트가 규칙을 고정한다).
    // 화면에 보이는 것만 넘긴다: 축 범위를 벗어난 마일스톤은 그려지지 않으므로 자리를
    // 차지하지도 않아야 한다.
    // 이 행 자신의 마일스톤 라벨 배치. 무엇이 보이는지는 TimelineView 의 여백 계산과 **같은 함수**로 정한다.
    // 접힌 행의 숨은 마일스톤 라벨(renderRollup)이 이 자리를 피해 가야 해서 바깥에서 한 번 계산한다.
    const placements = placeMilestoneLabels(
        visibleMilestoneItems(task, { start: startDate, end: endDate }, containerWidth, showMilestoneDates),
        containerWidth, { preferBelow: isFirstRow });

    const renderMilestones = () => {
        if (!task.milestones || task.milestones.length === 0) return null;

        return task.milestones.map((milestone) => {
            const currentDate = (draggingMilestone === milestone.id && draggedMilestoneDate)
                ? draggedMilestoneDate
                : milestone.date;

            if (!isDateInRange(currentDate, { start: startDate, end: endDate })) return null;

            const daysFromStart = dateUtils.getDaysBetween(startDate, currentDate);
            const position = (daysFromStart / totalDays) * containerWidth;

            // 도형의 서술은 shared/milestoneShapes.js 한 곳에서 온다 — 표·차트·내보내기가
            // 각자 그리던 것을 그 파일이 대신한다. 여기서는 차트의 표현만 얹는다:
            // 배경 위에 떠 있어야 하므로 흰 테두리와 그림자를 씌운다.
            const spec = milestoneShape(milestone.shape);
            const color = themeColor(milestone.color, chartTheme);
            // 옅은 막대 테마는 트래커처럼 작게(12px, 원은 r=5), 그림자 없이 흰 테두리만
            const boxSize = tint ? (spec.borderRadius === '50%' ? 10 : 12) : 16;

            const getShape = () => {
                if (spec.kind === 'box') {
                    return <div style={{
                        width: `${boxSize}px`,
                        height: `${boxSize}px`,
                        backgroundColor: color,
                        border: '2px solid white',
                        boxShadow: tint ? 'none' : '0 2px 6px rgba(0, 0, 0, 0.3)',
                        ...(spec.borderRadius ? { borderRadius: spec.borderRadius } : {}),
                        ...(spec.rotate ? { transform: `rotate(${spec.rotate}deg)` } : {}),
                    }} />;
                }
                return (
                    <svg width={tint ? 16 : 20} height={tint ? 16 : 20} viewBox={spec.viewBox} style={tint ? undefined : { filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))' }}>
                        <path d={spec.path} fill={color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                );
            };

            const placement = placements.get(milestone.id) ?? { position: 'top', tier: 0, shiftX: 0, maxWidth: null };
            const labelStyle = milestoneLabelStyle(placement);

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
                            e.preventDefault(); // 막대와 같은 이유 — handleMouseDown 주석
                            document.activeElement?.blur?.();
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
                    <span
                        className="milestone-label"
                        style={labelStyle}
                        data-label-position={placement.position}
                        data-label-tier={placement.tier}
                        title={milestone.label}
                    >{milestoneLabelText(milestone, showMilestoneDates)}</span>
                </div>
            );
        });
    };

    // 접힌 가지의 요약 — 실제 바보다 얇고, 빗금이 있고, 그 위(z-index 30)에 얹힌다
    // (부모가 자기 기간을 가지면 뒤에 깔린 요약은 통째로 가려진다 — TimelineBar.css 주석).
    // 편집 대상이 아니다: 드래그도 우클릭 메뉴도 없고, 클릭하면 대표 행(이 작업)을 고른다.
    // 그 안의 무엇을 고치려면 가지를 펼쳐야 한다 — 요약은 하나의 막대에 여러 작업을 담으므로
    // 여기서 끌면 무엇이 움직여야 하는지 화면이 말해 줄 수 없다.
    // 단계 체인 — 숨은 하위 일정이 하나도 겹치지 않을 때(rollupBars.resolveChain). 칸마다 이름을
    // 쓴다. 모양은 SVG 다: html2canvas 는 clip-path 를 무시해서 CSS 로 깎은 쉐브론은 '이미지로 복사'
    // 에서 사각형이 된다(LG 화살표 바가 SVG 인 것과 같은 이유). 바탕은 옅게(28%, 바탕색과 미리 섞은
    // 불투명 색 — tintOver) 칠하고 글자는 본문 색이다 — 진한 색 위의 흰 글자는 색에 따라 대비가
    // 무너진다. 편집 대상이 아닌 것은 빗금 띠와 같다(클릭하면 이 행을 고른다).
    // 밝게 고정되는 테마(forceLight)는 다크 모드여도 흰 바탕이다.
    const chainBackground = CHAIN_BACKGROUND[(darkMode && !getTheme(chartTheme).forceLight) ? 'dark' : 'light'];
    // 칸 높이는 **px 로** 박는다 — height="100%" + translateY(-50%) 를 html2canvas 가 따로 풀어서 '이미지로
    // 복사'에서 칸이 반 높이로 아래에 찍히고 글자 위가 잘렸다(2026-10-13 레드팀 2차).
    const stepH = (isCompact || tint) ? 20 : 26;
    const chainSteps = (chain) => chain.map(step => ({
        step,
        ...dateUtils.calculateWidth(step.startDate, step.endDate, startDate, endDate, containerWidth),
    }));
    const renderChain = (chain) => chainSteps(chain).map(({ step, width, offset }, i, all) => {
        // 맞닿은 단계(앞 끝날 = 뒤 시작일)는 그 하루가 두 칸에 다 들어간다 — 오른쪽 끝을 다음 칸의 시작에서
        // 자르지 않으면 칸이 하루 폭만큼 겹쳐 틈이 사라지고, 높은 배율에서는 쉐브론 없이 띠 하나가 됐다.
        const next = all[i + 1];
        const span = next ? Math.min(width, next.offset - offset) : width;
        const w = Math.max(span - 2, 1); // 칸 사이 2px 틈 — 맞닿은 단계가 한 덩어리로 보이지 않게
        const tip = Math.min(8, w / 3);   // 화살 깊이. 좁은 칸에서는 줄인다
        const notch = i === 0 ? 0 : tip;  // 첫 칸은 평평하게 시작한다(그림의 '사전 논의')
        // 상태는 **이 칸의 구간**으로 판정한다 — 작업으로 판정하면 기간이 여럿인 자식의 칸이 전부 같은
        // 색이 되고, 레거시 날짜만 있는 자식은 'none' 이 돼 작업 색(진행중처럼 보이는 파랑)으로 칠해졌다.
        const status = getTaskStatus({ ...step.task, timeRanges: [{ startDate: step.startDate, endDate: step.endDate }] }, today);
        const color = (colorMode === 'status' ? getStatusColor(status, chartTheme) : null)
            || themeColor(step.color, chartTheme) || '#98A2B3';
        const fill = tintOver(color, chainBackground, 0.28);
        return (
            <div
                key={`${step.startDate}~${step.endDate}~${i}`}
                className={`timeline-phase-step ${isSelected ? 'is-selected' : ''}`}
                data-testid="phase-step"
                style={{ left: `${offset}px`, width: `${w}px`, height: `${stepH}px`, top: `calc(50% - ${stepH / 2}px)` }}
                title={chainStepTitle(step)}
                // rangeId 가 없다 — 연결 모드에서는 useDependencyLink 가 이것을 거절한다(어느 기간인지 모른다)
                onClick={(e) => { e.stopPropagation(); onSelect(task.id); }}
            >
                <svg className="phase-step-shape" width={w} height={stepH} viewBox={`0 0 ${w} ${stepH}`} aria-hidden="true">
                    <polygon
                        points={`0,0 ${w - tip},0 ${w},${stepH / 2} ${w - tip},${stepH} 0,${stepH} ${notch},${stepH / 2}`}
                        fill={fill || color}
                        fillOpacity={fill ? 1 : 0.28}
                    />
                </svg>
                {w > 28 && (
                    <span className="phase-step-label" style={{ paddingLeft: `${notch + 4}px`, paddingRight: `${tip + 2}px` }}>
                        {step.name}
                    </span>
                )}
            </div>
        );
    });

    // 접힌 행의 숨은 마일스톤 라벨 — 무엇을 어디에 달지는 TimelineView 가 화면 전체를 보고 정했다(rollupLabels.js).
    // 여기서는 그린다. 단계 체인 행에서 '아래' 라벨은 마커가 아니라 **칸의 아래 가장자리**에 붙인다 — 마커는 칸의
    // 위 가장자리에 앉으므로 마커 아래에 달면 칸 이름을 덮는다.
    const renderRollupLabels = () => {
        if (!rollupLabels?.size) return null;
        const chain = showPhaseChain && !!rollup.chain;
        return rollupMilestoneItems(rollup, { start: startDate, end: endDate }, containerWidth, showMilestoneDates)
            .filter(item => rollupLabels.has(item.id))
            .map(item => {
                const placement = rollupLabels.get(item.id);
                const anchorTop = !chain ? undefined
                    : placement.position === 'bottom' ? `calc(50% + ${stepH / 2}px)` : `calc(50% - ${stepH / 2}px)`;
                return (
                    <div
                        key={`label-${item.id}`}
                        className="milestone-marker rollup-label-anchor"
                        style={{ left: `${item.x}px`, ...(anchorTop ? { top: anchorTop } : {}) }}
                    >
                        <span
                            className="milestone-label"
                            data-testid="rollup-milestone-label"
                            style={milestoneLabelStyle(placement)}
                            title={rollupMilestoneTitle(item.ms)}
                        >{item.label}</span>
                    </div>
                );
            });
    };

    const renderRollup = () => {
        if (!rollup) return null;

        return (
            <>
                {showPhaseChain && rollup.chain ? renderChain(rollup.chain) : rollup.segments.map(segment => {
                    const { width, offset } = dateUtils.calculateWidth(
                        segment.startDate, segment.endDate, startDate, endDate, containerWidth
                    );
                    return (
                        <div
                            key={`${segment.startDate}~${segment.endDate}`}
                            className="timeline-rollup-bar"
                            data-testid="rollup-bar"
                            style={{
                                left: `${offset}px`,
                                width: `${width}px`,
                                backgroundColor: statusColor || themeColor(task.color, chartTheme),
                            }}
                            title={rollupSegmentTitle(segment)}
                            onClick={(e) => { e.stopPropagation(); onSelect(task.id); }}
                        />
                    );
                })}
                {renderRollupLabels()}
                {rollup.milestones.map(ms => {
                    if (!isDateInRange(ms.date, { start: startDate, end: endDate })) return null;
                    const left = (dateUtils.getDaysBetween(startDate, ms.date) / totalDays) * containerWidth;
                    return (
                        <div
                            key={ms.id}
                            className="rollup-milestone-marker"
                            data-testid="rollup-milestone"
                            style={{
                                left: `${left}px`,
                                borderColor: ms.color,
                                ...(showPhaseChain && rollup.chain ? { top: `calc(50% - ${stepH / 2}px)` } : {}),
                            }}
                            title={rollupMilestoneTitle(ms)}
                            onClick={(e) => { e.stopPropagation(); onSelect(task.id); }}
                        />
                    );
                })}
            </>
        );
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

                const isLg = chartTheme === 'lg';
                const LG_STROKE = 2;
                // 기본 높이: 모든 테마에서 레벨별 24/20/16px
                // range.barHeight로 개별 오버라이드 가능
                const DEFAULT_BAR_H = { 0: 24, 1: 20, 2: 16 }[level] ?? 24;
                const LG_BAR_H = range.barHeight ?? DEFAULT_BAR_H;
                const LG_ARROW_DEPTH = LG_BAR_H / 2;

                // 기간 레이블: LG 테마에서 range 설정에 따라 표시/숨김
                const showDurLabel = isLg && (range.showDurationLabel !== false);
                const durLabelPos = range.durationLabelPosition || 'above'; // 'above' | 'below' | 'inside'
                const rangeDurationDays = showDurLabel
                    ? Math.max(1, dateUtils.getDaysBetween(range.startDate, range.endDate))
                    : null;

                // LG 선택/기본 테두리 색상 (지연 시 경고색)
                const lgBorderColor = isLg && isSelected
                    ? '#a50034'
                    : (statusColor || (overdue ? 'var(--color-overdue, #d9534f)' : '#9e9e9e'));

                const barColor = statusColor || themeColor(range.color || task.color, chartTheme);
                const showName = showLabel || showBarLabels;
                const nameText = range.label || task.name;
                const dateText = `(${dateUtils.formatDate(new Date(range.startDate), 'YYYY.MM.DD')} ~ ${dateUtils.formatDate(new Date(range.endDate), 'MM.DD')})`;
                const labelText = showName && showBarDates ? `${nameText} ${dateText}` : showName ? nameText : showBarDates ? dateText : '';
                // 미니멀: 진행률로 채운 구간 위의 글자는 채움 색에 더 잘 읽히는 글자색으로 그 채움 **안에** 다시 그린다
                // (빨강 → 흰 글자). 흰 상자나 헤일로를 깔던 동안 막대가 도려낸 것처럼, 또는 번진 것처럼 보였다
                // (사용자 지적, 2026-10-14). 채움과 같은 상자라 위치·색이 어긋날 수 없다.
                const fillTextColor = tint && labelText ? readableTextOn(barColor) : DARK_TEXT;
                const labelOnFill = fillTextColor !== DARK_TEXT;
                // 단계 체인이 있는 행의 부모 막대는 옅게 — opacity 로 흐리던 동안 '이미지로 복사'에는 진하게
                // 찍혔고(캡처가 반영하지 않았다), 선택 표시까지 0.2 로 흐려져 보이지 않았다. 색을 바탕과 미리
                // 섞으면 둘 다 없다. 지우지 않는 것은 부모 기간이 자식보다 길 때 그 바깥을 말해 주기 때문이다.
                const dimForChain = showPhaseChain && !!rollup?.chain;
                const solidColor = dimForChain ? (tintOver(barColor, chainBackground, 0.2) || barColor) : barColor;
                // 옅은 바탕은 color-mix 가 아니라 **불투명도를 준 자식 층**으로 칠한다. color-mix 의
                // 계산값 `color(srgb …)` 를 html2canvas 가 읽지 못해 '이미지로 복사'가 통째로 실패했다.
                // 막대 자체는 투명한 잡기 영역(20px)이고 보이는 띠는 그 안의 층이다(themes.css).
                const tintLayer = level === 0
                    ? { background: 'var(--minimal-n300)', opacity: 0.55 }
                    : { background: barColor, opacity: 0.28 };

                const barStyle = isLg
                    ? {
                        // 투명 컨테이너 — 시각은 자식 div가 담당
                        left: `${offset}px`,
                        width: `${width}px`,
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderRadius: 0,
                        boxShadow: 'none',
                        overflow: 'visible',
                        transform: isActive ? `translateY(calc(-50% + ${draggedRangeY}px))` : undefined,
                        zIndex: isActive ? 100 : 1,
                        cursor: isActive ? (isCopyMode ? 'copy' : 'grabbing') : 'grab',
                        ...(range.barHeight != null ? { height: `${range.barHeight}px` } : {}),
                    }
                    : {
                        left: `${offset}px`,
                        width: `${width}px`,
                        backgroundColor: tint ? 'transparent' : solidColor,
                        transform: isActive ? `translateY(calc(-50% + ${draggedRangeY}px))` : undefined,
                        zIndex: isActive ? 100 : 1,
                        // 선택·지연 표시는 CSS 그림자다(.selected / .overdue) — 인라인 'none' 이 늘
                        // 이겨서 선택한 막대가 화면 어디에도 표시되지 않았다
                        boxShadow: isActive ? '0 4px 8px rgba(0,0,0,0.3)' : (isSelected || overdue ? undefined : 'none'),
                        cursor: isActive ? (isCopyMode ? 'copy' : 'grabbing') : 'grab',
                        ...(range.barHeight != null ? { height: `${range.barHeight}px` } : {}),
                    };

                return (
                    <div
                        key={range.id}
                        ref={(el) => (barRefs.current[range.id] = el)}
                        className={`timeline-bar ${isSelected ? 'selected' : ''} ${isActive ? 'dragging' : ''} ${isLg ? 'theme-lg' : ''} ${overdue && !isLg && !tint ? 'overdue' : ''}`}
                        style={barStyle}
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
                        {/* ── LG 테마 화살표 바 (SVG 방식) ─────────────────
                            SVG polygon + strokeWidth를 사용하면
                            수평/수직/대각선 모든 변의 stroke 두께가 수학적으로
                            동일한 LG_STROKE 픽셀로 보장됩니다.
                            (clip-path 방식은 대각선에서 두께가 불균일해짐)
                         ──────────────────────────────────────────────────── */}
                        {isLg && (
                            <>
                                {/* 기간 레이블: showDurationLabel + durationLabelPosition 반영 */}
                                {rangeDurationDays && (() => {
                                    const labelStyles = {
                                        above: {
                                            position: 'absolute',
                                            bottom: `${LG_BAR_H + 2}px`,
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            fontSize: '11px', fontWeight: 700,
                                            color: '#2d8c00', whiteSpace: 'nowrap',
                                            pointerEvents: 'none', lineHeight: 1, zIndex: 9999,
                                        },
                                        below: {
                                            position: 'absolute',
                                            top: `${LG_BAR_H + 2}px`,
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            fontSize: '11px', fontWeight: 700,
                                            color: '#2d8c00', whiteSpace: 'nowrap',
                                            pointerEvents: 'none', lineHeight: 1, zIndex: 9999,
                                        },
                                        inside: {
                                            position: 'absolute',
                                            top: '50%',
                                            left: '50%',
                                            transform: 'translate(-50%, -50%)',
                                            fontSize: '10px', fontWeight: 700,
                                            color: '#333333', whiteSpace: 'nowrap',
                                            pointerEvents: 'none', lineHeight: 1, zIndex: 9999,
                                        },
                                    };
                                    return (
                                        <div style={labelStyles[durLabelPos] || labelStyles.above}>
                                            {rangeDurationDays}d
                                        </div>
                                    );
                                })()}
                                <svg
                                    style={{
                                        position: 'absolute',
                                        top: 0, left: 0,
                                        overflow: 'hidden',
                                        pointerEvents: 'none',
                                        zIndex: 0,
                                    }}
                                    width={width}
                                    height={LG_BAR_H}
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    {/* stroke는 path 중심 기준 ±S2씩 퍼짐.
                                        polygon 좌표를 S2(=1px) 안으로 인셋하면
                                        stroke가 SVG 뷰포트(= bar 크기)를 벗어나지 않음. */}
                                    <polygon
                                        points={[
                                            `${LG_STROKE / 2},${LG_STROKE / 2}`,
                                            `${width - LG_ARROW_DEPTH},${LG_STROKE / 2}`,
                                            `${width - LG_STROKE / 2},${LG_BAR_H / 2}`,
                                            `${width - LG_ARROW_DEPTH},${LG_BAR_H - LG_STROKE / 2}`,
                                            `${LG_STROKE / 2},${LG_BAR_H - LG_STROKE / 2}`,
                                        ].join(' ')}
                                        fill="white"
                                        stroke={lgBorderColor}
                                        strokeWidth={LG_STROKE}
                                        strokeLinejoin="miter"
                                    />
                                </svg>
                            </>
                        )}
                        {/* 진행률 채움 오버레이 (기본 테마 전용 — LG 화살표 바와는 충돌) */}
                        {tint && <div className="bar-tint" style={tintLayer} />}
                        {!isLg && progress > 0 && !(tint && level === 0) && !dimForChain && (
                            <div
                                className={`bar-progress-fill ${labelOnFill ? 'has-label' : ''}`}
                                style={{ width: `${progress}%`, ...(tint ? { background: barColor } : {}) }}
                            >
                                {labelOnFill && (
                                    // 바닥 라벨과 같은 줄에 오도록 막대 전체 폭의 상자를 둔다(넘치는 부분은 채움이 자른다)
                                    <div className="bar-content" style={{ width: `${Math.max(width - 16, 0)}px` }} aria-hidden="true">
                                        <span className="bar-label" style={{ color: fillTextColor }}>{labelText}</span>
                                    </div>
                                )}
                            </div>
                        )}
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
                            {labelText && <span className="bar-label">{labelText}</span>}
                        </div>
                        <div
                            className="resize-handle resize-end"
                            onMouseDown={(e) => handleMouseDown(e, 'resize-end', range)}
                            onMouseEnter={(e) => e.stopPropagation()}
                        />
                    </div>
                );
            })}

            {renderRollup()}

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
                        zIndex: 0
                    }}
                />
            )}
        </div>
    );
}

export default TimelineBar;



