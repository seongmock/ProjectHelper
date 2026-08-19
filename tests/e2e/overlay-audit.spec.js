// 팝업/메뉴 전수 검증 — "버튼을 눌러서 나온 것이 제대로 보이고, 제대로 눌리는가"
//
// 왜 필요했나: 드롭다운 두 개가 (1) 정의되지 않은 CSS 변수(`var(--color-bg)`)를 배경으로
// 써서 **투명**했고, (2) `.header`(sticky, z 100)가 만든 쌓임 문맥 안에 있어 z-index 를
// 500 으로 올려도 타임라인 마일스톤(z 200)에 덮였다. 둘 다 스크린샷을 눈으로 봐야만
// 드러나는 종류라서, 사람이 아니라 테스트가 매번 클릭하도록 만든 것이다.
//
// 검사 세 가지 (모두 "화면에 실제로 그려진 결과" 기준):
//   [불투명]   패널 자신의 background-color 알파가 1 — 뒤가 비치면 읽을 수 없다.
//   [화면 안]  패널 사각형이 뷰포트 안에 들어온다 — 밖으로 나간 부분은 클릭할 수 없다.
//   [맨 위]    패널 안쪽 여러 점에서 elementFromPoint 가 패널의 자손을 돌려준다 —
//              이것이 z-index 를 숫자가 아니라 **결과**로 검사하는 유일한 방법이다.

import { test, expect } from '@playwright/test';

// 클릭하면 떠야 하는 것들. panel 은 뜬 뒤 검사할 요소.
const OVERLAY_TRIGGERS = [
    { name: '표시 옵션', trigger: 'button[title="표시 옵션"]', panel: '.display-options-menu' },
    { name: '프로젝트 관리', trigger: 'button[title="프로젝트 관리"]', panel: '.modal-content' },
    { name: '프롬프트 도우미', trigger: 'button[title="프롬프트 도우미"]', panel: '.modal-content' },
    { name: '가져오기', trigger: 'button[title="가져오기"]', panel: '.modal-content' },
    { name: '내보내기', trigger: 'button[title="내보내기"]', panel: '.modal-content' },
];

// 패널을 검사한다. 반환값은 문제 목록 — 비어 있으면 합격.
async function auditPanel(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return ['패널이 DOM 에 없다'];
        const problems = [];
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        // [불투명] rgba(...) 의 네 번째 값. `background: var(--없는이름)` 은
        // "computed-value time 에 무효" 규칙으로 initial(=transparent)이 된다.
        const alpha = (() => {
            const m = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (!m) return 1;
            const parts = m[1].split(',').map(s => parseFloat(s));
            return parts.length < 4 ? 1 : parts[3];
        })();
        if (alpha < 1) problems.push(`배경이 불투명하지 않다: ${style.backgroundColor}`);

        // [화면 안] 1px 오차는 서브픽셀 반올림 몫으로 허용한다.
        const t = 1;
        if (rect.width <= 0 || rect.height <= 0) problems.push('크기가 0 이다');
        if (rect.top < -t) problems.push(`위가 잘렸다: top=${Math.round(rect.top)}`);
        if (rect.left < -t) problems.push(`왼쪽이 잘렸다: left=${Math.round(rect.left)}`);
        if (rect.right > window.innerWidth + t) problems.push(`오른쪽이 넘쳤다: right=${Math.round(rect.right)} > ${window.innerWidth}`);
        if (rect.bottom > window.innerHeight + t) problems.push(`아래가 넘쳤다: bottom=${Math.round(rect.bottom)} > ${window.innerHeight}`);

        // [맨 위] 네 귀퉁이 안쪽 + 중앙. 모서리 딱 위는 border 반올림에 걸리므로 4px 들어간다.
        const inset = 4;
        const points = [
            [rect.left + inset, rect.top + inset],
            [rect.right - inset, rect.top + inset],
            [rect.left + inset, rect.bottom - inset],
            [rect.right - inset, rect.bottom - inset],
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
        ];
        for (const [x, y] of points) {
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !(el === hit || el.contains(hit))) {
                problems.push(`(${Math.round(x)},${Math.round(y)}) 에서 다른 요소가 위를 덮었다: ${hit ? `${hit.tagName}.${hit.className}` : 'null'}`);
            }
        }
        return problems;
    }, selector);
}

