// 미니멀 테마 + 표시 옵션 두 가지(의존성 화살표 · 마일스톤 날짜 라벨).
//
// 테마는 그리는 방법만 바꾼다 — 그래서 여기서 보는 것은 전부 **계산된 스타일**이다:
// 옅은 막대(알파 < 1), 회색 그룹 띠, 흰 테두리 다이아몬드, 날짜 라벨, 점선 오늘 선.
// 설정은 전역(서버 settings.json)이라 테스트가 끝나면 반드시 되돌린다 — 안 그러면
// 뒤에 도는 스펙들이 미니멀 테마로 그려진다.
import { test, expect } from '@playwright/test';

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

const RESET = { chartTheme: 'default', showMilestoneDates: false, showDependencies: true, showBarLabels: false, darkMode: null };

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

// 'rgb(…)', 'rgba(…, a)', 'color(srgb r g b / a)' 어느 형식이든 알파를 읽는다
const alphaOf = (css) => {
    const slash = css.match(/\/\s*([\d.]+)\s*\)$/);
    if (slash) return Number(slash[1]);
    const rgba = css.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
    return rgba ? Number(rgba[1]) : 1;
};

test('미니멀 테마: 옅은 막대 + 진행률, 회색 그룹 띠, 흰 테두리 다이아몬드와 날짜 라벨, 점선 오늘 선', async ({ page }) => {
    await pickTheme(page, '미니멀');
    const view = page.locator('.timeline-view[data-chart-theme="minimal"]');
    await expect(view).toBeVisible();

    // 행 높이 28px, 머리글은 'YYYY.MM' 한 줄
    expect(await page.locator('.timeline-row').first().evaluate(el => el.getBoundingClientRect().height)).toBe(28);
    await expect(view.locator('.timeline-header.single-axis .unit-label').first()).toHaveText(/^\d{4}\.\d{2}$/);
    expect(await view.locator('.timeline-month-grid').count()).toBeGreaterThan(0);

    const child = page.locator('.timeline-row[data-task-id="K3"] .timeline-bar');
    const childBg = await child.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(alphaOf(childBg)).toBeLessThan(1);
    expect(await child.evaluate(el => el.getBoundingClientRect().height)).toBe(12);
    // 진행률 구간은 매핑된 색(#4A90E2 → #6b8fd6) 100% 로 칠한다
    await expect(child.locator('.bar-progress-fill')).toHaveCSS('background-color', 'rgb(107, 143, 214)');

    const group = page.locator('.timeline-row[data-task-id="G"] .timeline-bar');
    const groupBg = await group.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(alphaOf(groupBg)).toBeLessThan(1);
    expect(groupBg).not.toContain('165'); // 작업 색(#A50034)이 아니라 회색이다
    expect(await group.evaluate(el => el.getBoundingClientRect().height)).toBe(6);

    const marker = page.locator('.timeline-row[data-task-id="K3"] .milestone-marker');
    await expect(marker.locator('.milestone-shape > div')).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
    await expect(marker.locator('.milestone-shape > div')).toHaveCSS('background-color', 'rgb(107, 143, 214)');
    // 이 테마를 고르면 라벨은 날짜, 이름은 툴팁이다
    await expect(marker.locator('.milestone-label')).toHaveText(MS_DATE.slice(2).replace(/-/g, '.'));
    await expect(marker.locator('.milestone-label')).toHaveAttribute('title', 'K3');

    await expect(view.locator('.today-marker')).toHaveCSS('border-left-style', 'dashed');
});

test('미니멀 테마에서 바 이름을 켜면 얇은 막대도 글자 높이까지 커진다 — 글자가 막대 밖으로 새지 않는다', async ({ page, request }) => {
    await request.post('/api/settings', { data: { chartTheme: 'minimal', showBarLabels: true } });
    await page.reload();
    await expect(page.locator('.timeline-view[data-chart-theme="minimal"] .bar-label').first()).toBeVisible();

    for (const id of ['G', 'K3']) { // 그룹(6px 띠)과 하위(12px)
        const box = await page.locator(`.timeline-row[data-task-id="${id}"] .timeline-bar`).evaluate(bar => {
            const b = bar.getBoundingClientRect();
            const l = bar.querySelector('.bar-label').getBoundingClientRect();
            return { barTop: b.top, barBottom: b.bottom, labelTop: l.top, labelBottom: l.bottom };
        });
        expect(box.labelTop).toBeGreaterThanOrEqual(box.barTop);
        expect(box.labelBottom).toBeLessThanOrEqual(box.barBottom);
    }
    // 끄면 다시 얇은 막대다
    await request.post('/api/settings', { data: { showBarLabels: false } });
    await page.reload();
    expect(await page.locator('.timeline-row[data-task-id="G"] .timeline-bar')
        .evaluate(el => el.getBoundingClientRect().height)).toBe(6);
});

test('미니멀 테마는 다크 모드에서도 밝게 그린다', async ({ page }) => {
    await pickTheme(page, '미니멀');
    await page.getByTitle('테마 변경').click();
    await expect(page.locator('[data-theme="dark"]')).toHaveCount(1);
    await expect(page.locator('.timeline-view')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.timeline-content')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('마일스톤 날짜 라벨은 테마와 별개로 켜고 끌 수 있고, 테마를 고르면 그 테마의 기본값으로 돌아간다', async ({ page }) => {
    const label = page.locator('.timeline-row[data-task-id="K3"] .milestone-label');
    const dateText = MS_DATE.slice(2).replace(/-/g, '.');
    await expect(label).toHaveText('K3');

    await openMenu(page);
    await page.getByRole('menuitemcheckbox', { name: '마일스톤 날짜 라벨' }).click();
    await page.keyboard.press('Escape');
    await expect(label).toHaveText(dateText); // 기본 테마에서도

    await pickTheme(page, '기본');
    await expect(label).toHaveText('K3');
    await pickTheme(page, '미니멀');
    await expect(label).toHaveText(dateText);
});

test('의존성 화살표를 끄면 화살표만 사라지고, 켜면 돌아온다', async ({ page }) => {
    const arrows = page.locator('.dependency-layer path[data-testid^="dependency-"]');
    await expect(arrows).toHaveCount(1);

    const toggle = page.getByRole('menuitemcheckbox', { name: '의존성 화살표' });
    await openMenu(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dependency-layer')).toHaveCount(0);

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
