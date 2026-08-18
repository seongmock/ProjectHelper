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
    { name: '프로젝트 전환', trigger: '[data-testid="project-switcher"]', panel: '.project-switcher-menu' },
    { name: '표시 옵션', trigger: 'button[title="표시 옵션"]', panel: '.display-options-menu' },
    { name: '스냅샷 관리', trigger: 'button[title="스냅샷 관리"]', panel: '.modal-content' },
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
    await expect(page.locator('.header-title')).toContainText('프로젝트 타임라인 관리');
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
