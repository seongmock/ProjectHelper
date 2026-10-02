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

// 내보낸 문서에도 같은 규칙이 필요하다: 라벨은 층으로 겹침을 피하므로 첫 행 위에 비워 둘
// 여백이 층수를 따라야 하고, 그 여백만큼 작업명 열도 내려가야 이름이 자기 막대 옆에 온다.
// 상수 두 개(막대 52px, 이름 24px)로 나뉘어 있던 동안 **이름은 자기 막대보다 28px 위**에
// 있었고, 라벨 다섯 개가 겹치면 2층이 컨테이너 위로 잘렸다.
test('내보낸 HTML 의 작업명이 자기 막대와 같은 높이에 있고, 겹친 라벨이 잘리지 않는다', async ({ page, context }) => {
    const stacked = [{
        id: 'S', name: '층 쌓기', color: '#4A90E2', children: [], expanded: true,
        timeRanges: [{ id: 'rs', startDate: '2026-01-01', endDate: '2026-01-31', dependencies: [] }],
        milestones: Array.from({ length: 5 }, (_, i) => ({
            id: `sm${i}`, date: '2026-01-10', label: `겹치는 라벨 ${i}`, color: '#e74c3c', shape: 'diamond',
        })),
    }, {
        id: 'T', name: '둘째 행', color: '#4A90E2', children: [], expanded: true, milestones: [],
        timeRanges: [{ id: 'rt', startDate: '2026-02-01', endDate: '2026-02-20', dependencies: [] }],
    }];
    const html = await renderExport(page, stacked);
    const doc = await context.newPage();
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);
    await expect(doc.locator('.milestone-label')).toHaveCount(5, { timeout: 5000 });

    const m = await doc.evaluate(() => {
        const mid = (el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
        const content = document.querySelector('[class*="qs-content-"]');
        return {
            nameMids: [...document.querySelectorAll('.task-item')].map(mid),
            barMids: [...document.querySelectorAll('.timeline-bar')].map(mid),
            labelTop: Math.min(...[...document.querySelectorAll('.milestone-label')]
                .map(el => el.getBoundingClientRect().top)),
            contentTop: content.getBoundingClientRect().top,
        };
    });

    expect(m.barMids.length).toBe(m.nameMids.length);
    m.barMids.forEach((y, i) => expect(Math.abs(y - m.nameMids[i])).toBeLessThanOrEqual(1));
    expect(m.labelTop).toBeGreaterThanOrEqual(m.contentTop);
});

// 도형 여섯 개를 한 작업에 얹는다. 날짜가 같으면 라벨이 겹칠 뿐 마커는 모두 그려진다.
const SHAPE_TREE = [
    { id: 'S', name: '도형 모음', color: '#4A90E2', children: [], expanded: true,
        timeRanges: [{ id: 'rs', startDate: '2026-01-01', endDate: '2026-06-30', dependencies: [] }],
        milestones: [
            { id: 'm1', date: '2026-01-15', label: '다이아', color: '#e67e22', shape: 'diamond' },
            { id: 'm2', date: '2026-02-15', label: '원', color: '#e67e22', shape: 'circle' },
            { id: 'm3', date: '2026-03-15', label: '사각', color: '#e67e22', shape: 'square' },
            { id: 'm4', date: '2026-04-15', label: '삼각', color: '#e67e22', shape: 'triangle' },
            { id: 'm5', date: '2026-05-15', label: '별', color: '#e67e22', shape: 'star' },
            { id: 'm6', date: '2026-06-15', label: '깃발', color: '#e67e22', shape: 'flag' },
        ] },
];

test('내보낸 HTML 의 마일스톤 도형이 여섯 가지 모두 그려진다', async ({ page, context }) => {
    // 도형은 앱과 같은 모듈(shared/milestoneShapes.js)의 서술로 조립된다. 조립은 문자열
    // 이어붙이기이므로, 서술이 맞아도 **아무것도 그리지 않는 문서**가 나올 수 있다.
    const html = await renderExport(page, SHAPE_TREE);
    const doc = await context.newPage();
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);

    const shapes = doc.locator('.milestone-shape');
    await expect(shapes).toHaveCount(6, { timeout: 5000 });

    const drawn = await shapes.evaluateAll(els => els.map(el => {
        const svg = el.querySelector('svg.shape-icon path');
        const box = el.querySelector('div.shape-div');
        const target = svg || box;
        const rect = target.getBoundingClientRect();
        return {
            kind: svg ? 'path' : 'box',
            d: svg ? svg.getAttribute('d') : null,
            radius: box ? getComputedStyle(box).borderRadius : null,
            rotated: el.classList.contains('diamond'),
            drawn: rect.width > 0 && rect.height > 0,
        };
    }));

    for (const s of drawn) expect(s.drawn).toBe(true);   // 0px 짜리 마커는 없는 것과 같다
    expect(drawn.filter(s => s.kind === 'path')).toHaveLength(3);  // 삼각·별·깃발
    expect(drawn.filter(s => s.kind === 'box')).toHaveLength(3);   // 다이아·원·사각
    // 경로가 서로 달라야 세 도형이 세 모양이다 (하나로 뭉개지면 여기서 걸린다)
    expect(new Set(drawn.filter(s => s.kind === 'path').map(s => s.d)).size).toBe(3);
    // 상자형 셋도 서로 다르다: 원(50%) · 사각(2px) · 다이아(회전)
    const boxes = drawn.filter(s => s.kind === 'box');
    expect(boxes.filter(s => s.radius.startsWith('50%'))).toHaveLength(1);
    expect(boxes.filter(s => s.rotated)).toHaveLength(1);
    expect(boxes.find(s => s.rotated).radius.startsWith('50%')).toBe(false);
});

