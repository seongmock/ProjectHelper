// 일정 계산 — 날짜 산술 · 캐스케이드 이동 · 임계경로/여유(slack).
//
// 순수 모듈이다: store 도 express 도 모른다. 트리를 받아 트리나 값을 돌려준다.
// 그래서 taskService 가 **한 번의 withTasks 안에서** 캐스케이드를 이어 붙일 수 있다 —
// 두 번 쓰면 그 사이에 브라우저가 반쯤 밀린 계획을 폴링으로 본다.
//
// 날짜는 항상 'YYYY-MM-DD' 문자열이고 파싱은 **UTC** 다. 로컬 파싱은 서버 타임존에
// 따라 하루가 밀리고, 그 하루는 간트에서 한 칸이다.
const tree = require('./taskTree');

const DAY_MS = 86_400_000;

const parseDay = (d) => (typeof d === 'string' ? Date.parse(`${d}T00:00:00Z`) : NaN);
const toDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const diffDays = (a, b) => {
    const ta = parseDay(a);
    const tb = parseDay(b);
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / DAY_MS);
};

const addDays = (d, n) => {
    const t = parseDay(d);
    if (isNaN(t)) return d;
    return toDay(t + n * DAY_MS);
};

// 0=일 … 6=토
const dayOfWeek = (d) => new Date(parseDay(d)).getUTCDay();
const isWeekend = (d) => {
    const w = dayOfWeek(d);
    return w === 0 || w === 6;
};

// 주말에 떨어진 날짜를 다음 평일로 민다. 단조 증가라, 시작·종료에 각각 적용해도
// 순서가 뒤집히지 않는다(뒤집힌 range 는 차트에서 0px 이다).
// ponytail: 주말만 안다 — 공휴일 달력은 데이터 모델에 없다. 필요해지면 여기에
// 휴일 집합을 주입하는 인자를 붙이는 것이 최소 변경이다.
const nextWorkday = (d) => {
    let out = d;
    while (isWeekend(out)) out = addDays(out, 1);
    return out;
};

// a..b 사이의 평일 수(a 제외, b 포함 — diffDays 와 같은 셈법).
const diffWorkdays = (a, b) => {
    const total = diffDays(a, b);
    if (total === null) return null;
    const step = total >= 0 ? 1 : -1;
    let count = 0;
    let cur = a;
    for (let i = 0; i < Math.abs(total); i++) {
        cur = addDays(cur, step);
        if (!isWeekend(cur)) count += step;
    }
    return count;
};

// ── 후행 전파 ────────────────────────────────────────
// successors(Map<id, id[]>)를 따라 startId 에서 도달 가능한 모든 후행 id.
// 방문 집합이 있어 순환이 있어도 멈춘다 — 순환 데이터는 이 함수가 판정할 일이 아니다.
const collectTransitiveSuccessors = (successors, startId) => {
    const out = new Set();
    const queue = [startId];
    while (queue.length > 0) {
        for (const next of successors.get(queue.shift()) || []) {
            if (out.has(next)) continue;
            out.add(next);
            queue.push(next);
        }
    }
    out.delete(startId); // 자기 자신은 이동 대상이 아니다(순환이면 되돌아온다)
    return out;
};

// idSet 에 든 엔티티(기간·마일스톤·작업)의 날짜를 days 만큼 민다.
// 작업 id 가 들어오면 그 작업이 **직접** 가진 기간·마일스톤을 민다(작업 레벨
// dependencies 는 레거시지만 옛 데이터에 남아 있다). 하위 작업은 따라가지 않는다 —
// 계층은 의존이 아니다.
const shiftEntities = (tasks, idSet, days, { workdays = false } = {}) => {
    if (days === 0 || idSet.size === 0) return tasks;
    const land = (d) => {
        const moved = addDays(d, days);
        return workdays ? nextWorkday(moved) : moved;
    };

    const walk = (items) => items.map(item => {
        const wholeTask = idSet.has(item.id);
        let ranges = item.timeRanges;
        let milestones = item.milestones;
        let touched = false;

        if (ranges) {
            const next = ranges.map(r => {
                if (!wholeTask && !idSet.has(r.id)) return r;
                touched = true;
                return { ...r, startDate: land(r.startDate), endDate: land(r.endDate) };
            });
            if (touched) ranges = next;
        }
        if (milestones) {
            let msTouched = false;
            const next = milestones.map(m => {
                if (!wholeTask && !idSet.has(m.id)) return m;
                msTouched = true;
                return { ...m, date: land(m.date) };
            });
            if (msTouched) milestones = next;
        }

        return {
            ...item,
            ...(ranges ? { timeRanges: ranges } : {}),
            ...(milestones ? { milestones } : {}),
            // 기간이 움직였으면 캐시된 상·하한도 다시 계산한다(뷰가 이 값을 읽는다)
            ...(touched ? tree.recalcTaskBounds(ranges) : {}),
            children: walk(item.children || []),
        };
    });

    return walk(tasks);
};

