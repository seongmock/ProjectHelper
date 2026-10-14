// 미니멀 테마 + 표시 옵션 두 가지(의존성 화살표 · 마일스톤 날짜 라벨).
//
// 테마는 그리는 방법만 바꾼다 — 그래서 여기서 보는 것은 전부 **계산된 스타일**이다:
// 옅은 막대(알파 < 1), 회색 그룹 띠, 흰 테두리 다이아몬드, 날짜 라벨, 점선 오늘 선.
// 설정은 전역(서버 settings.json)이라 테스트가 끝나면 반드시 되돌린다 — 안 그러면
// 뒤에 도는 스펙들이 미니멀 테마로 그려진다.
//
// 2026-10-04 레드팀이 찾은 회귀들의 가드도 여기 있다 — 각 테스트 이름이 무엇이 깨졌었는지 말한다.
import { test, expect } from '@playwright/test';

// 사용자는 KST 에 있다. 날짜 문자열을 UTC 로 읽는 실수는 UTC 에서 도는 CI 에서는 보이지 않는다
// (화살표 끝이 막대보다 하루 오른쪽에 붙던 결함이 그랬다).
test.use({ timezoneId: 'Asia/Seoul' });

const TODAY = new Date();
const iso = (offsetDays) => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MS_DATE = iso(20);

// 그룹 하나 아래 단계 둘. 색은 트래커(ph.py)가 저장하는 '예정' hex 그대로다.
const TREE = [{
    id: 'G', name: '주요 마일스톤', color: '#A50034', expanded: true, milestones: [],
    timeRanges: [{ id: 'rg', startDate: iso(-30), endDate: iso(60), dependencies: [] }],
    children: [
        { id: 'K3', name: 'K3 · Initial Design', color: '#4A90E2', expanded: true, children: [], progress: 50,
            timeRanges: [{ id: 'r3', startDate: iso(-20), endDate: MS_DATE, dependencies: [] }],
            milestones: [{ id: 'm3', label: 'K3', date: MS_DATE, color: '#4A90E2', shape: 'diamond' }] },
        { id: 'K4', name: 'K4 · Stable Design', color: '#4A90E2', expanded: true, children: [], milestones: [],
            timeRanges: [{ id: 'r4', startDate: iso(21), endDate: iso(50), dependencies: ['r3'] }] },
    ],
}];

// 화면 배치를 바꾸는 설정은 전부 되돌린다 — 앞 스펙이 남긴 값(레일 펼침·인스펙터·배율)으로 폭이 바뀌면
// 잡는 자리·가장자리 측정이 엉뚱한 곳을 잰다
const RESET = {
    chartTheme: 'default', showMilestoneDates: false, showDependencies: true, showBarLabels: false, darkMode: null,
    showPhaseChain: true, railExpanded: false, showInspector: false, zoomLevel: 1, timeScale: 'monthly',
    isCompact: false, colorMode: 'task', showTaskNames: true,
};

test.beforeEach(async ({ page, request }) => {
    await request.post('/api/settings', { data: RESET });
    await request.post('/api/data', { data: TREE });
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await page.getByTitle('타임라인 뷰').click();
    await expect(page.locator('.timeline-bar').first()).toBeVisible();
});

test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: RESET });
});

const openMenu = (page) => page.getByTitle('표시 옵션').click();
const pickTheme = async (page, label) => {
    await openMenu(page);
    await page.getByRole('menuitemradio', { name: label }).click();
    await page.keyboard.press('Escape');
};

// 보이는 띠는 막대 상자가 아니라 그 안의 층(.bar-tint)이다 — 막대 상자는 투명한 잡기 영역
const band = (page, id) => page.locator(`.timeline-row[data-task-id="${id}"] .timeline-bar .bar-tint`);
const heightOf = (loc) => loc.evaluate(el => el.getBoundingClientRect().height);

