#!/usr/bin/env node
// ProjectHelper 로드맵을 앱 데이터로 주입하는 셀프 데모 스크립트.
// 사용법: node scripts/seed-roadmap.mjs  (API 서버 :3000 실행 중이어야 함)
//
// - 현재 데이터를 "Backup before roadmap" 스냅샷으로 백업
// - ROADMAP.md의 내용을 작업 트리로 구성해 주입 (진행률/지연/마일스톤 시연 포함)
// - "ProjectHelper Roadmap" 스냅샷으로도 저장 (언제든 복원 가능)
const BASE = process.env.PH_API_BASE || 'http://localhost:3000/api';

const api = async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.error}`);
    return json;
};

let seq = 0;
const id = () => `task-${Date.now()}-rm${(seq++).toString(36)}`;

const range = (startDate, endDate, label = '') => ({
    id: id(), startDate, endDate, dependencies: [], color: null, label,
});

const task = (name, { start, end, color, progress = 0, description = '', children = [], milestones = [], labels = [] } = {}) => ({
    id: id(),
    name,
    timeRanges: start && end ? [range(start, end)] : [],
    color: color || '#4A90E2',
    description,
    progress,
    children,
    expanded: true,
    labels,
    parentId: null,
    milestones: milestones.map(m => ({ id: id(), shape: 'diamond', color: '#FFD166', ...m })),
    dependencies: [],
    divider: { enabled: false, thickness: 2, style: 'solid', color: '#000000' },
});

const roadmap = [
    task('v1.0 기반 다지기', {
        start: '2026-07-14', end: '2026-07-20', color: '#2E9E5B', progress: 100,
        description: '리팩토링 + AI 연동 + E2E 검증 체계',
        milestones: [{ date: '2026-07-20', label: 'v1.0 완료', color: '#2E9E5B' }],
        children: [
            task('동작 보존 리팩토링', { start: '2026-07-14', end: '2026-07-17', color: '#5CB85C', progress: 100 }),
            task('AI 연동 (REST/OpenAPI/MCP)', { start: '2026-07-16', end: '2026-07-19', color: '#5CB85C', progress: 100 }),
            task('E2E 테스트 16개 + 문서/스킬', { start: '2026-07-18', end: '2026-07-20', color: '#5CB85C', progress: 100 }),
        ],
    }),
    task('v1.1 품질·데모·핵심 기능', {
        start: '2026-07-21', end: '2026-07-31', color: '#4A90E2', progress: 80,
        description: '진행률/지연 표시, 날짜 동기화, undo 정합성, CI, 셀프 데모',
        milestones: [{ date: '2026-07-31', label: 'v1.1 릴리스', color: '#4A90E2' }],
        children: [
            task('진행률(%) + 지연 하이라이트', { start: '2026-07-21', end: '2026-07-24', progress: 100, color: '#6FA8DC' }),
            task('표↔타임라인 날짜 동기화 + undo 정합성', { start: '2026-07-21', end: '2026-07-23', progress: 100, color: '#6FA8DC' }),
            task('CI + README + 셀프 로드맵 데모', { start: '2026-07-23', end: '2026-07-28', progress: 60, color: '#6FA8DC' }),
            task('안정화 및 회귀 테스트', { start: '2026-07-28', end: '2026-07-31', progress: 0, color: '#6FA8DC' }),
        ],
    }),
    task('v1.2 뷰 · 필터', {
        start: '2026-08-03', end: '2026-08-21', color: '#7B68EE', progress: 0,
        description: '라벨 필터, 정렬, 주별 스케일, 마일스톤 렌더 통일',
        children: [
            task('라벨 필터 + 정렬 옵션', { start: '2026-08-03', end: '2026-08-11', color: '#9B8AF0' }),
            task('주별 타임스케일 + 마일스톤 도형 통일', { start: '2026-08-10', end: '2026-08-21', color: '#9B8AF0' }),
        ],
    }),
    task('v1.3 내보내기 · 공유', {
        start: '2026-08-24', end: '2026-09-11', color: '#F0AD4E', progress: 0,
        description: 'PNG/PDF 내보내기, 읽기전용 공유 링크',
        children: [
            task('PNG/PDF 파일 내보내기', { start: '2026-08-24', end: '2026-09-02', color: '#F3C06E' }),
            task('읽기전용 공유 링크 (/share/:id)', { start: '2026-08-31', end: '2026-09-11', color: '#F3C06E' }),
        ],
    }),
    task('v2.0 확장', {
        start: '2026-09-14', end: '2026-10-30', color: '#D9534F', progress: 0,
        description: '다중 프로젝트, 임계 경로, AI 일정 생성 통합, 실시간 협업(SSE)',
        milestones: [{ date: '2026-10-30', label: 'v2.0 목표', color: '#D9534F' }],
        children: [
            task('다중 프로젝트(워크스페이스)', { start: '2026-09-14', end: '2026-09-30', color: '#E0837F' }),
            task('임계 경로(critical path) 강조', { start: '2026-09-28', end: '2026-10-09', color: '#E0837F' }),
            task('AI 일정 생성 통합 (MCP 연쇄 호출)', { start: '2026-10-05', end: '2026-10-21', color: '#E0837F' }),
            task('실시간 협업 (SSE 전환)', { start: '2026-10-19', end: '2026-10-30', color: '#E0837F' }),
        ],
    }),
];

const main = async () => {
    // 1. 기존 데이터 백업
    const { data: current } = await api('/data');
    if (current && current.length > 0) {
        await api('/snapshots', 'POST', { name: 'Backup before roadmap', data: current });
        console.log('✔ 기존 데이터를 "Backup before roadmap" 스냅샷으로 백업');
    }

    // 2. 로드맵 주입
    const res = await api('/data', 'POST', roadmap);
    console.log(`✔ 로드맵 주입 완료 (revision ${res.revision}, 최상위 ${roadmap.length}개 버전)`);

    // 3. 로드맵 스냅샷 저장 (복원용)
    await api('/snapshots', 'POST', { name: 'ProjectHelper Roadmap', data: roadmap });
    console.log('✔ "ProjectHelper Roadmap" 스냅샷 저장 — 저장/불러오기 모달에서 언제든 복원 가능');
    console.log('\n앱을 열면 (분기별 뷰 권장) 로드맵이 간트 차트로 표시됩니다.');
};

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
