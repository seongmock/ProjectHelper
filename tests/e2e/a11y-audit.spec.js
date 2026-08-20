// 접근성 회귀 가드 — "지원한다고 말한 폭에서 눌리는가"와 "글자가 읽히는가"
//
// 왜 필요했나: 2026-08-20 UI 결함 사냥에서 셋이 나왔다.
//   ① 툴바의 뷰 전환이 좁은 폭에서 **클릭 자체를 못 받았다**(`.view-toggle` 이
//      `flex-shrink:1`+`overflow:hidden` 이라 폭 2px 로 접히고, 넘친 버튼이 확대/축소
//      버튼과 같은 y 에서 겹쳐 포인터를 가로챘다).
//   ② 회색 보조 텍스트(`sync-quiet`, `dependency-none`)가 흰 배경에서 2.07:1,
//      활성 버튼의 흰 글자가 강조색 위에서 3.29:1 — WCAG AA(4.5:1) 미달이었다.
//   ③ 표의 펼침 토글이 20×20 으로 WCAG 2.5.8(24×24) 미달이었다.
// 셋 다 `npm run verify` 가 초록불인 채로 존재했다. 기존 E2E 는 기본 뷰포트(1280)
// 하나에서만 돌고, 대비를 재는 것은 아무것도 없었기 때문이다.
//
// **지원 폭은 데스크톱 1024px 이상이다**(2026-08-20 결정). 1024 미만은 지원 대상이
// 아니므로 고치지 않았고, 대신 지원한다고 말한 그 폭을 여기서 매번 잰다 — 범위를
// 좁히는 결정과 그 범위가 실제로 성립하는지 보는 검사는 함께 있어야 한다.

import { test, expect } from '@playwright/test';

// 지원 폭의 하한. 이 숫자를 낮추려면 그 폭에서 이 스위트가 통과해야 한다.
const MIN_SUPPORTED_WIDTH = 1024;

test.beforeEach(async ({ page, request }) => {
    await request.post('/api/data', { data: [] }).catch(() => {});
    await page.goto('/');
    await expect(page.getByTestId('project-rail')).toBeVisible();
    await expect(page.locator('.header-title')).not.toBeEmpty();
});

// ── 지원 폭에서 컨트롤이 실제로 눌리는가 ──────────────────────────────────
// z-index 검사와 같은 방식으로, 좌표가 아니라 **결과**(elementFromPoint)를 본다.
const reachability = () => {
    const bad = [];
    const label = (el) => (el.getAttribute('title') || el.getAttribute('aria-label')
        || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);

    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
        bad.push(`문서가 가로로 넘쳤다: ${de.scrollWidth} > ${de.clientWidth}`);
    }

    for (const el of document.querySelectorAll('.header button, .toolbar button, .toolbar input')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (el.disabled) continue;

        // 화면 밖 — 스크롤 가능한 조상이 없으면 도달할 방법이 없다
        if (r.right > window.innerWidth + 1 || r.left < -1) {
            let p = el.parentElement, scrollable = false;
            while (p) {
                if (/auto|scroll/.test(getComputedStyle(p).overflowX)) { scrollable = true; break; }
                p = p.parentElement;
            }
            if (!scrollable) {
                bad.push(`"${label(el)}" 가 화면 밖이다: x=${Math.round(r.left)}..${Math.round(r.right)} / ${window.innerWidth}`);
                continue;
            }
        }

        // 중앙에서 포인터가 자기(또는 자손)에게 닿는가 — ① 이 걸린 검사
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !el.contains(hit)) {
            const by = (hit.getAttribute('class') || hit.tagName).toString().slice(0, 40);
            bad.push(`"${label(el)}" 가 다른 요소에 덮였다: ${by}`);
        }
    }
    return bad;
};

test.describe(`지원 폭 ${MIN_SUPPORTED_WIDTH}px — 컨트롤이 눌린다`, () => {
    test.use({ viewport: { width: MIN_SUPPORTED_WIDTH, height: 768 } });

    test('헤더·툴바의 컨트롤이 화면 안에 있고 포인터가 닿는다', async ({ page }) => {
        for (const view of ['표 뷰', '타임라인 뷰']) {
            // 뷰 전환 버튼 자체가 ① 로 못 눌렸다 — 짧은 타임아웃으로 그것부터 드러낸다
            await page.locator(`button[title="${view}"]`).click({ timeout: 5000 });
            await page.waitForTimeout(300);
            const bad = await page.evaluate(reachability);
            expect(bad, `${view}: ${bad.join(' / ')}`).toEqual([]);
        }
    });
});