test('미니멀 테마: 옅은 막대 + 진행률, 회색 그룹 띠, 흰 테두리 다이아몬드와 날짜 라벨, 점선 오늘 선', async ({ page }) => {
    await pickTheme(page, '미니멀');
    const view = page.locator('.timeline-view[data-chart-theme="minimal"]');
    await expect(view).toBeVisible();

    // 행 높이 28px, 머리글은 'YYYY.MM' 한 줄
    expect(await page.locator('.timeline-row').first().evaluate(el => el.getBoundingClientRect().height)).toBe(28);
    await expect(view.locator('.timeline-header.single-axis .unit-label').first()).toHaveText(/^\d{4}\.\d{2}$/);
    expect(await view.locator('.timeline-month-grid').count()).toBeGreaterThan(0);

    // 옅은 띠: 매핑된 색(#4A90E2 → #6b8fd6)을 28% 로, 진행률 구간만 100% 로
    await expect(band(page, 'K3')).toHaveCSS('background-color', 'rgb(107, 143, 214)');
    await expect(band(page, 'K3')).toHaveCSS('opacity', '0.28');
    expect(await heightOf(band(page, 'K3'))).toBe(12);
    const child = page.locator('.timeline-row[data-task-id="K3"] .timeline-bar');
    await expect(child.locator('.bar-progress-fill')).toHaveCSS('background-color', 'rgb(107, 143, 214)');
    expect(await heightOf(child.locator('.bar-progress-fill'))).toBe(12);

    // 그룹은 작업 색(#A50034)이 아니라 회색 띠다
    await expect(band(page, 'G')).toHaveCSS('background-color', 'rgb(196, 196, 193)');
    await expect(band(page, 'G')).toHaveCSS('opacity', '0.55');
    expect(await heightOf(band(page, 'G'))).toBe(6);

    const marker = page.locator('.timeline-row[data-task-id="K3"] .milestone-marker');
    await expect(marker.locator('.milestone-shape > div')).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
    await expect(marker.locator('.milestone-shape > div')).toHaveCSS('background-color', 'rgb(107, 143, 214)');
    // 이 테마를 고르면 라벨은 날짜, 이름은 툴팁이다
    await expect(marker.locator('.milestone-label')).toHaveText(MS_DATE.slice(2).replace(/-/g, '.'));
    await expect(marker.locator('.milestone-label')).toHaveAttribute('title', 'K3');

    await expect(view.locator('.today-marker')).toHaveCSS('border-left-style', 'dashed');
});

test('미니멀 테마에서 바 이름을 켜면 얇은 띠도 글자 높이까지 커진다 — 글자가 띠 밖으로 새지 않는다', async ({ page, request }) => {
    await request.post('/api/settings', { data: { chartTheme: 'minimal', showBarLabels: true } });
    await page.reload();
    await expect(page.locator('.timeline-view[data-chart-theme="minimal"] .bar-label').first()).toBeVisible();

    for (const id of ['G', 'K3']) { // 그룹(6px 띠)과 하위(12px)
        const box = await page.locator(`.timeline-row[data-task-id="${id}"] .timeline-bar`).evaluate(bar => {
            const b = bar.querySelector('.bar-tint').getBoundingClientRect();
            const l = bar.querySelector('.bar-label').getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, labelTop: l.top, labelBottom: l.bottom };
        });
        expect(box.labelTop).toBeGreaterThanOrEqual(box.top);
        expect(box.labelBottom).toBeLessThanOrEqual(box.bottom);
    }
    // 라벨 뒤에 상자도 헤일로도 깔지 않는다 — 흰 상자는 옅은 막대를 도려낸 것처럼 보였다(2026-10-14)
    const label = page.locator('.timeline-row[data-task-id="K3"] .timeline-bar > .bar-content .bar-label');
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(label).toHaveCSS('text-shadow', 'none');
    // 끄면 다시 얇은 띠다
    await request.post('/api/settings', { data: { showBarLabels: false } });
    await page.reload();
    expect(await heightOf(band(page, 'G'))).toBe(6);
});

