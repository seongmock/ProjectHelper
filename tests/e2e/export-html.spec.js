// 내보낸 HTML 을 **실제로 브라우저에 띄워** 확인한다.
//
// 단위 테스트는 심어진 소스가 앱 모듈과 같은 답을 내는지까지 본다(htmlExporter.test.js).
// 그런데 내보내기는 문자열을 조립해 스크립트를 만드는 일이라, 조립 자체가 어긋나면
// **문서는 멀쩡해 보이면서 아무것도 그리지 않는다** — 그 상태를 잡으려면 띄워 봐야 한다.
// 여기서 보는 것은 두 가지다: 의존성 문제가 색·선 모양으로 구분되는가, 작업명 열의
// 배지가 연결의 존재를 말하는가. 둘 다 예전 내보내기에는 아예 없었다(회색 점선 하나).
import { test, expect } from '@playwright/test';

// A → B 는 일정 위반(후행이 선행 종료 전에 시작), C ↔ D 는 순환.
const TREE = [
    { id: 'A', name: '선행 작업', color: '#4A90E2', children: [], milestones: [], expanded: true,
        timeRanges: [{ id: 'ra', startDate: '2026-01-01', endDate: '2026-01-31', dependencies: [] }] },
    { id: 'B', name: '후행 작업', color: '#4A90E2', children: [], milestones: [], expanded: true,
        timeRanges: [{ id: 'rb', startDate: '2026-01-15', endDate: '2026-02-28', dependencies: ['ra'] }] },
    { id: 'C', name: '고리 하나', color: '#4A90E2', children: [], milestones: [], expanded: true,
        timeRanges: [{ id: 'rc', startDate: '2026-03-01', endDate: '2026-03-10', dependencies: ['rd'] }] },
    { id: 'D', name: '고리 둘', color: '#4A90E2', children: [], milestones: [], expanded: true,
        timeRanges: [{ id: 'rd', startDate: '2026-03-05', endDate: '2026-03-20', dependencies: ['rc'] }] },
];

// 내보내기 모듈은 `?raw` 임포트를 쓰므로 Vite 를 거쳐야 한다 — dev 서버 페이지 안에서 부른다.
const renderExport = async (page, tree) => {
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    return page.evaluate(async (data) => {
        const mod = await import('/src/features/io/htmlExporter.js');
        return mod.exportToHtml(data, { zoomLevel: 1, timeScale: 'monthly' });
    }, tree);
};

test('내보낸 HTML 이 의존성 문제를 색과 모양으로 구분해 그린다', async ({ page, context }) => {
    const html = await renderExport(page, TREE);

    const doc = await context.newPage();
    // 컨테이너가 height:100% 라 바깥에 크기를 줘야 행이 그려진다(컨플루언스 매크로와 같은 조건)
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);
    const lines = doc.locator('.dependency-line');
    await expect(lines).toHaveCount(3, { timeout: 5000 }); // 위반 1 + 순환 2

    const drawn = await lines.evaluateAll(els => els.map(el => ({
        issue: el.getAttribute('data-issue'),
        stroke: getComputedStyle(el).stroke,
        dash: getComputedStyle(el).strokeDasharray,
        marker: getComputedStyle(el).markerEnd,
        title: el.querySelector('title')?.textContent || '',
    })));

    const overlap = drawn.find(d => d.issue === 'overlap');
    const cycle = drawn.find(d => d.issue === 'cycle');
    expect(overlap).toBeTruthy();
    expect(cycle).toBeTruthy();
    // 색만으로 구분하지 않는다 — 순환은 실선, 위반은 파선이고 설명이 붙는다.
    expect(cycle.stroke).toBe('rgb(220, 38, 38)');
    expect(cycle.dash === 'none' || cycle.dash === '').toBe(true);
    expect(overlap.stroke).toBe('rgb(245, 158, 11)');
    expect(overlap.dash).not.toBe('none');
    expect(cycle.title).toContain('순환');
    expect(overlap.title).toContain('일정 위반');
    // 화살촉은 marker 라 stroke 를 물려받지 못한다 — 선마다 자기 색의 것을 가리켜야 한다.
    expect(cycle.marker).not.toBe(overlap.marker);
    for (const d of drawn) expect(d.marker).not.toBe('none');
});

test('내보낸 HTML 의 작업명 열이 연결의 존재를 말한다', async ({ page, context }) => {
    const html = await renderExport(page, TREE);
    const doc = await context.newPage();
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);

    const badges = doc.locator('.ph-dep-badge');
    await expect(badges).toHaveCount(4); // 네 작업 모두 한쪽 이상 연결돼 있다
    // 선행 작업 A 에는 후행만, 후행 작업 B 에는 선행만 선다.
    const rowOf = (name) => doc.locator('.task-item', { hasText: name }).locator('.ph-dep-badge');
    await expect(rowOf('선행 작업')).toHaveText(/→1/);
    await expect(rowOf('후행 작업')).toHaveText(/←1/);
    // 문제는 배지에도 나타난다 — 표와 같은 우선순위(순환 > 위반 > 끊어진 참조).
    await expect(rowOf('고리 하나')).toHaveClass(/ph-dep-cycle/);
    await expect(rowOf('후행 작업')).toHaveClass(/ph-dep-overlap/);
    // 툴팁은 상대의 **이름**을 싣는다 — 이름이 없으면 인스펙터 없이는 알 방법이 없다.
    await expect(rowOf('후행 작업')).toHaveAttribute('title', /선행 작업/);
});

test('연결이 없으면 배지도 없다 — 빈 표시로 잡음을 만들지 않는다', async ({ page, context }) => {
    const html = await renderExport(page, [TREE[0]]);
    const doc = await context.newPage();
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);
    await expect(doc.locator('.task-item')).toHaveCount(1);
    await expect(doc.locator('.ph-dep-badge')).toHaveCount(0);
});
