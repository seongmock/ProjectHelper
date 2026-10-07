// 타임라인 좌표 계산 — 순수 함수만. React 도, DOM 도 모른다.
//
// TimelineView.jsx 안에 useMemo/인라인 헬퍼로 있던 것을 꺼냈다. 날짜 → 픽셀 변환은
// 화면으로만 검증할 수 있어서 회귀가 조용히 들어오던 영역이다.
import { dateUtils } from '../../utils/dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

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

// 화면에 그릴 전체 날짜 범위 — **일정이 걸쳐 있는 달(분기)들**이다.
// today 는 '오늘' 마커가 켜져 있을 때만 범위에 포함시킨다 (꺼져 있으면 작업이
// 먼 미래에 있을 때 빈 공간만 넓어진다).
//
// 예전에는 양끝에 14일을 **먼저 더하고** 그 결과를 월/분기 경계로 스냅했다. 그래서
// 여유가 이전 달로 하루라도 넘어가면 **그 달 한 칸이 통째로 빈 채로 열렸다** — 9/14 에
// 시작하는 프로젝트의 축이 8/1 부터였다(사용자 보고, 2026-09-17). 한 달이 곧 한 칸이라
// 이 낭비는 최대 한 칸(분기 보기에서는 한 분기)이고, 여유가 크다고 눈에 잘 보이는 것도
// 아니다. 이제 스냅은 **실제** 최초·최종 날짜가 든 칸으로 한다 — 경계까지의 거리가
// 그대로 여유가 되므로(평균 보름) 여유를 따로 더할 필요가 없다. 대가: 일정이 딱 1일에
// 시작하면 왼쪽에 끌 자리가 없다(날짜는 인스펙터에서 입력할 수 있다).
export const computeDateRange = (tasks, timeScale, showToday, today = new Date()) => {
    if (tasks.length === 0) {
        return { start: new Date(today), end: new Date(today.getTime() + 90 * DAY_MS) };
    }

    const allDates = collectDates(tasks);
    if (showToday) allDates.push(new Date(today));

    const first = new Date(Math.min(...allDates));
    const last = new Date(Math.max(...allDates));

    if (timeScale === 'quarterly') {
        return {
            start: dateUtils.getQuarterStart(first.getFullYear(), Math.floor(first.getMonth() / 3) + 1),
            end: dateUtils.getQuarterEnd(last.getFullYear(), Math.floor(last.getMonth() / 3) + 1),
        };
    }
    return {
        start: new Date(first.getFullYear(), first.getMonth(), 1),
        end: new Date(last.getFullYear(), last.getMonth() + 1, 0),
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
//
// 날짜는 **로컬 자정**으로 읽는다(dateUtils.addDays(x, 0)). new Date('YYYY-MM-DD') 는 UTC 자정이라
// KST 에서는 9시간 늦은 시각이 되고, itemAnchor 의 올림(ceil)이 그것을 하루로 키워 화살표 끝이
// 막대보다 하루 오른쪽에 붙었다. 막대는 dateUtils 로 그리므로 둘이 같은 규칙이어야 한다.
const localTime = (date) => dateUtils.addDays(date, 0).getTime();

export const taskItemEntries = (task, index) => {
    const entries = [];

    let minStart = task.startDate;
    let maxEnd = task.endDate;
    if (task.timeRanges && task.timeRanges.length > 0) {
        minStart = new Date(Math.min(...task.timeRanges.map(r => localTime(r.startDate))));
        maxEnd = new Date(Math.max(...task.timeRanges.map(r => localTime(r.endDate))));
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
            startDate: localTime(range.startDate),
            endDate: localTime(range.endDate),
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
// 한 행에서 **실제로 그려지는** 마일스톤만, 라벨 배치가 받는 형태로 추린다.
// 축 밖의 마일스톤은 그려지지 않으므로 라벨 자리도 차지하지 않는다. 이 목록을 두 곳이
// 본다 — TimelineBar(그린다)와 TimelineView(첫 행 라벨이 요구하는 위쪽 여백을 잰다).
// 따로 거르면 화면에 없는 라벨을 기준으로 여백이 잡히거나 그 반대가 된다.
// 마일스톤 라벨에 실을 글자. '마일스톤 날짜 라벨' 표시 옵션이 켜지면 이름 대신 날짜(yy.mm.dd)다
// — SOW Tracker 간트에서 가져온 표기. 이름은 그때 툴팁으로 간다. 배치(폭 추정)도 이 글자로 해야
// 화면의 라벨과 자리 계산이 어긋나지 않는다.
export const milestoneLabelText = (milestone, showDates) =>
    (showDates && typeof milestone.date === 'string') ? milestone.date.slice(2).replace(/-/g, '.') : milestone.label;

// 날짜(문자열 또는 Date)가 축 범위 안인가 — **날짜 단위**로 비교한다. new Date('YYYY-MM-DD') 는
// UTC 자정이라 KST 에서는 그날 09:00 이 되고, 축의 끝(말일 00:00)보다 늦어서 말일의 마일스톤이
// **아예 그려지지 않았다**. 그리는 곳(TimelineBar)과 여백 계산(아래)이 이것 하나를 쓴다.
export const isDateInRange = (date, dateRange) => {
    const d = dateUtils.formatDate(date);
    return d >= dateUtils.formatDate(dateRange.start) && d <= dateUtils.formatDate(dateRange.end);
};

export const visibleMilestoneItems = (task, dateRange, contentWidth, showDates = false) => {
    const totalDays = dateUtils.getDaysBetween(dateRange.start, dateRange.end);
    return (task?.milestones || [])
        .filter(m => isDateInRange(m.date, dateRange))
        .map(m => ({
            id: m.id,
            label: milestoneLabelText(m, showDates),
            labelPosition: m.labelPosition,
            x: (dateUtils.getDaysBetween(dateRange.start, m.date) / totalDays) * contentWidth,
        }));
};

// 월 경계의 x 좌표 — 한 줄 머리글(singleAxis 테마)의 라벨과 본문의 월 격자가 **같은 값**을
// 쓴다. 막대와 같은 환산(getDaysBetween)이라 격자가 막대의 날짜와 맞는다. 범위 앞에 걸친
// 첫 달은 0 에서 시작한다.
export const monthGridLines = (dateRange, contentWidth) => {
    const totalDays = dateUtils.getDaysBetween(dateRange.start, dateRange.end);
    if (!totalDays || !contentWidth) return [];
    const lines = dateUtils.generateMonthRange(dateRange.start, dateRange.end).map(({ year, month }) => {
        const days = dateUtils.getDaysBetween(dateRange.start, dateUtils.getMonthStart(year, month));
        return { year, month, x: Math.max(0, (days / totalDays) * contentWidth) };
    });
    return lines.map((line, i) => ({ ...line, width: (lines[i + 1]?.x ?? contentWidth) - line.x }));
};

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
    // 값은 로컬 자정의 시각(taskItemEntries) 또는 마일스톤의 날짜 문자열 — dateUtils 가 둘 다 읽는다
    const days = edge === 'end'
        ? dateUtils.getDuration(dateRange.start, date)
        : dateUtils.getDaysBetween(dateRange.start, date);
    const row = isMilestone ? item.parentIndex : item.index;
    return {
        x: (days / totalDays) * contentWidth,
        y: row * rowHeight + rowHeight / 2,
    };
};

// 화살표 경로는 내보내기와 공유하는 순수 모듈에 있다 — 여기서는 다시 내보내기만 한다.
export { dependencyPath } from './dependencyPath.js';
