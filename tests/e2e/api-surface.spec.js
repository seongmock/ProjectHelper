// AI 가 쓰는 API 표면의 **HTTP 경계** 검증. 판정 규칙 자체는 server/test/ 가 고정한다 —
// 여기서 보는 것은 라우트가 실제로 붙어 있는지, 쿼리 파라미터가 서비스까지 닿는지,
// 응답 형태가 문서와 같은지다. server 테스트는 서비스를 직접 부르므로 라우트가 빠져
// 있어도 초록불이고, 그 차이는 에이전트가 404 를 받는 순간에만 드러난다.
//
// 각 테스트는 **자기 프로젝트**를 만들어서 쓴다: 리비전 증가를 세는 검사가 있어서,
// 브라우저 탭이 default 프로젝트에 하는 자동저장과 섞이면 안 된다.
import { test, expect } from '@playwright/test';

let pid;

test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/projects', { data: { name: `api-surface-${Date.now()}` } });
    expect(res.status()).toBe(201);
    pid = (await res.json()).project.id;
});

test.afterEach(async ({ request }) => {
    if (pid) await request.delete(`/api/projects/${pid}`);
});

const base = () => `/api/projects/${pid}`;

const addTask = async (request, data) => {
    const res = await request.post(`${base()}/tasks`, { data });
    expect(res.status()).toBe(201);
    return (await res.json()).task;
};

const revision = async (request) => (await (await request.get(`${base()}/revision`)).json()).revision;

// ── 일괄 적용 ────────────────────────────────────────
test('batch — 여러 변경이 리비전 하나로 들어가고, ref 로 부모·연결을 같은 쓰기에서 만든다', async ({ request }) => {
    const before = await revision(request);

    const res = await request.post(`${base()}/batch`, {
        data: {
            ops: [
                { op: 'create-task', ref: 'design', body: { name: '설계', startDate: '2026-01-01', endDate: '2026-01-31' } },
                { op: 'create-task', body: { name: '요구사항', parentId: '@design', startDate: '2026-01-01', endDate: '2026-01-10' } },
                { op: 'create-task', ref: 'dev', body: { name: '개발', startDate: '2026-02-01', endDate: '2026-03-31' } },
                { op: 'update-time-range', taskId: '@dev', rangeId: '@dev:range', body: { dependencies: ['@design:range'] } },
                { op: 'add-milestone', taskId: '@dev', body: { date: '2026-03-31', label: '코드 프리즈', shape: 'flag' } },
            ],
        },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(5);
    expect(body.revision).toBe(before + 1);

    const { tasks } = await (await request.get(`${base()}/tasks`)).json();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].children).toHaveLength(1);

    const { edges } = await (await request.get(`${base()}/dependency-issues`)).json();
    expect(edges).toHaveLength(1);
    expect(edges[0].fromName).toContain('설계');
});

test('batch — 하나가 실패하면 앞선 op 까지 되돌아간다 (리비전도 그대로)', async ({ request }) => {
    const before = await revision(request);

    const res = await request.post(`${base()}/batch`, {
        data: {
            ops: [
                { op: 'create-task', body: { name: '남아서는 안 되는 작업' } },
                { op: 'update-task', taskId: '없는-작업', body: { name: 'x' } },
            ],
        },
    });
    expect(res.status()).toBe(404);

    const { tasks } = await (await request.get(`${base()}/tasks`)).json();
    expect(tasks).toEqual([]);
    expect(await revision(request)).toBe(before);
});

test('batch — 형식 오류는 400, If-Match 불일치는 409', async ({ request }) => {
    expect((await request.post(`${base()}/batch`, { data: { ops: [] } })).status()).toBe(400);
    expect((await request.post(`${base()}/batch`, { data: { ops: [{ op: '없는-연산' }] } })).status()).toBe(400);
    const stale = await request.post(`${base()}/batch`, {
        headers: { 'If-Match': '99999' },
        data: { ops: [{ op: 'create-task', body: { name: 'x' } }] },
    });
    expect(stale.status()).toBe(409);
});