for (const theme of ['default', 'lg', 'minimal']) {
    test(`${theme}: 마커와 막대를 잡는 자리가 넓다 — 마커 중심에서 좌우 11px·상하 9px, 그룹 띠 위아래 7px`, async ({ page, request }) => {
        await request.post('/api/settings', { data: { chartTheme: theme } });
        await page.reload();
        await expect(page.locator('.timeline-row[data-task-id="K3"] .milestone-shape')).toBeVisible();
        // 축 폭은 ResizeObserver 로 늦게 들어와 첫 프레임 뒤에 막대가 자리를 옮긴다 — 자리를 잡을 때까지 다시 잰다
        await expect.poll(() => page.evaluate(() => {
            const shape = document.querySelector('.timeline-row[data-task-id="K3"] .milestone-shape > *').getBoundingClientRect();
            const [mx, my] = [shape.left + shape.width / 2, shape.top + shape.height / 2];
            // 상하는 9px — 미니멀은 라벨이 작은 마커 바로 아래(4px)에 붙어 그 아래는 라벨의 자리다
            const marker = [[-11, 0], [11, 0], [0, -9], [0, 9]]
                .every(([dx, dy]) => !!document.elementFromPoint(mx + dx, my + dy)?.closest('.milestone-shape'));
            const g = document.querySelector('.timeline-row[data-task-id="G"] .timeline-bar');
            const b = (g.querySelector('.bar-tint') || g).getBoundingClientRect();
            const cx = b.left + 40, cy = b.top + b.height / 2;
            const band = [cy - 7, cy + 7].every(y => document.elementFromPoint(cx, y)?.closest('.timeline-bar') === g);
            // 기본·LG 막대는 24px 이라 위아래 7px 이 원래 막대 안이다 — 미니멀 6px 띠가 문제였다
            return { marker, band };
        })).toEqual({ marker: true, band: true });
    });
}

test('범위 맨 끝(말일)의 마일스톤이 오른쪽 가장자리에서 잘리지 않는다', async ({ page, request }) => {
    const tree = structuredClone(TREE);
    const end = new Date(TODAY.getFullYear(), TODAY.getMonth() + 3, 0); // 석 달 뒤 말일 — 축의 끝
    const last = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    tree[0].timeRanges[0].endDate = last;
    tree[0].milestones = [{ id: 'mEnd', label: '끝', date: last, color: '#e67e22', shape: 'diamond' }];
    await request.post('/api/data', { data: tree });
    await page.reload();
    const marker = page.locator('.timeline-row[data-task-id="G"] .milestone-shape > div');
    await expect(marker).toBeVisible();
    const { right, edge } = await marker.evaluate(el => ({
        right: el.getBoundingClientRect().right,
        edge: document.querySelector('.timeline-scroll-container').getBoundingClientRect().right,
    }));
    expect(right).toBeLessThanOrEqual(edge);
});

test('미니멀: 선택한 막대가 보인다 · 이미지로 복사가 실패하지 않는다', async ({ page, request }) => {
    await request.post('/api/settings', { data: { chartTheme: 'minimal' } });
    await page.reload();
    await expect(band(page, 'K3')).toBeVisible();
    const bar = page.locator('.timeline-row[data-task-id="K3"] .timeline-bar');
    await bar.locator('.bar-content').click();
    await expect(bar).toHaveClass(/selected/);
    expect(await bar.evaluate(el => getComputedStyle(el, '::after').borderTopWidth)).toBe('2px');

    // html2canvas 는 color-mix 의 계산값 color(srgb …) 를 읽지 못해 미니멀에서만 캡처가 통째로 실패했다
    expect(await page.evaluate(() => [...document.querySelectorAll('.timeline-view *')]
        .filter(el => /color\(/.test(getComputedStyle(el).backgroundColor)).length)).toBe(0);
    await page.getByTitle('이미지로 복사').click();
    await expect(page.locator('.toast').filter({ hasText: /복사되었습니다|다운로드했습니다/ })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.toast').filter({ hasText: '캡처 중 오류' })).toHaveCount(0);
});

test('KST 에서 화살표 끝이 막대 끝에 붙는다 — 하루 밀리지 않는다', async ({ page }) => {
    const gap = await page.evaluate(() => {
        const svg = document.querySelector('.dependency-layer');
        const path = svg.querySelector('path[data-testid^="dependency-"]');
        const startX = Number(path.getAttribute('d').match(/^M\s*([\d.]+)/)[1]);
        const bar = document.querySelector('.timeline-row[data-task-id="K3"] .timeline-bar').getBoundingClientRect();
        return Math.abs(svg.getBoundingClientRect().left + startX - bar.right);
    });
    expect(gap).toBeLessThan(2);
});

test('미니멀 헤더: 축을 크게 줄여도 월 라벨끼리 겹치지 않고, 오늘 글자와도 겹치지 않는다', async ({ page, request }) => {
    const long = structuredClone(TREE);
    long[0].timeRanges[0].endDate = iso(365 * 5);
    await request.post('/api/data', { data: long });
    await request.post('/api/settings', { data: { chartTheme: 'minimal', zoomLevel: 0.5 } });
    await page.reload();
    await expect(page.locator('.single-axis .unit-label').first()).toBeVisible();
    const report = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('.single-axis .unit-label')].map(el => el.getBoundingClientRect());
        const overlaps = rects.slice(1).filter((r, i) => r.left < rects[i].right).length;
        const marker = document.querySelector('.today-marker');
        const m = marker.getBoundingClientRect();
        const todayBottom = m.top + parseFloat(getComputedStyle(marker, '::before').height);
        const hitsToday = rects.filter(r => r.top < todayBottom && r.left - 30 < m.left && m.left < r.right + 30).length;
        return { count: rects.length, overlaps, hitsToday };
    });
    expect(report.count).toBeGreaterThan(1);
    expect(report.overlaps).toBe(0);
    expect(report.hitsToday).toBe(0);
    await request.post('/api/settings', { data: { zoomLevel: 1 } });
});