// ── 텍스트 대비 (WCAG 2.1 AA) ──────────────────────────────────────────────
// 반투명 배경은 조상과 **합성**해야 한다: `rgba(0,0,0,0.016)` 을 그대로 배경으로 읽으면
// 검정 위의 검정 글자가 되어 1.36:1 같은 거짓 결함이 나온다(실제로 나왔다).
const contrastAudit = () => {
    const parse = (s) => {
        const m = (s || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(v => parseFloat(v));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({           // 알파 합성
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    });
    const lum = (c) => {
        const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    // 조상을 거슬러 올라가며 불투명해질 때까지 겹친다
    const bgOf = (el) => {
        const stack = [];
        for (let p = el; p; p = p.parentElement) {
            const c = parse(getComputedStyle(p).backgroundColor);
            if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
        }
        let out = parse(getComputedStyle(document.documentElement).backgroundColor);
        if (!out || out.a < 1) out = { r: 255, g: 255, b: 255, a: 1 };
        for (const c of stack.reverse()) out = over(c, out);
        return out;
    };

    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
        // 자기 자신이 직접 가진 글자만 본다 — 부모까지 세면 같은 글자를 여러 번 재고,
        // 조상의 색으로 자손의 글자를 판정하게 된다.
        const own = [...el.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            .map(n => n.textContent.trim()).join(' ');
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.opacity === '0') continue;
        if (el.closest('[disabled]') || el.closest(':disabled')) continue;

        const fg = parse(st.color);
        if (!fg || fg.a === 0) continue;
        const bg = bgOf(el);
        const cr = ratio(fg.a < 1 ? over(fg, bg) : fg, bg);

        const size = parseFloat(st.fontSize);
        const weight = parseInt(st.fontWeight, 10) || 400;
        // WCAG 의 "큰 글자": 24px 이상, 또는 18.66px 이상이면서 굵게(700).
        // 600 은 굵게가 아니다 — 활성 버튼이 그 착각으로 3.29:1 을 통과할 뻔했다.
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        if (cr + 0.005 < need) {
            bad.push(`"${own.slice(0, 18)}" (${el.tagName}.${(el.getAttribute('class') || '').slice(0, 28)}) `
                + `${cr.toFixed(2)}:1 < ${need} — ${st.color} on rgb(${[bg.r, bg.g, bg.b].map(Math.round).join(',')}), ${st.fontSize}/${weight}`);
        }
    }
    return [...new Set(bad)];
};

// CSS transition 이 도는 중에 색을 재면 유령 결함이 나온다 — 활성 버튼의 배경이
// 전환 중간값(4.40:1, font-weight 598)으로 잡혔다. 전환이 끝난 뒤에 잰다.
// 무한 반복 애니메이션(스피너)은 절대 끝나지 않으므로 CSSTransition 만 기다린다.
async function settle(page) {
    await page.waitForFunction(() => [...document.getAnimations()]
        .filter(a => a instanceof CSSTransition)
        .every(a => a.playState === 'finished' || a.playState === 'idle'),
    null, { timeout: 3000 });
}

test.describe('텍스트 대비 (WCAG AA)', () => {
    for (const theme of ['light', 'dark']) {
        test(`${theme} 테마의 모든 텍스트가 4.5:1 이상이다`, async ({ page }) => {
            await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
            await settle(page);
            const bad = await page.evaluate(contrastAudit);
            expect(bad, `${theme}:\n${bad.join('\n')}`).toEqual([]);

            // 표 뷰만 보고 끝내면 타임라인의 활성 버튼·라벨을 놓친다
            await page.locator('button[title="타임라인 뷰"]').click();
            await settle(page);
            const bad2 = await page.evaluate(contrastAudit);
            expect(bad2, `${theme} 타임라인:\n${bad2.join('\n')}`).toEqual([]);
        });
    }
});

// ── 포인터 타깃 크기 (WCAG 2.5.8, 24×24) ──────────────────────────────────
test('클릭 대상은 24×24 보다 작지 않다', async ({ page, request }) => {
    // 펼침 토글은 **자식이 있는 행**에만 그려진다 — 20×20 이었던 그 버튼이 검사 대상이므로
    // 부모-자식을 직접 심는다. 심지 않으면 이 테스트는 헤더 버튼만 보고 통과한다.
    await page.waitForTimeout(2500); // 앱의 초기 자동 저장(1.5s 디바운스)이 끝난 뒤에 덮어쓴다
    const parent = await request.post('/api/tasks', {
        data: { name: '부모 작업', startDate: '2026-03-01', endDate: '2026-03-20' },
    });
    expect(parent.status()).toBe(201);
    const parentId = (await parent.json()).task.id;
    const child = await request.post('/api/tasks', {
        data: { name: '자식 작업', parentId, startDate: '2026-03-05', endDate: '2026-03-10' },
    });
    expect(child.status()).toBe(201);

    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    // 표와 타임라인 양쪽을 본다: 20×20 이었던 토글은 **타임라인 이름 목록** 쪽이었고,
    // 표 쪽 토글은 `button.icon` 규칙에 밀려 36×36 이었다. 한쪽만 보면 그 하나를 놓친다.
    const audit = () => page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll(
            '.header button, .toolbar button, .task-row button, .project-rail button, .task-names-list button')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (getComputedStyle(el).visibility === 'hidden') continue;
            if (r.width < 24 || r.height < 24) {
                const label = (el.getAttribute('title') || el.getAttribute('aria-label')
                    || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
                out.push(`"${label}" ${Math.round(r.width)}×${Math.round(r.height)}`);
            }
        }
        return [...new Set(out)];
    });

    for (const view of ['표 뷰', '타임라인 뷰']) {
        await page.getByTitle(view).click();
        await expect(page.locator('.expand-toggle').first()).toBeVisible();
        const bad = await audit();
        expect(bad, `${view}: ${bad.join(' / ')}`).toEqual([]);
    }
});
