#!/usr/bin/env node
// ProjectHelper MCP 서버 — REST API(server/)를 도구로 노출하는 얇은 stdio 래퍼.
// 검증/리비전 로직은 전부 REST 레이어에 있음. 이 파일은 HTTP 호출만 담당.
//
// 환경변수:
//   PH_API_BASE   — API 베이스 URL (기본 http://localhost:3000/api)
//   PH_BASIC_AUTH — "user:pass" (Caddy HTTPS 프록시 경유 시에만 필요)
//   PH_API_TOKEN  — 서비스 토큰. 서버에 계정이 있으면(enforced) 이게 없으면 401 이다.
//                   서버 쪽 PH_API_TOKENS 의 `이름:역할:토큰` 중 토큰 부분을 넣는다 —
//                   감사 로그에는 그 이름이 남으므로 사람 계정을 빌려 쓰지 않는다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.PH_API_BASE || 'http://localhost:3000/api';
const BASIC_AUTH = process.env.PH_BASIC_AUTH || '';
const API_TOKEN = process.env.PH_API_TOKEN || '';

const api = async (path, { method = 'GET', body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    // 둘 다 Authorization 을 쓴다. 서비스 토큰이 앱의 신원이고 basicauth 는 프록시 통과용이라
    // 동시에 필요하면 토큰을 우선한다 — 앱이 401 을 내면 프록시를 통과해도 소용없다.
    if (BASIC_AUTH) headers.Authorization = 'Basic ' + Buffer.from(BASIC_AUTH).toString('base64');
    if (API_TOKEN) headers.Authorization = 'Bearer ' + API_TOKEN;

    const res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(json.error || `API ${path} failed: ${res.status}`);
    return json;
};

// 도구 결과 포맷 헬퍼
const jsonResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const run = (fn) => async (args) => {
    try {
        return jsonResult(await fn(args));
    } catch (e) {
        return { content: [{ type: 'text', text: `오류: ${e.message}` }], isError: true };
    }
};

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식');
const SHAPES = ['diamond', 'circle', 'triangle', 'square', 'star', 'flag'];
const LABEL_POSITIONS = ['auto', 'top', 'bottom', 'left', 'right'];

// 프로젝트 스코프: projectId 생략 시 legacy 별칭(= default 프로젝트)으로 동작
const PROJECT = z.string().optional().describe('프로젝트 ID (생략 시 default 프로젝트)');
const pp = (projectId) => (projectId ? `/projects/${projectId}` : '');

const server = new McpServer({ name: 'project-helper', version: '1.0.0' });

server.tool(
    'get-guide',
    '이 API의 사용 가이드(데이터 모델, 형식, 일정 계획 작성 워크플로우, 동시성 규약)를 반환. 처음 사용할 때 먼저 호출 권장.',
    {},
    run(() => api('/guide'))
);

server.tool(
    'list-projects',
    '프로젝트 목록 조회. 각 프로젝트는 독립된 작업 트리/리비전을 가진다.',
    {},
    run(() => api('/projects'))
);

server.tool(
    'create-project',
    '새 프로젝트 생성 — 새 일정 계획은 기존 데이터와 격리된 새 프로젝트에 작성하는 것을 권장. 반환된 project.id를 이후 도구들의 projectId로 사용.',
    { name: z.string() },
    run(({ name }) => api('/projects', { method: 'POST', body: { name } }))
);

server.tool(
    'list-tasks',
    '모든 작업 목록 조회. flat=true(기본)면 핵심 필드만 추린 평탄 목록(의존성 포함) — 작업/기간 ID를 찾을 때 사용. flat=false면 서버가 저장한 트리를 **손대지 않고** 그대로 반환한다(색상·설명·divider 등 전부).',
    { flat: z.boolean().default(true).describe('평탄 목록 여부 (false면 가공 없는 재귀 트리 전체)'), projectId: PROJECT },
    run(async ({ flat, projectId }) => {
        const res = await api(`${pp(projectId)}/tasks${flat ? '?flat=true' : ''}`);
        if (!flat) return res;
        // 평탄 목록은 핵심 필드만 추려 토큰 절약.
        // dependencies 는 여기에 **반드시** 있어야 한다: 이것이 없던 동안 에이전트는
        // 화살표가 이미 걸려 있는지 모른 채 일정을 옮겼고, 중복 연결과 순환을 만들었다.
        return {
            revision: res.revision,
            tasks: res.tasks.map(t => ({
                id: t.id,
                name: t.name,
                level: t.level,
                parentId: t.parentId,
                startDate: t.startDate,
                endDate: t.endDate,
                progress: t.progress,
                dependencies: t.dependencies || [],
                timeRanges: (t.timeRanges || []).map(r => ({
                    id: r.id, startDate: r.startDate, endDate: r.endDate, label: r.label,
                    dependencies: r.dependencies || [],
                })),
                milestones: (t.milestones || []).map(m => ({
                    id: m.id, date: m.date, label: m.label, shape: m.shape,
                    labelPosition: m.labelPosition, dependencies: m.dependencies || [],
                })),
            })),
        };
    })
);

server.tool(
    'get-task',
    '작업 단건 상세 조회 (timeRanges/milestones/children 포함).',
    { taskId: z.string(), projectId: PROJECT },
    run(({ taskId, projectId }) => api(`${pp(projectId)}/tasks/${taskId}`))
);

server.tool(
    'add-task',
    '새 작업 생성. parentId로 하위 작업 생성 가능. startDate/endDate를 함께 주면 해당 기간의 바가 생성됨 (생략 시 오늘부터 30일).',
    {
        name: z.string(),
        parentId: z.string().optional().describe('부모 작업 ID (생략 시 최상위)'),
        position: z.number().int().optional().describe('형제 내 삽입 위치 (생략 시 맨 뒤)'),
        startDate: DATE.optional(),
        endDate: DATE.optional(),
        color: z.string().optional().describe('#RRGGBB'),
        description: z.string().optional(),
        projectId: PROJECT,
    },
    run(({ projectId, ...body }) => api(`${pp(projectId)}/tasks`, { method: 'POST', body }))
);

server.tool(
    'update-task',
    '작업 이름/색상/설명/라벨/진행률 수정. 날짜 변경은 reschedule 도구 사용.',
    {
        taskId: z.string(),
        name: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
        labels: z.array(z.string()).optional(),
        progress: z.number().int().min(0).max(100).optional().describe('진행률 % (0-100)'),
        projectId: PROJECT,
    },
    run(({ taskId, projectId, ...body }) => api(`${pp(projectId)}/tasks/${taskId}`, { method: 'PATCH', body }))
);

server.tool(
    'delete-task',
    '작업 삭제 (하위 작업 전체 포함 — 되돌릴 수 없으므로 대량 삭제 전 create-snapshot 권장).',
    { taskId: z.string(), projectId: PROJECT },
    run(({ taskId, projectId }) => api(`${pp(projectId)}/tasks/${taskId}`, { method: 'DELETE' }))
);

server.tool(
    'move-task',
    '작업을 다른 부모 아래로 이동하거나 순서 변경. parentId=null이면 최상위로.',
    {
        taskId: z.string(),
        parentId: z.string().nullable().describe('새 부모 ID, null이면 루트 레벨'),
        position: z.number().int().optional(),
        projectId: PROJECT,
    },
    run(({ taskId, projectId, ...body }) => api(`${pp(projectId)}/tasks/${taskId}/move`, { method: 'POST', body }))
);

server.tool(
    'reschedule',
    '작업 기간(바)의 날짜 변경. startDate/endDate 직접 지정 또는 shiftDays로 통째로 밀기. rangeId 생략 시 첫 번째 기간.',
    {
        taskId: z.string(),
        rangeId: z.string().optional().describe('기간 ID (생략 시 첫 번째 기간)'),
        startDate: DATE.optional(),
        endDate: DATE.optional(),
        shiftDays: z.number().int().optional().describe('기존 날짜에서 며칠 이동 (음수 = 앞당김)'),
        cascade: z.boolean().optional().describe('종료일이 뒤로 밀린 만큼 후행(전이적 포함) 전체를 같은 쓰기에서 민다. 앞당김은 전파하지 않는다.'),
        workdays: z.boolean().optional().describe('cascade 로 옮긴 날짜가 주말이면 다음 평일로 (공휴일은 모른다)'),
        projectId: PROJECT,
    },
    run(async ({ taskId, rangeId, startDate, endDate, shiftDays, cascade, workdays, projectId }) => {
        const { task } = await api(`${pp(projectId)}/tasks/${taskId}`);
        const ranges = task.timeRanges || [];
        if (ranges.length === 0) throw new Error('이 작업에는 기간(timeRange)이 없습니다. add-time-range를 사용하세요.');
        const target = rangeId ? ranges.find(r => r.id === rangeId) : ranges[0];
        if (!target) throw new Error(`기간을 찾을 수 없음: ${rangeId}`);

        let body;
        if (shiftDays !== undefined) {
            const shift = (d) => {
                const dt = new Date(d);
                dt.setDate(dt.getDate() + shiftDays);
                return dt.toISOString().split('T')[0];
            };
            body = { startDate: shift(target.startDate), endDate: shift(target.endDate) };
        } else {
            body = {};
            if (startDate) body.startDate = startDate;
            if (endDate) body.endDate = endDate;
            if (Object.keys(body).length === 0) throw new Error('startDate/endDate 또는 shiftDays를 지정하세요.');
        }
        const q = [cascade ? 'cascade=true' : '', workdays ? 'workdays=true' : ''].filter(Boolean).join('&');
        return api(`${pp(projectId)}/tasks/${taskId}/time-ranges/${target.id}${q ? `?${q}` : ''}`,
            { method: 'PATCH', body });
    })
);

server.tool(
    'add-time-range',
    '작업에 기간(바) 추가 — 한 작업이 여러 구간을 가질 수 있음.',
    {
        taskId: z.string(),
        startDate: DATE,
        endDate: DATE,
        label: z.string().optional(),
        color: z.string().optional(),
        projectId: PROJECT,
    },
    run(({ taskId, projectId, ...body }) => api(`${pp(projectId)}/tasks/${taskId}/time-ranges`, { method: 'POST', body }))
);

server.tool(
    'delete-time-range',
    '작업의 기간(바) 삭제.',
    { taskId: z.string(), rangeId: z.string(), projectId: PROJECT },
    run(({ taskId, rangeId, projectId }) => api(`${pp(projectId)}/tasks/${taskId}/time-ranges/${rangeId}`, { method: 'DELETE' }))
);

server.tool(
    'add-milestone',
    '작업에 마일스톤 마커 추가.',
    {
        taskId: z.string(),
        date: DATE,
        label: z.string().optional(),
        shape: z.enum(SHAPES).optional().describe('기본 diamond'),
        color: z.string().optional(),
        labelPosition: z.enum(LABEL_POSITIONS).optional().describe('기본 auto — auto 는 서로 겹치지 않게 자동 배치된다'),
        dependencies: z.array(z.string()).optional().describe('이 마일스톤의 선행 항목 id (기간 id / 마일스톤 id)'),
        projectId: PROJECT,
    },
    run(({ taskId, projectId, ...body }) => api(`${pp(projectId)}/tasks/${taskId}/milestones`, { method: 'POST', body }))
);

server.tool(
    'update-milestone',
    '마일스톤 수정 (날짜/라벨/도형/색/라벨위치/의존성). **삭제 후 재생성으로 대신하지 마라** — 그러면 id 가 바뀌고, 이 마일스톤을 가리키던 연결이 함께 사라진다.',
    {
        taskId: z.string(),
        milestoneId: z.string(),
        date: DATE.optional(),
        label: z.string().optional(),
        shape: z.enum(SHAPES).optional(),
        color: z.string().optional(),
        labelPosition: z.enum(LABEL_POSITIONS).optional(),
        dependencies: z.array(z.string()).optional(),
        projectId: PROJECT,
    },
    run(({ taskId, milestoneId, projectId, ...body }) =>
        api(`${pp(projectId)}/tasks/${taskId}/milestones/${milestoneId}`, { method: 'PATCH', body }))
);

server.tool(
    'delete-milestone',
    '작업의 마일스톤 삭제.',
    { taskId: z.string(), milestoneId: z.string(), projectId: PROJECT },
    run(({ taskId, milestoneId, projectId }) => api(`${pp(projectId)}/tasks/${taskId}/milestones/${milestoneId}`, { method: 'DELETE' }))
);

server.tool(
    'check-dependencies',
    '의존성 그래프 + 정합성 점검 — edges(연결 전체: fromId/fromName/toId/toName), 순환(cycles), 일정 위반(overlaps: 후행이 선행 종료보다 먼저 시작), 끊어진 참조(dangling: 삭제된 상대를 가리킴)를 반환. 연결을 걸기 **전에** 이것으로 현재 그래프를 읽어라.',
    { projectId: PROJECT },
    run(({ projectId }) => api(`${pp(projectId)}/dependency-issues`))
);

server.tool(
    'set-dependencies',
    '기간(바) 또는 마일스톤의 선행 목록을 **교체**한다 (추가가 아니다 — 기존 목록을 먼저 읽어서 합쳐 넣어라). 순환이 되거나 없는 id 를 가리키면 400 으로 거절된다.',
    {
        taskId: z.string(),
        rangeId: z.string().optional().describe('기간 id — milestoneId 와 둘 중 하나'),
        milestoneId: z.string().optional(),
        dependencies: z.array(z.string()).describe('선행 항목 id 목록. 빈 배열이면 연결을 모두 끊는다.'),
        projectId: PROJECT,
    },
    run(({ taskId, rangeId, milestoneId, dependencies, projectId }) => {
        if (!rangeId === !milestoneId) throw new Error('rangeId 또는 milestoneId 중 정확히 하나를 지정하세요.');
        const path = rangeId
            ? `${pp(projectId)}/tasks/${taskId}/time-ranges/${rangeId}`
            : `${pp(projectId)}/tasks/${taskId}/milestones/${milestoneId}`;
        return api(path, { method: 'PATCH', body: { dependencies } });
    })
);

server.tool(
    'critical-path',
    '임계경로와 여유(slack) 계산. 각 항목의 slackDays/slackWorkdays 와 criticalIds(여유 0 = 이것이 늦으면 프로젝트 종료가 밀린다)를 반환. 날짜는 이미 사람이 정한 값이므로 앞당기지 않고, 늦출 수 있는 여유만 판정한다. 순환이 있으면 400 — check-dependencies 로 먼저 고쳐라.',
    { projectId: PROJECT },
    run(({ projectId }) => api(`${pp(projectId)}/critical-path`))
);

server.tool(
    'render-chart',
    '현재 일정을 텍스트 간트로 그려서 반환 — **자기가 쓴 결과를 눈으로 확인하는 수단이다**. 대량 편집 뒤에 한 번 호출해서 막대가 의도한 자리에 있는지 보라.',
    {
        width: z.number().int().min(40).max(400).optional().describe('차트 폭(문자, 기본 100)'),
        from: DATE.optional().describe('이 날짜부터만 (생략 시 전체)'),
        to: DATE.optional(),
        maxRows: z.number().int().min(1).max(1000).optional().describe('그릴 작업 수 상한 (기본 200)'),
        projectId: PROJECT,
    },
    run(({ projectId, ...q }) => {
        const qs = Object.entries(q).filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        return api(`${pp(projectId)}/chart${qs ? `?${qs}` : ''}`);
    })
);

server.tool(
    'batch',
    '여러 변경을 **한 번의 쓰기**로 적용 — 리비전 하나, 감사 한 줄, 하나가 실패하면 전부 되돌린다(중간 상태가 남지 않는다). 계획 전체를 새로 그릴 때는 도구를 반복 호출하지 말고 이것을 써라.\n'
    + 'ops 각 항목: { op, ref?, taskId?, rangeId?, milestoneId?, body? }. op 은 '
    + 'create-task | update-task | delete-task | move-task | add-time-range | update-time-range | '
    + 'delete-time-range | add-milestone | update-milestone | delete-milestone.\n'
    + 'ref: 이 op 이 만든 것을 뒤에서 가리킬 이름. 뒤의 op 에서 "@이름"(작업 id) / "@이름:range"(그 작업의 첫 기간 id)로 쓴다 — 부모-자식 트리와 연결을 한 번에 만들 수 있다.\n'
    + '예: [{op:"create-task",ref:"a",body:{name:"설계",startDate:"2026-01-01",endDate:"2026-01-31"}},'
    + '{op:"create-task",body:{name:"요구사항",parentId:"@a",startDate:"2026-01-01",endDate:"2026-01-10"}}]',
    {
        ops: z.array(z.object({
            op: z.string(),
            ref: z.string().optional(),
            taskId: z.string().optional(),
            rangeId: z.string().optional(),
            milestoneId: z.string().optional(),
            body: z.record(z.any()).optional(),
        })).min(1).max(200),
        projectId: PROJECT,
    },
    run(({ ops, projectId }) => api(`${pp(projectId)}/batch`, { method: 'POST', body: { ops } }))
);

server.tool(
    'create-snapshot',
    '현재 전체 일정의 이름 지정 백업 생성 — 대량 편집/삭제 전 안전망으로 사용.',
    { name: z.string(), projectId: PROJECT },
    run(async ({ name, projectId }) => {
        const { data } = await api(`${pp(projectId)}/data`);
        const res = await api(`${pp(projectId)}/snapshots`, { method: 'POST', body: { name, data: data || [] } });
        return { ok: true, snapshot: { id: res.snapshot.id, name: res.snapshot.name, date: res.snapshot.date } };
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('project-helper MCP server running (API: ' + API_BASE + ')');
