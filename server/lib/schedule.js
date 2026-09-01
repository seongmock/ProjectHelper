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

// `toISOString().slice(0,10)` 이 전제하는 것은 **네 자리 연도**뿐이다. 그 밖으로 나가면
// ISO 는 확장연도 `+010000-01-01` / `-000001-11-27` 를 내놓고 slice 가 가운데를 잘라
// `'+010000-01'` 같은 값이 저장된다 — 그 문자열은 이후 어떤 date 검증도 통과하지 못해
// 그 기간을 다시 쓰려는 모든 요청이 400 이 되고, 차트의 사전순 정렬에서 `'+'`(0x2B)가
// 모든 숫자보다 작아 축 전체가 무너진다(한 번의 캐스케이드가 그 둘을 함께 만들었다).
// 그래서 포화시킨다: 9999년을 넘겨야 하는 일정은 없고, 넘겼을 때 필요한 것은 규약을
// 깬 문자열이 아니라 규약 안의 값이다.
const MIN_DAY_MS = Date.parse('0001-01-01T00:00:00Z');
const MAX_DAY_MS = Date.parse('9999-12-31T00:00:00Z');
const toDay = (ms) => new Date(Math.min(MAX_DAY_MS, Math.max(MIN_DAY_MS, ms))).toISOString().slice(0, 10);

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
// 상한(9999-12-31)에서 addDays 가 포화하므로 `while` 은 거기서 영원히 돈다 — 종료
// 조건은 날짜가 아니라 횟수여야 한다. 주말은 연속 이틀이니 7회면 충분하다.
const nextWorkday = (d) => {
    let out = d;
    for (let i = 0; i < 7 && isWeekend(out); i++) out = addDays(out, 1);
    return out;
};

// a..b 사이의 평일 수(a 제외, b 포함 — diffDays 와 같은 셈법).
//
// **하루씩 세면 안 된다.** criticalPath 가 노드마다 이 함수를 부르고 그 구간은 각 노드의
// 종료일부터 **프로젝트 종료일**까지다 — 마일스톤 하나에 '9999-12-31'(TBD 자리표시자로
// 흔하다)이 들어간 20작업 프로젝트의 `GET /critical-path` 한 번이 싱글스레드 이벤트
// 루프를 3분 세웠다(그동안 /api/health 도 안 나간다). 5000노드 상한 안의 평범한
// 트리로도 35초였다. 주 단위 산술로 접으면 남는 순회는 나머지 6일뿐이다.
const EPOCH_DOW = 4; // 1970-01-01 은 목요일 (0=일)
const isWeekendDay = (dayNum) => {
    const w = ((dayNum % 7) + EPOCH_DOW + 7) % 7;
    return w === 0 || w === 6;
};

const diffWorkdays = (a, b) => {
    const ta = parseDay(a);
    const tb = parseDay(b);
    if (isNaN(ta) || isNaN(tb)) return null;
    const da = Math.round(ta / DAY_MS);
    const db = Math.round(tb / DAY_MS);
    if (da === db) return 0;

    // 세는 구간은 'a 를 뺀, b 쪽 |총일수|일' — 앞으로면 [da+1, db], 뒤로면 [db, da-1].
    const forward = db > da;
    const lo = forward ? da + 1 : db;
    const hi = forward ? db : da - 1;

    const weeks = Math.floor((hi - lo + 1) / 7);
    let count = weeks * 5;
    for (let d = lo + weeks * 7; d <= hi; d++) if (!isWeekendDay(d)) count += 1;
    if (count === 0) return 0; // -0 은 0 과 strict-equal 이 아니다 — 호출부가 그것에 걸린다
    return forward ? count : -count;
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
// exclude: 이동 대상에서 명시적으로 뺄 엔티티 id. 캐스케이드가 **방금 편집한 그 기간**을
// 한 번 더 미는 것을 막는다 — 작업 레벨 dependencies(레거시)가 후행 집합에 그 기간의
// 소유 작업을 되돌려 넣으면 아래 `wholeTask` 분기가 그 작업의 모든 기간을 밀었고, 그러면
// 200 응답이 저장소와 다른 날짜를 말한다(사용자는 종료일만 밀었는데 시작일까지 밀렸다).
const shiftEntities = (tasks, idSet, days, { workdays = false, exclude = null } = {}) => {
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
                if (exclude && exclude.has(r.id)) return r;
                touched = true;
                return { ...r, startDate: land(r.startDate), endDate: land(r.endDate) };
            });
            if (touched) ranges = next;
        }
        if (milestones) {
            let msTouched = false;
            const next = milestones.map(m => {
                if (!wholeTask && !idSet.has(m.id)) return m;
                if (exclude && exclude.has(m.id)) return m;
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

    // 의존성은 기간·마일스톤 레벨에 있으므로 **기간을 가진 작업 노드에는 간선이 하나도
    // 없다** — 그대로 두면 LF 가 프로젝트 종료일이 되어 API 가 같은 구간에 대해 두 개의
    // 다른 여유를 답한다(작업 t1 은 10일, 그 t1 의 유일한 기간 r1 은 5일). "이 작업을
    // 며칠 미룰 수 있나"의 답은 그 작업의 **모든** 항목이 미룰 수 있는 일수다.
    const slackOf = (id) => diffDays(nodes.get(id).end, lf.get(id) ?? projectEnd) ?? 0;
    const ownSlack = new Map();
    for (const e of entities) {
        if (!e.type || !nodes.has(e.id)) continue;
        const s = slackOf(e.id);
        const cur = ownSlack.get(e.parentId);
        if (cur === undefined || s < cur) ownSlack.set(e.parentId, s);
    }

    const out = [...nodes.values()].map(n => {
        const inherited = n.type === 'task' ? ownSlack.get(n.id) : undefined;
        const slackDays = inherited !== undefined ? inherited : slackOf(n.id);
        const latestFinish = addDays(n.end, slackDays);
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