test.beforeEach(async ({ page, request }) => {
    await request.post('/api/data', { data: [] }).catch(() => {});
    await page.goto('/');
    // 앱 이름은 좌측 레일이, 프로젝트 이름은 컨텍스트 바가 갖는다(실사 §5.4-11 재설계)
    await expect(page.getByTestId('project-rail')).toBeVisible();
    await expect(page.locator('.header-title')).not.toBeEmpty();
});

test.describe('팝업/메뉴 전수 검증', () => {
    for (const { name, trigger, panel } of OVERLAY_TRIGGERS) {
        test(`${name} — 불투명 · 화면 안 · 맨 위`, async ({ page }) => {
            await page.locator(trigger).click();
            const panelEl = page.locator(panel).first();
            await expect(panelEl).toBeVisible();

            const problems = await auditPanel(page, panel);
            expect(problems, `${name} 패널: ${problems.join(' / ')}`).toEqual([]);

            // Escape 로 닫히는 것도 여기서 함께 본다 — 닫히지 않는 팝업은 그 뒤 모든
            // 클릭을 가로채므로, 이 검사가 없으면 다음 테스트가 엉뚱한 곳에서 깨진다.
            await page.keyboard.press('Escape');
            await expect(panelEl).toHaveCount(0);
        });
    }

    // 위 목록은 "떠야 할 것"을 안다. 이 테스트는 반대로 **모든 버튼을 눌러 보고**
    // 그때 떠 있는 팝업이 무엇이든 같은 세 검사를 통과하는지 본다 — 목록에 없는
    // 팝업이 새로 생겨도 걸린다.
    test('헤더·툴바의 모든 버튼을 눌러 팝업을 검사한다', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        const buttons = page.locator('.header button:visible, .toolbar button:visible');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(10); // 인벤토리가 통째로 사라진 것을 잡는 하한선

        const failures = [];
        for (let i = 0; i < count; i++) {
            const button = buttons.nth(i);
            if (!(await button.isVisible()) || await button.isDisabled()) continue;
            const label = (await button.getAttribute('title'))
                || (await button.textContent())?.trim() || `#${i}`;

            // 파일 다운로드/클립보드를 건드리는 버튼은 팝업 검사 대상이 아니고,
            // 클릭하면 브라우저 다이얼로그로 테스트를 멈춘다.
            if (/이미지로 복사|HTML 코드 복사/.test(label)) continue;

            await button.click();
            for (const sel of ['.modal-content', '[role="menu"]']) {
                if (await page.locator(sel).count() === 0) continue;
                const problems = await auditPanel(page, sel);
                if (problems.length) failures.push(`[${label}] ${sel}: ${problems.join(' / ')}`);
            }
            await page.keyboard.press('Escape');
        }

        expect(failures, failures.join('\n')).toEqual([]);
        expect(errors, errors.join('\n')).toEqual([]);
    });
});

// ── 잘리는 텍스트 전수 검사 ───────────────────────────────────────────────
// 라벨과 툴팁은 "옆이나 위에 걸려서" 잘린다. 잘린 텍스트는 틀린 텍스트보다 나쁘다 —
// 사용자는 잘린 줄 모르고 남은 절반을 읽는다. 배치 규칙 자체는 순수함수의 단위테스트가
// 고정하고(milestoneLabels / anchoredMenu), 여기서는 **실제로 그려진 사각형**을 본다.

// 마일스톤을 잔뜩 붙인 데이터를 심는다. 축의 양 끝(왼쪽/오른쪽 잘림)과 한 지점에 몰린
// 여섯 개(겹침)를 동시에 만든다.
async function seedMilestones(page, request) {
    await page.waitForTimeout(2500); // 앱의 초기 자동 저장(1.5s 디바운스)이 끝난 뒤에 덮어쓴다
    const { data } = await (await request.get('/api/data')).json();
    const target = data.find(t => (t.timeRanges || []).length > 0);
    const range = target.timeRanges[0];
    const mid = range.startDate;
    target.milestones = [
        { id: 'ms-left', date: range.startDate, label: '맨 왼쪽 마일스톤', color: '#e74c3c', shape: 'diamond' },
        { id: 'ms-right', date: range.endDate, label: '맨 오른쪽 마일스톤', color: '#e74c3c', shape: 'diamond' },
        ...Array.from({ length: 6 }, (_, i) => ({
            id: `ms-crowd-${i}`, date: mid, label: `몰린 마일스톤 ${i}`, color: '#4a90e2', shape: 'circle',
        })),
    ];
    expect((await request.post('/api/data', { data })).ok()).toBe(true);
    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.locator('.milestone-label').first()).toBeVisible();
}

