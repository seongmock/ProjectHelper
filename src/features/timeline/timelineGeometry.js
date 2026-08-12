// 타임라인 좌표 계산 — 순수 함수만. React 도, DOM 도 모른다.
//
// TimelineView.jsx 안에 useMemo/인라인 헬퍼로 있던 것을 꺼냈다. 날짜 → 픽셀 변환은
// 화면으로만 검증할 수 있어서 회귀가 조용히 들어오던 영역이다.
import { dateUtils } from '../../utils/dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_PADDING_DAYS = 14;

// 트리 전체(자식 포함)에서 날짜를 긁어모은다 — 기간·레거시 시작/종료일·마일스톤
const collectDates = (items) => {
    const dates = [];
    items.forEach(item => {
        if (item.timeRanges && item.timeRanges.length > 0) {
            item.timeRanges.forEach(range => {
                if (range.startDate) dates.push(new Date(range.startDate));
                if (range.endDate) dates.push(new Date(range.endDate));
            });
        } else {
            if (item.startDate) dates.push(new Date(item.startDate));
            if (item.endDate) dates.push(new Date(item.endDate));
        }
        (item.milestones || []).forEach(ms => {
            if (ms.date) dates.push(new Date(ms.date));
        });
        if (item.children && item.children.length > 0) {
            dates.push(...collectDates(item.children));
        }
    });
    return dates;
};

// 화면에 그릴 전체 날짜 범위. 양끝에 14일 여유를 두고 월/분기 경계로 스냅한다.
// today 는 '오늘' 마커가 켜져 있을 때만 범위에 포함시킨다 (꺼져 있으면 작업이
// 먼 미래에 있을 때 빈 공간만 넓어진다).
export const computeDateRange = (tasks, timeScale, showToday, today = new Date()) => {
    if (tasks.length === 0) {
        return { start: new Date(today), end: new Date(today.getTime() + 90 * DAY_MS) };
    }

    const allDates = collectDates(tasks);
    if (showToday) allDates.push(new Date(today));

    const paddedStart = dateUtils.addDays(new Date(Math.min(...allDates)), -RANGE_PADDING_DAYS);
    const paddedEnd = dateUtils.addDays(new Date(Math.max(...allDates)), RANGE_PADDING_DAYS);

    if (timeScale === 'quarterly') {
        return {
            start: dateUtils.getQuarterStart(paddedStart.getFullYear(), Math.floor(paddedStart.getMonth() / 3) + 1),
            end: dateUtils.getQuarterEnd(paddedEnd.getFullYear(), Math.floor(paddedEnd.getMonth() / 3) + 1),
        };
    }
    return {
        start: new Date(paddedStart.getFullYear(), paddedStart.getMonth(), 1),
        end: new Date(paddedEnd.getFullYear(), paddedEnd.getMonth() + 1, 0),
    };
};

// 오늘 마커의 x 좌표. 범위 밖이면 null (그리지 않는다).
export const computeTodayPosition = (dateRange, contentWidth, showToday, today = new Date()) => {
    if (!showToday) return null;
    if (today < dateRange.start || today > dateRange.end) return null;
    const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
    return (dateUtils.getDaysBetween(dateRange.start, today) / totalDays) * contentWidth;
};

// 작업 하나가 의존성 앵커로 기여하는 항목 전부 — 작업 자체 / 개별 기간 / 마일스톤.
// `index` 는 **그 항목이 앉는 화면 행**이고 항목 자신의 위치가 아니다: 접힌 가지 안의
// 항목을 조상 행으로 끌어올릴 때 같은 계산을 그대로 다시 쓴다(dependencyLinks.js).
// 반환은 Map 에 그대로 넣을 수 있는 [id, item] 쌍이다.
export const taskItemEntries = (task, index) => {
    const entries = [];

    let minStart = task.startDate;
    let maxEnd = task.endDate;
    if (task.timeRanges && task.timeRanges.length > 0) {
        minStart = new Date(Math.min(...task.timeRanges.map(r => new Date(r.startDate).getTime())));
        maxEnd = new Date(Math.max(...task.timeRanges.map(r => new Date(r.endDate).getTime())));
    }

    // 작업 자체 (레거시 의존성 · 그룹핑용) — 전체 범위
    entries.push([task.id, { type: 'task', data: task, index, startDate: minStart, endDate: maxEnd, name: task.name }]);

    // 개별 기간 — 의존성은 이제 기간 단위가 기본이다
    (task.timeRanges || []).forEach(range => {
        if (!range.id) return;
        entries.push([range.id, {
            type: 'range',
            data: range,
            parentId: task.id,
            index,
            startDate: new Date(range.startDate).getTime(),
            endDate: new Date(range.endDate).getTime(),
            name: task.name,
            color: range.color || task.color,
        }]);
    });

    // 마일스톤 — 부모 작업의 행에 놓인다
    (task.milestones || []).forEach(ms => {
        entries.push([ms.id, {
            type: 'milestone',
            data: ms,
            parentIndex: index,
            date: ms.date,
            name: ms.label || '마일스톤',
        }]);
    });

    return entries;
};

// 의존성 선을 그리려면 "id → 그 항목이 몇 번째 행의 어느 날짜에 있나"가 필요하다.
// 작업 / 개별 기간 / 마일스톤을 한 Map 에 모은다. **화면에 행이 있는 것만** 들어간다.
export const buildItemMap = (flatTasks) => {
    const map = new Map();
    flatTasks.forEach((task, index) => {
        taskItemEntries(task, index).forEach(([id, item]) => map.set(id, item));
    });
    return map;
};

// 의존성 선의 시작점(선행의 오른쪽 끝) / 끝점(후행의 왼쪽 끝).
// edge: 'end' | 'start'. end 는 getDuration(끝일 포함), start 는 getDaysBetween —
// 이 1일 차이가 바의 오른쪽 끝과 왼쪽 끝을 만든다. 통일하면 선이 바 안쪽에 박힌다.
export const itemAnchor = (item, edge, dateRange, totalDays, contentWidth, rowHeight) => {
    const isMilestone = item.type === 'milestone';
    const date = isMilestone ? item.date : (edge === 'end' ? item.endDate : item.startDate);
    const days = edge === 'end'
        ? dateUtils.getDuration(dateRange.start, isMilestone ? date : new Date(date))
        : dateUtils.getDaysBetween(dateRange.start, isMilestone ? date : new Date(date));
    const row = isMilestone ? item.parentIndex : item.index;
    return {
        x: (days / totalDays) * contentWidth,
        y: row * rowHeight + rowHeight / 2,
    };
};

// 선행 → 후행 경로. 뒤로 가야 하는 경우(후행이 선행보다 왼쪽) 우회 경로를 만든다.
export const dependencyPath = (startX, startY, endX, endY) => {
    if (startX < endX - 40) {
        const midX = startX + 20;
        return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    }
    if (startY === endY && startX < endX) {
        return `M ${startX} ${startY} L ${endX} ${endY}`; // 같은 행 · 정방향 → 직선
    }
    const backX = startX + 10;
    const forwardX = endX - 30;
    const midY = (startY + endY) / 2;
    return `M ${startX} ${startY} L ${backX} ${startY} L ${backX} ${midY} L ${forwardX} ${midY} L ${forwardX} ${endY} L ${endX} ${endY}`;
};
