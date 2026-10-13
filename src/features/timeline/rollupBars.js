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
const rangeInterval = (range, node) => {
    const a = range?.startDate;
    const b = range?.endDate;
    if (!a || !b) return null;
    const [start, end] = a <= b ? [a, b] : [b, a];
    return { start, end, name: node.name, color: range.color || node.color, task: node };
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
            const interval = rangeInterval(range, node);
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

// 숨은 일정이 **하나도 겹치지 않고 차례로 이어지면** 단계 체인(쉐브론)으로 그린다 — 단계마다 칸이
// 따로 있어 이름을 칸 안에 쓸 수 있다. 빗금 띠는 이름이 툴팁에만 있어서 접는 순간 "무엇이 언제"가
// 화면에서 사라졌다. 앞 단계의 끝날에 다음 단계가 시작하는 것(맞닿음)은 겹침이 아니다 — 단계를
// 마일스톤 날짜로 잇는 계획(SOW 등)이 늘 그렇다. **하나라도 겹치면 null** 이고 빗금 띠로 돌아간다:
// 일부만 쉐브론으로 그리면 한 행에 두 표현이 섞여, 어느 쪽이 무엇을 뜻하는지 읽을 수 없다.
//
// 시작일이 같은 두 단계는 겹침이다 — 정렬이 동률을 어떻게 놓느냐에 따라 판정이 갈렸다(하루짜리
// [6/1~6/1] 다음 [6/1~6/30] 은 체인, 순서를 뒤집으면 빗금). 그리고 보는 것은 **체인 후보 구간**이다:
// 자기 자식들을 감싸기만 하는 중간 노드의 기간(3단 WBS 의 요약 기간)은 빼야 한다 — 그 기간이 자식들과
// "겹쳐서" 흔한 WBS 에서 체인이 한 번도 되지 않았다(collectChainIntervals).
const resolveChain = (intervals) => {
    if (intervals.length === 0) return null;
    const sorted = [...intervals].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end || sorted[i].start === sorted[i - 1].start) return null;
    }
    return sorted.map(({ start, end, name, color, task }) => ({ startDate: start, endDate: end, name, color, task }));
};

// 체인 후보 구간 — collectHidden 과 같은 자손을 훑되, 자식이 있는 노드의 자기 기간이 **자손 구간의
// 범위 안**에 들어가면 뺀다(그것은 자식들의 요약이지 따로 하는 일이 아니다). 범위를 벗어나는 기간은
// 남긴다 — 그러면 자식과 겹치므로 빗금 띠가 되고, 없는 체인을 지어내지 않는다.
const collectChainIntervals = (nodes) => (nodes || []).flatMap(node => {
    const inner = collectChainIntervals(node.children);
    const ranges = (node.timeRanges && node.timeRanges.length > 0)
        ? node.timeRanges
        : [{ startDate: node.startDate, endDate: node.endDate }];
    const own = ranges.map(range => rangeInterval(range, node)).filter(Boolean);
    if (inner.length === 0) return own;
    const lo = inner.reduce((m, iv) => (iv.start < m ? iv.start : m), inner[0].start);
    const hi = inner.reduce((m, iv) => (iv.end > m ? iv.end : m), inner[0].end);
    return [...own.filter(iv => iv.start < lo || iv.end > hi), ...inner];
});

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
    return { segments, chain: resolveChain(collectChainIntervals(children)), milestones, taskCount };
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

// 단계 칸의 옅은 바탕을 **불투명한 색**으로 미리 섞는다(색 × alpha + 바탕 × (1−alpha)). 반투명으로
// 칠하면 그 행의 부모 막대가 비쳐 칸 색이 진해지고 글자가 묻힌다. CSS 변수나 fill-opacity 에 기대지
// 않는 이유는 '이미지로 복사'(html2canvas)가 SVG 를 문서 밖에서 그리기 때문이다 — 변수는 풀리지 않는다.
// 16진 색(#rgb·#rrggbb)과 rgb()만 섞고, 그 밖의 형식(이름 색 등)이면 null(호출부가 반투명으로 폴백한다).
const parseHex = (c) => {
    const text = typeof c === 'string' ? c.trim() : '';
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text); // rgb()/rgba() 도 받는다(알파는 무시)
    if (rgb) return [rgb[1], rgb[2], rgb[3]].map(v => Math.min(255, Number(v)));
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};

// 섞을 바탕 — App.css 의 --color-bg-primary 와 같은 값이어야 한다(단위 테스트가 대조한다)
export const CHAIN_BACKGROUND = { light: '#FFFFFF', dark: '#1E1E1E' };

export const tintOver = (color, background, alpha) => {
    const fg = parseHex(color);
    const bg = parseHex(background);
    if (!fg || !bg) return null;
    return '#' + fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
};

export const chainStepTitle = (step) => `${step.name} (${step.startDate} ~ ${step.endDate})`;

export const rollupMilestoneTitle = (milestone) =>
    `숨은 마일스톤: ${milestone.label || '마일스톤'} (${milestone.date}) — ${milestone.via}`;