test.describe('잘리는 텍스트 전수 검사', () => {
    test('마일스톤 라벨은 차트 밖으로 나가지 않는다', async ({ page, request }) => {
        await seedMilestones(page, request);

        const problems = await page.evaluate(() => {
            const content = document.querySelector('.timeline-content').getBoundingClientRect();
            const bad = [];
            for (const el of document.querySelectorAll('.milestone-label')) {
                const r = el.getBoundingClientRect();
                const text = el.textContent;
                // 2px 는 서브픽셀·테두리 반올림 몫
                if (r.left < content.left - 2) bad.push(`"${text}" 왼쪽으로 ${Math.round(content.left - r.left)}px 넘쳤다`);
                if (r.right > content.right + 2) bad.push(`"${text}" 오른쪽으로 ${Math.round(r.right - content.right)}px 넘쳤다`);
                if (r.width <= 0) bad.push(`"${text}" 폭이 0 이다`);
            }
            return bad;
        });
        expect(problems, problems.join(' / ')).toEqual([]);
    });

    test('자동 배치된 마일스톤 라벨은 서로 겹치지 않는다', async ({ page, request }) => {
        await seedMilestones(page, request);
        // 검사할 라벨이 없으면 이 테스트는 아무것도 보증하지 않는다 — 심은 8개는 최소한 있어야 한다
        expect(await page.locator('.milestone-label').count()).toBeGreaterThanOrEqual(8);

        // 같은 칸(position + tier)에 놓인 라벨끼리만 겹칠 수 있다. 여섯 개를 한 날짜에
        // 몰아 두었으므로, 예전 구현(칸이 셋)에서는 반드시 겹쳤다.
        const problems = await page.evaluate(() => {
            const labels = [...document.querySelectorAll('.milestone-label')].map(el => ({
                text: el.textContent,
                slot: `${el.dataset.labelPosition}:${el.dataset.labelTier}`,
                r: el.getBoundingClientRect(),
            }));
            const bad = [];
            for (let i = 0; i < labels.length; i++) {
                for (let j = i + 1; j < labels.length; j++) {
                    const a = labels[i], b = labels[j];
                    if (a.slot !== b.slot) continue;
                    if (a.r.left < b.r.right && a.r.right > b.r.left) {
                        bad.push(`"${a.text}" 와 "${b.text}" 가 ${a.slot} 에서 겹쳤다`);
                    }
                }
            }
            return bad;
        });
        expect(problems, problems.join(' / ')).toEqual([]);
    });

    // 헤더 버튼의 CSS 툴팁(`.tooltip::after`)은 실제 요소가 아니라 의사 요소라서 사각형을
    // 직접 못 잡는다 — 부모 사각형에 계산된 top/left 를 더해 재구성한다.
    test('헤더 버튼의 CSS 툴팁이 화면 밖으로 나가지 않는다', async ({ page }) => {
        await expect(page.locator('.tooltip[data-tooltip]')).not.toHaveCount(0);
        const problems = await page.evaluate(() => {
            const bad = [];
            for (const el of document.querySelectorAll('.tooltip[data-tooltip]')) {
                const host = el.getBoundingClientRect();
                const cs = getComputedStyle(el, '::after');
                const box = {
                    left: host.left + parseFloat(cs.left),
                    top: host.top + parseFloat(cs.top),
                    width: parseFloat(cs.width),
                    height: parseFloat(cs.height),
                };
                const label = el.dataset.tooltip;
                if (!Number.isFinite(box.left) || !Number.isFinite(box.top)) {
                    bad.push(`"${label}" 툴팁 좌표를 읽을 수 없다 (${cs.left}, ${cs.top})`);
                    continue;
                }
                // 위로 띄우면 헤더가 화면 맨 위라서 음수 y 로 사라졌다 — 그것이 이 검사의 이유다.
                if (box.top < 0) bad.push(`"${label}" 툴팁이 화면 위로 ${Math.round(-box.top)}px 잘렸다`);
                if (box.left < 0) bad.push(`"${label}" 툴팁이 왼쪽으로 ${Math.round(-box.left)}px 잘렸다`);
                if (box.left + box.width > window.innerWidth) {
                    bad.push(`"${label}" 툴팁이 오른쪽으로 ${Math.round(box.left + box.width - window.innerWidth)}px 잘렸다`);
                }
                if (box.top + box.height > window.innerHeight) {
                    bad.push(`"${label}" 툴팁이 아래로 잘렸다`);
                }
            }
            return bad;
        });
        expect(problems, problems.join(' / ')).toEqual([]);
    });
});
