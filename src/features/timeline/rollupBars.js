// 접힌 가지의 일정을 그 가지를 대표하는 행으로 끌어올린다 — 요약 막대.
//
// 화면의 행은 `flattenTasks` 가 정하고 그것은 `expanded` 만 본다. 그래서 가지를 접으면
// 그 안의 기간·마일스톤은 **그릴 행 자체가 없어진다.** 그런데 가로 축(`computeDateRange`)은
// 자손까지 훑으므로 범위는 그대로다 — 결과는 "그 구간이 통째로 빈 화면"이고, 사용자에게는
// *일정이 없는 것*과 *접은 것*이 똑같아 보인다. 접힌 부모가 자기 기간을 갖고 있지 않으면
// (그룹 작업은 대개 그렇다) 행 전체가 비어 버린다.
//
// 의존성 화살표는 2026-08-13 부터 같은 상황에서 조상 행으로 끌어올려 그린다. 그래서 고치기
// 전에는 **아무 막대도 없는 행에 화살표만 꽂히는** 상태가 실제로 만들어졌다.
//
// 판정 기준은 **화면에 그려지는 트리**다(`TimelineView` 가 받는 `tasks` = 검색 필터를 거친 것).
// 검색 중에는 필터가 조상을 강제로 펼치므로 접힌 행이 없고, 사용자가 검색 중에 직접 접은
// 가지(`uiStore.searchCollapsedIds`)만 요약 대상이 된다. 필터가 걸러낸 작업은 요약하지
// 않는다 — 검색은 "이것만 보여 달라"는 요청이고, 걸러낸 것을 조상 행에 되살리면 그 요청을
// 뒤집는 셈이다. (의존성은 반대로 전체 트리를 본다: 연결은 "보여 달라"의 대상이 아니라
// 사실이기 때문이다.)

// 기간 하나 → [start, end]. 역전된 기간(종료 < 시작)은 고쳐 쓰지도, 버리지도 않는다 —
// 이름이 가리키는 두 날짜를 그대로 덮는다. 판정과 교정은 인스펙터 기간 카드의 몫이다.
const rangeInterval = (range, name) => {
    const a = range?.startDate;
    const b = range?.endDate;
    if (!a || !b) return null;
    return a <= b ? { start: a, end: b, name } : { start: b, end: a, name };
};

// 접힌 가지 아래의 모든 자손(자기 `expanded` 와 무관하게 끝까지)에서 기간·마일스톤을 긁는다.
const collectHidden = (nodes, acc) => {
    (nodes || []).forEach(node => {
        acc.taskCount += 1;

        // 레거시 startDate/endDate 만 있는 작업도 화면에서는 바 하나로 그려진다(TimelineBar 의
        // legacy 폴백과 같은 규칙). 요약에서 빠지면 그 작업만 접었을 때 사라진다.
        const ranges = (node.timeRanges && node.timeRanges.length > 0)
            ? node.timeRanges
            : [{ startDate: node.startDate, endDate: node.endDate }];
        ranges.forEach(range => {
            const interval = rangeInterval(range, node.name);
            if (interval) acc.intervals.push(interval);
        });

        (node.milestones || []).forEach(ms => {
            if (ms.date) {
                acc.milestones.push({ id: ms.id, date: ms.date, label: ms.label, color: ms.color, via: node.name });
            }
        });

        collectHidden(node.children, acc);
    });
    return acc;
};

// 겹치거나 맞닿는 구간만 합친다. **min~max 한 덩어리로 뭉치지 않는다** — 1월과 12월에만
// 일이 있는 가지를 1년짜리 막대로 그리면 없는 일정을 있다고 말하는 것이고, 그것은 사라지는
// 것보다 나쁘다. 사이가 뜨면 뜬 채로 둔다.
const mergeIntervals = (intervals) => {
    const sorted = [...intervals].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const merged = [];

    sorted.forEach(interval => {
        const last = merged[merged.length - 1];
        if (last && interval.start <= last.endDate) {
            if (interval.end > last.endDate) last.endDate = interval.end;
            last.names.add(interval.name);
            last.count += 1;
            return;
        }
        merged.push({
            startDate: interval.start,
            endDate: interval.end,
            names: new Set([interval.name]),
            count: 1,
        });
    });

    return merged.map(({ names, ...rest }) => ({ ...rest, names: [...names] }));
};

// 화면의 행 하나에 대한 요약. 접혀 있지 않거나 숨은 일정이 없으면 null 이다
// (호출부가 "요약할 것이 없다"를 분기 없이 읽을 수 있어야 한다).
export const resolveRollup = (task) => {
    const children = task?.children;
    if (!children || children.length === 0 || task.expanded) return null;

    const { intervals, milestones, taskCount } = collectHidden(children, {
        intervals: [], milestones: [], taskCount: 0,
    });

    const segments = mergeIntervals(intervals);
    if (segments.length === 0 && milestones.length === 0) return null;

    milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { segments, milestones, taskCount };
};

// 툴팁 — 끌어올린 막대가 **어느 자손의 것인지**는 이름 말고 읽을 방법이 없다.
// 화살표의 끌어올림이 상대의 이름을 싣는 것과 같은 이유다.
const MAX_NAMES = 3;

export const rollupSegmentTitle = (segment) => {
    const shown = segment.names.slice(0, MAX_NAMES).join(', ');
    const rest = segment.names.length - MAX_NAMES;
    const who = rest > 0 ? `${shown} 외 ${rest}개` : shown;
    return `숨은 하위 일정: ${who} (${segment.startDate} ~ ${segment.endDate})`;
};

export const rollupMilestoneTitle = (milestone) =>
    `숨은 마일스톤: ${milestone.label || '마일스톤'} (${milestone.date}) — ${milestone.via}`;