// ── 임계경로 / 여유 ──────────────────────────────────
// 날짜는 이미 사용자가 정해 놓았으므로 기간에서 일정을 **만들지** 않는다. 대신
// "이 항목이 며칠 늦어져야 다음 것을(끝내는 결국 프로젝트 종료를) 밀기 시작하는가"를
// 뒤에서 앞으로 계산한다 — 그게 실제로 답이 필요한 질문이다.
//   LF(n) = 후행이 없으면 프로젝트 종료일, 있으면 min(후행의 LS)
//   LS(n) = LF(n) - 기간
//   slack(n) = LF(n) - n.end
// 순환이 있으면 위상 정렬 자체가 없다 — 계산하지 않고 cycles 를 그대로 돌려준다.
const criticalPath = (tasks) => {
    const issues = tree.findDependencyIssues(tasks);
    if (issues.cycles.length > 0) return { cycles: issues.cycles, nodes: [], criticalIds: [] };

    const flat = tree.flattenAll(tasks || []);
    const taskName = new Map(flat.map(t => [t.id, t.name]));
    const entities = tree.collectEntities(flat);

    const nodes = new Map();
    for (const e of entities) {
        const w = tree.entityWindow(e);
        if (!w) continue;
        nodes.set(e.id, {
            id: e.id,
            name: e.name,
            type: e.type || 'task',
            taskId: e.type ? e.parentId : e.id,
            taskName: taskName.get(e.type ? e.parentId : e.id) || '',
            start: w.start,
            end: w.end,
        });
    }
    if (nodes.size === 0) return { cycles: [], nodes: [], criticalIds: [] };

    // 간선은 dep → holder(후행). 양끝이 모두 날짜를 가진 것만 본다.
    const succ = new Map();
    const indeg = new Map([...nodes.keys()].map(id => [id, 0]));
    for (const e of entities) {
        if (!nodes.has(e.id)) continue;
        for (const depId of e.dependencies || []) {
            if (!nodes.has(depId)) continue;
            if (!succ.has(depId)) succ.set(depId, []);
            succ.get(depId).push(e.id);
            indeg.set(e.id, indeg.get(e.id) + 1);
        }
    }

    // 위상 정렬(칸)
    const order = [];
    const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
    while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        for (const s of succ.get(id) || []) {
            indeg.set(s, indeg.get(s) - 1);
            if (indeg.get(s) === 0) queue.push(s);
        }
    }

    const projectStart = [...nodes.values()].reduce((m, n) => (m && m < n.start ? m : n.start), null);
    const projectEnd = [...nodes.values()].reduce((m, n) => (m && m > n.end ? m : n.end), null);

    // 역순 순회 — 후행이 먼저 확정된다
    const lf = new Map();
    for (const id of [...order].reverse()) {
        const n = nodes.get(id);
        const outs = succ.get(id) || [];
        let value = projectEnd;
        for (const s of outs) {
            const sn = nodes.get(s);
            const sls = addDays(lf.get(s) ?? sn.end, -Math.max(0, diffDays(sn.start, sn.end)));
            if (sls < value) value = sls;
        }
        lf.set(id, value);
    }

    const out = [...nodes.values()].map(n => {
        const latestFinish = lf.get(n.id) ?? projectEnd;
        const slackDays = diffDays(n.end, latestFinish) ?? 0;
        return {
            ...n,
            latestFinish,
            slackDays,
            slackWorkdays: diffWorkdays(n.end, latestFinish) ?? 0,
            critical: slackDays <= 0,
        };
    }).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    return {
        cycles: [],
        projectStart,
        projectEnd,
        nodes: out,
        // ponytail: 여유 0 인 항목들을 시작일 순으로 돌려준다. 병렬 경로가 둘 다
        // 여유 0 이면 한 줄의 사슬이 아니라 그 합집합이다 — 사슬이 필요하면
        // successors 를 따라 한 번 더 걸러야 한다.
        criticalIds: out.filter(n => n.critical).map(n => n.id),
    };
};

module.exports = {
    diffDays, addDays, isWeekend, nextWorkday, diffWorkdays,
    collectTransitiveSuccessors, shiftEntities, criticalPath,
};
