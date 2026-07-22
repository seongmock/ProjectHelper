#!/usr/bin/env node
// ProjectHelper MCP 서버 — REST API(server/)를 도구로 노출하는 얇은 stdio 래퍼.
// 검증/리비전 로직은 전부 REST 레이어에 있음. 이 파일은 HTTP 호출만 담당.
//
// 환경변수:
//   PH_API_BASE   — API 베이스 URL (기본 http://localhost:3000/api)
//   PH_BASIC_AUTH — "user:pass" (Caddy HTTPS 프록시 경유 시에만 필요)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.PH_API_BASE || 'http://localhost:3000/api';
const BASIC_AUTH = process.env.PH_BASIC_AUTH || '';

const api = async (path, { method = 'GET', body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (BASIC_AUTH) headers.Authorization = 'Basic ' + Buffer.from(BASIC_AUTH).toString('base64');

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

const server = new McpServer({ name: 'project-helper', version: '1.0.0' });

server.tool(
    'get-guide',
    '이 API의 사용 가이드(데이터 모델, 형식, 일정 계획 작성 워크플로우, 동시성 규약)를 반환. 처음 사용할 때 먼저 호출 권장.',
    {},
    run(() => api('/guide'))
);

server.tool(
    'list-tasks',
    '모든 작업 목록 조회. flat=true(기본)면 id/name/level/parentId/timeRanges가 붙은 평탄 목록 — 작업 ID를 찾을 때 사용.',
    { flat: z.boolean().default(true).describe('평탄 목록 여부 (false면 재귀 트리)') },
    run(async ({ flat }) => {
        const res = await api(`/tasks${flat ? '?flat=true' : ''}`);
        if (!flat) return res;
        // 평탄 목록은 핵심 필드만 추려 토큰 절약
        return {
            revision: res.revision,
            tasks: res.tasks.map(t => ({
                id: t.id,
                name: t.name,
                level: t.level,
                parentId: t.parentId,
                startDate: t.startDate,
                endDate: t.endDate,
                timeRanges: (t.timeRanges || []).map(r => ({ id: r.id, startDate: r.startDate, endDate: r.endDate, label: r.label })),
                milestones: (t.milestones || []).map(m => ({ id: m.id, date: m.date, label: m.label })),
            })),
        };
    })
);

server.tool(
    'get-task',
    '작업 단건 상세 조회 (timeRanges/milestones/children 포함).',
    { taskId: z.string() },
    run(({ taskId }) => api(`/tasks/${taskId}`))
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
    },
    run((args) => api('/tasks', { method: 'POST', body: args }))
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
    },
    run(({ taskId, ...body }) => api(`/tasks/${taskId}`, { method: 'PATCH', body }))
);

server.tool(
    'delete-task',
    '작업 삭제 (하위 작업 전체 포함 — 되돌릴 수 없으므로 대량 삭제 전 create-snapshot 권장).',
    { taskId: z.string() },
    run(({ taskId }) => api(`/tasks/${taskId}`, { method: 'DELETE' }))
);

server.tool(
    'move-task',
    '작업을 다른 부모 아래로 이동하거나 순서 변경. parentId=null이면 최상위로.',
    {
        taskId: z.string(),
        parentId: z.string().nullable().describe('새 부모 ID, null이면 루트 레벨'),
        position: z.number().int().optional(),
    },
    run(({ taskId, ...body }) => api(`/tasks/${taskId}/move`, { method: 'POST', body }))
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
    },
    run(async ({ taskId, rangeId, startDate, endDate, shiftDays }) => {
        const { task } = await api(`/tasks/${taskId}`);
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
        return api(`/tasks/${taskId}/time-ranges/${target.id}`, { method: 'PATCH', body });
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
    },
    run(({ taskId, ...body }) => api(`/tasks/${taskId}/time-ranges`, { method: 'POST', body }))
);

server.tool(
    'delete-time-range',
    '작업의 기간(바) 삭제.',
    { taskId: z.string(), rangeId: z.string() },
    run(({ taskId, rangeId }) => api(`/tasks/${taskId}/time-ranges/${rangeId}`, { method: 'DELETE' }))
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
    },
    run(({ taskId, ...body }) => api(`/tasks/${taskId}/milestones`, { method: 'POST', body }))
);

server.tool(
    'delete-milestone',
    '작업의 마일스톤 삭제.',
    { taskId: z.string(), milestoneId: z.string() },
    run(({ taskId, milestoneId }) => api(`/tasks/${taskId}/milestones/${milestoneId}`, { method: 'DELETE' }))
);

server.tool(
    'create-snapshot',
    '현재 전체 일정의 이름 지정 백업 생성 — 대량 편집/삭제 전 안전망으로 사용.',
    { name: z.string() },
    run(async ({ name }) => {
        const { data } = await api('/data');
        const res = await api('/snapshots', { method: 'POST', body: { name, data: data || [] } });
        return { ok: true, snapshot: { id: res.snapshot.id, name: res.snapshot.name, date: res.snapshot.date } };
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('project-helper MCP server running (API: ' + API_BASE + ')');