// ── 마일스톤 수정 ────────────────────────────────────
test('마일스톤 PATCH — id 가 유지되므로 그것을 가리키던 연결이 살아남는다', async ({ request }) => {
    const a = await addTask(request, { name: '선행', startDate: '2026-01-01', endDate: '2026-01-10' });
    const b = await addTask(request, { name: '후행', startDate: '2026-02-01', endDate: '2026-02-10' });

    const ms = (await (await request.post(`${base()}/tasks/${a.id}/milestones`, {
        data: { date: '2026-01-10', label: '완료', labelPosition: 'top' },
    })).json()).milestone;
    expect(ms.labelPosition).toBe('top');

    await request.patch(`${base()}/tasks/${b.id}/time-ranges/${b.timeRanges[0].id}`, {
        data: { dependencies: [ms.id] },
    });

    const patched = await request.patch(`${base()}/tasks/${a.id}/milestones/${ms.id}`, {
        data: { date: '2026-01-12', shape: 'flag' },
    });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).milestone).toMatchObject({ id: ms.id, date: '2026-01-12', shape: 'flag' });

    const { edges } = await (await request.get(`${base()}/dependency-issues`)).json();
    expect(edges.map(e => e.fromId)).toEqual([ms.id]);

    // 없는 마일스톤은 404, 빈 수정과 모르는 값은 400
    expect((await request.patch(`${base()}/tasks/${a.id}/milestones/없는-id`, { data: { label: 'x' } })).status()).toBe(404);
    expect((await request.patch(`${base()}/tasks/${a.id}/milestones/${ms.id}`, { data: {} })).status()).toBe(400);
    expect((await request.patch(`${base()}/tasks/${a.id}/milestones/${ms.id}`,
        { data: { labelPosition: '대각선' } })).status()).toBe(400);
});