test('미니멀: 채움 색에 흰 글자가 맞으면(빨강) 채운 구간만 흰 글자로 다시 그리고, 바닥 라벨과 정확히 겹친다', async ({ page, request }) => {
    const late = structuredClone(TREE);
    late[0].children[1] = { ...late[0].children[1], progress: 60,
        timeRanges: [{ id: 'r4', startDate: iso(-60), endDate: iso(-10), dependencies: ['r3'] }] }; // 지난 일정 → 지연(빨강)
    await request.post('/api/data', { data: late });
    await request.post('/api/settings', { data: { chartTheme: 'minimal', showBarLabels: true, colorMode: 'status' } });
    await page.reload();
    const bar = page.locator('.timeline-row[data-task-id="K4"] .timeline-bar');
    const onFill = bar.locator('.bar-progress-fill.has-label .bar-label');
    await expect(onFill).toHaveCSS('color', 'rgb(255, 255, 255)');
    const [base, top] = await Promise.all([
        bar.locator(':scope > .bar-content .bar-label').boundingBox(),
        onFill.boundingBox(),
    ]);
    expect(Math.abs(top.x - base.x)).toBeLessThan(0.5);
    expect(Math.abs(top.y - base.y)).toBeLessThan(0.5);
    // 파랑 채움(K3, 진행 50%)은 검은 글자가 더 잘 읽힌다 — 다시 그리지 않는다
    await expect(page.locator('.timeline-row[data-task-id="K3"] .bar-progress-fill.has-label')).toHaveCount(0);
});