// ── 복사 버튼 자체 ─────────────────────────────────────────────────────────
// 위 검사들은 내보내기 **모듈**을 직접 부른다. 사용자가 누르는 것은 버튼이고, 그 사이에
// 지연 로드·클립보드가 끼어 있다 — 그 둘이 실패할 때 버튼이 말없이 죽던 것을 여기서 본다.
test.describe('HTML 복사 버튼', () => {
    const button = (page) => page.getByTitle('HTML 코드 복사하기 (클립보드)');

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
        await page.getByTitle('타임라인 뷰').click();
    });

    test('누르면 붙여넣을 수 있는 HTML 이 클립보드에 들어간다', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await button(page).click();
        await expect(page.locator('.toast--success')).toContainText('복사되었습니다');
        const html = await page.evaluate(() => navigator.clipboard.readText());
        expect(html).toContain('<!-- ProjectHelper Gantt Export -->');
    });

    test('클립보드 API 가 막혀도 옛 방식으로 복사한다', async ({ page }) => {
        // http 로 열었거나 브라우저가 사용자 조작 창이 닫혔다고 판단한 경우와 같다
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
            window.__copied = null;
            const orig = document.execCommand.bind(document);
            document.execCommand = (cmd, ...rest) => {
                if (cmd === 'copy') { window.__copied = document.activeElement?.value ?? null; return true; }
                return orig(cmd, ...rest);
            };
        });
        await button(page).click();
        await expect(page.locator('.toast--success')).toContainText('복사되었습니다');
        expect(await page.evaluate(() => window.__copied)).toContain('<!-- ProjectHelper Gantt Export -->');
    });

    test('배포로 청크가 바뀐 뒤 누르면 새로고침하라고 말한다 — 말없이 죽지 않는다', async ({ page }) => {
        // 배포 전에 연 탭이 없어진 `htmlExporter-<옛해시>.js` 를 요청하는 상황
        await page.route(/htmlExporter/, route => route.fulfill({ status: 404, body: 'not found' }));
        await button(page).click();
        await expect(page.locator('.toast--error')).toContainText('새로고침');
    });
});

test('SOW 테마로 내보내면 같은 규칙으로 그린다 — 옅은 막대·회색 그룹 띠·날짜 라벨, 화살표 끄기도 따른다', async ({ page, context }) => {
    const tree = [{
        id: 'G', name: '그룹', color: '#A50034', expanded: true, milestones: [],
        timeRanges: [{ id: 'rg', startDate: '2026-01-01', endDate: '2026-03-31', dependencies: [] }],
        children: [
            { ...TREE[0], progress: 50,
                milestones: [{ id: 'mA', label: 'K3', date: '2026-01-31', color: '#4A90E2', shape: 'diamond' }] },
            TREE[1],
        ],
    }];
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    const html = await page.evaluate(async (data) => {
        const mod = await import('/src/features/io/htmlExporter.js');
        return mod.exportToHtml(data, {
            zoomLevel: 1, timeScale: 'monthly', chartTheme: 'sow', darkMode: true,
            showMilestoneDates: true, showDependencies: false,
        });
    }, tree);

    const doc = await context.newPage();
    await doc.setContent(`<div style="width:1200px;height:600px">${html}</div>`);
    const bars = doc.locator('.timeline-bar');
    await expect(bars).toHaveCount(3);

    const alpha = (css) => Number((css.match(/\/\s*([\d.]+)\s*\)$/) || [0, 1])[1]);
    const [groupBg, childBg] = await bars.evaluateAll(els => els.slice(0, 2).map(el => getComputedStyle(el).backgroundColor));
    expect(alpha(groupBg)).toBeLessThan(1);
    expect(alpha(childBg)).toBeLessThan(1);
    expect(await bars.nth(0).evaluate(el => el.getBoundingClientRect().height)).toBe(6);
    expect(await bars.nth(1).evaluate(el => el.getBoundingClientRect().height)).toBe(12);

    await expect(doc.locator('.milestone-label')).toHaveText('26.01.31');
    await expect(doc.locator('.milestone-shape .shape-div')).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
    await expect(doc.locator('.milestone-shape .shape-div')).toHaveCSS('background-color', 'rgb(107, 143, 214)');
    // 화살표 끄기를 따른다 — A → B 연결이 있어도 선이 없다
    await doc.waitForTimeout(300);
    await expect(doc.locator('.dependency-line')).toHaveCount(0);
    // 다크 모드여도 밝다
    await expect(doc.locator('.ph-gantt-container')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