// ── 캐스케이드 ───────────────────────────────────────
test('cascade=true — 밀린 만큼 후행 전체가 같은 쓰기에서 움직인다 (기본값은 움직이지 않는다)', async ({ request }) => {
    const a = await addTask(request, { name: 'A', startDate: '2026-01-05', endDate: '2026-01-09' });
    const b = await addTask(request, { name: 'B', startDate: '2026-01-12', endDate: '2026-01-16' });
    const c = await addTask(request, { name: 'C', startDate: '2026-01-19', endDate: '2026-01-23' });
    await request.patch(`${base()}/tasks/${b.id}/time-ranges/${b.timeRanges[0].id}`,
        { data: { dependencies: [a.timeRanges[0].id] } });
    await request.patch(`${base()}/tasks/${c.id}/time-ranges/${c.timeRanges[0].id}`,
        { data: { dependencies: [b.timeRanges[0].id] } });

    const rangeOf = async (taskId) => (await (await request.get(`${base()}/tasks/${taskId}`)).json()).task.timeRanges[0];

    // 플래그가 없으면 지정한 기간 하나만 바뀐다
    await request.patch(`${base()}/tasks/${a.id}/time-ranges/${a.timeRanges[0].id}`,
        { data: { endDate: '2026-01-10' } });
    expect((await rangeOf(b.id)).startDate).toBe('2026-01-12');

    const res = await request.patch(
        `${base()}/tasks/${a.id}/time-ranges/${a.timeRanges[0].id}?cascade=true`,
        { data: { endDate: '2026-01-15' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.cascadeDays).toBe(5);
    expect(body.cascaded).toHaveLength(2);

    expect(await rangeOf(b.id)).toMatchObject({ startDate: '2026-01-17', endDate: '2026-01-21' });
    expect((await rangeOf(c.id)).startDate).toBe('2026-01-24');
});

test('workdays=true — cascade 로 옮긴 날짜가 주말에 앉지 않는다', async ({ request }) => {
    const a = await addTask(request, { name: 'A', startDate: '2026-08-24', endDate: '2026-08-25' });
    const b = await addTask(request, { name: 'B', startDate: '2026-08-26', endDate: '2026-08-27' });
    await request.patch(`${base()}/tasks/${b.id}/time-ranges/${b.timeRanges[0].id}`,
        { data: { dependencies: [a.timeRanges[0].id] } });

    // +3일이면 B 는 08-29(토)~08-30(일) 에 착지한다
    const res = await request.patch(
        `${base()}/tasks/${a.id}/time-ranges/${a.timeRanges[0].id}?cascade=true&workdays=true`,
        { data: { endDate: '2026-08-28' } });
    expect(res.status()).toBe(200);

    const range = (await (await request.get(`${base()}/tasks/${b.id}`)).json()).task.timeRanges[0];
    const isWeekend = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    expect(isWeekend(range.startDate), `주말에 착지했다: ${range.startDate}`).toBe(false);
    expect(isWeekend(range.endDate), `주말에 착지했다: ${range.endDate}`).toBe(false);
});

// ── 임계경로 ─────────────────────────────────────────
test('critical-path — 종료를 정하는 가지가 임계이고, 짧은 가지에는 여유가 있다', async ({ request }) => {
    const a = await addTask(request, { name: 'A', startDate: '2026-01-05', endDate: '2026-01-09' });
    const long = await addTask(request, { name: '긴 후행', startDate: '2026-01-12', endDate: '2026-02-10' });
    const short = await addTask(request, { name: '짧은 후행', startDate: '2026-01-12', endDate: '2026-01-16' });
    for (const t of [long, short]) {
        await request.patch(`${base()}/tasks/${t.id}/time-ranges/${t.timeRanges[0].id}`,
            { data: { dependencies: [a.timeRanges[0].id] } });
    }

    const res = await request.get(`${base()}/critical-path`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.projectEnd).toBe('2026-02-10');
    expect(body.criticalIds).toContain(long.timeRanges[0].id);
    expect(body.criticalIds).not.toContain(short.timeRanges[0].id);

    const byId = new Map(body.nodes.map(n => [n.id, n]));
    expect(byId.get(long.timeRanges[0].id).slackDays).toBe(0);
    expect(byId.get(short.timeRanges[0].id).slackDays).toBeGreaterThan(0);
    expect(byId.get(short.timeRanges[0].id).slackWorkdays).toBeGreaterThan(0);
});

test('critical-path — 순환이 있으면 400 (위상 순서가 없다)', async ({ request }) => {
    // 순환은 단건 쓰기가 막으므로 blob 경로로 심는다 — 그 경로는 순환을 검사하지 않는다
    await request.post(`${base()}/data`, {
        data: [
            {
                id: 't1', name: 'A', children: [], milestones: [],
                timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-05', dependencies: ['r2'] }],
            },
            {
                id: 't2', name: 'B', children: [], milestones: [],
                timeRanges: [{ id: 'r2', startDate: '2026-01-06', endDate: '2026-01-10', dependencies: ['r1'] }],
            },
        ],
    });
    expect((await request.get(`${base()}/critical-path`)).status()).toBe(400);
    expect((await (await request.get(`${base()}/dependency-issues`)).json()).cycles).toHaveLength(1);
});

// ── 텍스트 렌더 ──────────────────────────────────────
test('chart — JSON 과 text/plain 두 형태로 나오고, 작업 이름과 막대가 들어 있다', async ({ request }) => {
    await addTask(request, { name: '설계', startDate: '2026-01-05', endDate: '2026-01-30' });
    await addTask(request, { name: '개발', startDate: '2026-02-02', endDate: '2026-03-20' });

    const json = await request.get(`${base()}/chart`);
    expect(json.status()).toBe(200);
    const body = await json.json();
    expect(body.ok).toBe(true);
    expect(body.chart).toContain('설계');
    expect(body.chart).toContain('#');

    const text = await request.get(`${base()}/chart?format=text&width=60`);
    expect(text.headers()['content-type']).toContain('text/plain');
    const drawn = await text.text();
    expect(drawn).toContain('개발');
    // width 를 지켰는지 — 가장 긴 줄이 상한을 넘지 않아야 한다
    expect(Math.max(...drawn.split('\n').map(l => l.length))).toBeLessThanOrEqual(60 + 30);

    // 범위를 벗어난 폭은 거절이 아니라 상한으로 잘린다 (쿼리에는 무엇이든 온다)
    expect((await request.get(`${base()}/chart?width=99999`)).status()).toBe(200);
    expect((await request.get(`${base()}/chart?width=abc`)).status()).toBe(200);
});

// ── 전역 설정 ────────────────────────────────────────
test('settings — 보낸 키만 병합되고, 구조가 아닌 값은 400', async ({ request }) => {
    const key = `e2eProbe${Date.now() % 100000}`;
    expect((await request.post('/api/settings', { data: { [key]: 'first' } })).status()).toBe(200);

    // 다른 키만 담아 보내도 앞의 키는 남아야 한다 — 예전에는 통짜 덮어쓰기였다
    const merged = await request.post('/api/settings', { data: { [`${key}b`]: 'second' } });
    expect(merged.status()).toBe(200);
    const data = (await merged.json()).data;
    expect(data[key]).toBe('first');
    expect(data[`${key}b`]).toBe('second');

    expect((await request.post('/api/settings', { data: { nested: { a: 1 } } })).status()).toBe(400);
    expect((await request.post('/api/settings', { data: { 'bad key': 1 } })).status()).toBe(400);
    expect((await request.post('/api/settings', { data: [] })).status()).toBe(400);
});