test('미니멀 테마는 다크 모드에서도 밝게 그린다', async ({ page }) => {
    await pickTheme(page, '미니멀');
    await page.getByTitle('테마 변경').click();
    await expect(page.locator('[data-theme="dark"]')).toHaveCount(1);
    await expect(page.locator('.timeline-view')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.timeline-content')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('마일스톤 날짜 라벨은 테마와 별개로 켜고 끌 수 있고, 테마를 바꾸면 그 테마의 기본값으로 돌아간다', async ({ page }) => {
    const label = page.locator('.timeline-row[data-task-id="K3"] .milestone-label');
    const dateText = MS_DATE.slice(2).replace(/-/g, '.');
    const toggleDates = async () => {
        await openMenu(page);
        await page.getByRole('menuitemcheckbox', { name: '마일스톤 날짜 라벨' }).click();
        await page.keyboard.press('Escape');
    };
    await expect(label).toHaveText('K3');

    await toggleDates();
    await expect(label).toHaveText(dateText); // 기본 테마에서도

    await pickTheme(page, '미니멀');           // 미니멀의 기본값: 켜짐
    await expect(label).toHaveText(dateText);
    await pickTheme(page, '기본');             // 기본의 기본값: 꺼짐
    await expect(label).toHaveText('K3');
    await pickTheme(page, '미니멀');
    await expect(label).toHaveText(dateText);

    // 이미 고른 테마를 다시 누르는 것은 아무 일도 아니다 — 사용자의 선택을 초기화하던 결함
    await toggleDates();
    await expect(label).toHaveText('K3');
    await pickTheme(page, '미니멀');
    await expect(label).toHaveText('K3');
});

test('의존성 화살표를 끄면 화살표만 사라지고, 켜면 돌아온다', async ({ page }) => {
    const arrows = page.locator('.dependency-layer path[data-testid^="dependency-"]');
    await expect(arrows).toHaveCount(1);

    const toggle = page.getByRole('menuitemcheckbox', { name: '의존성 화살표' });
    await openMenu(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(arrows).toHaveCount(0);

    // 연결 자체는 그대로다 — 표의 배지가 여전히 말한다
    await page.getByTitle('표 뷰').click();
    await expect(page.locator('.task-row', { hasText: 'K4' }).getByLabel('선행 1')).toBeVisible();
    await page.getByTitle('타임라인 뷰').click();

    await openMenu(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(arrows).toHaveCount(1);
});

test('LG: 화살표를 켜고 꺼도 행 줄무늬가 뒤집히지 않는다', async ({ page, request }) => {
    await request.post('/api/settings', { data: { chartTheme: 'lg' } });
    await page.reload();
    await expect(page.locator('.timeline-view[data-chart-theme="lg"] .timeline-row')).toHaveCount(3);
    await expect(page.locator('.dependency-layer path[data-testid^="dependency-"]')).toHaveCount(1);
    const stripes = () => page.locator('.timeline-row').evaluateAll(rows => rows.map(r => getComputedStyle(r).backgroundColor));
    const before = await stripes();
    await request.post('/api/settings', { data: { showDependencies: false } });
    await page.reload();
    await expect(page.locator('.timeline-view[data-chart-theme="lg"] .timeline-row')).toHaveCount(3);
    await expect(page.locator('.dependency-layer path[data-testid^="dependency-"]')).toHaveCount(0);
    expect(await stripes()).toEqual(before);
});

test('접힌 행의 숨은 마일스톤도 자리가 있으면 라벨을 달고, 이웃 행의 라벨과 포개지지 않는다', async ({ page, request }) => {
    // 두 그룹을 접는다. 둘 다 같은 날짜에 숨은 마일스톤이 있어, 위 행의 '아래' 라벨과 아래 행의 '위' 라벨이
    // 같은 띠에서 만난다 — 행마다 따로 판정하던 첫 구현은 여기서 포갰다
    const group = (id, msLabel) => ({
        id, name: id, color: '#888', expanded: false, milestones: [], timeRanges: [],
        children: [{ id: `${id}c`, name: `${id} 자식`, color: '#4A90E2', expanded: true, children: [],
            timeRanges: [{ id: `${id}r`, startDate: iso(-10), endDate: iso(40), dependencies: [] }],
            milestones: [{ id: `${id}m`, label: msLabel, date: iso(20), color: '#E74C3C', shape: 'diamond' }] }],
    });
    await request.post('/api/data', { data: [group('A', '첫 그룹 마일스톤'), group('B', '둘째 그룹 마일스톤')] });
    await page.reload();
    const labels = page.getByTestId('rollup-milestone-label');
    await expect(labels.first()).toBeVisible();
    await expect(labels.filter({ hasText: '첫 그룹 마일스톤' })).toHaveCount(1);
    const rects = await labels.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const [a, b] = [rects[i], rects[j]];
            const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            expect(overlap, `label ${i} × ${j}`).toBe(false);
        }
    }
    // 자리가 없는 라벨은 그리지 않을 뿐, 마커와 툴팁은 남는다
    await expect(page.getByTestId('rollup-milestone')).toHaveCount(2);
    await expect(page.getByTestId('rollup-milestone').last()).toHaveAttribute('title', /둘째 그룹 마일스톤/);
});
