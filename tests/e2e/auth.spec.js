// 인증 게이트. 서버는 계정이 없으면 'open' 이라 이 스위트의 기본 상태는 **꺼져 있음**이다 —
// 그 사실 자체가 첫 테스트다. 계정을 실제로 만들면 그 뒤 모든 스펙이 로그인 화면을 보게
// 되므로(데이터 디렉토리가 공유된다), 강제 모드는 응답을 가로채서 만든다.
import { test, expect } from '@playwright/test';

test('계정이 없는 배포는 로그인 없이 그대로 열린다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.locator('.login-gate')).toHaveCount(0);
    // 인증을 켜는 입구는 화면에 남아 있어야 한다 — 숨기면 기능 전체가 도달 불가능해진다.
    await expect(page.getByTitle('계정')).toBeVisible();
});

test('인증이 걸린 서버에서는 로그인 화면이 앱을 대신한다', async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, mode: 'enforced', user: null }),
    }));
    await page.goto('/');

    await expect(page.locator('.login-gate')).toBeVisible();
    // 뒤에 앱이 마운트돼 있으면 안 된다 — 서버가 거부한 화면을 조작하게 된다.
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.getByTestId('login-name')).toBeFocused();
});

test('틀린 로그인은 어느 쪽이 틀렸는지 말하지 않는다', async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, mode: 'enforced', user: null }),
    }));
    await page.route('**/api/auth/login', route => route.fulfill({
        status: 401, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'invalid credentials' }),
    }));
    await page.goto('/');

    await page.getByTestId('login-name').fill('someone');
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByRole('button', { name: '로그인' }).click();

    const error = page.locator('.login-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveText('이름 또는 비밀번호가 올바르지 않습니다.');
    // 비밀번호 칸은 비워지고 이름은 남는다 — 다시 치는 것은 비밀번호뿐이다.
    await expect(page.getByTestId('login-password')).toHaveValue('');
    await expect(page.getByTestId('login-name')).toHaveValue('someone');
});

test('쓰던 도중 세션이 끊기면 앱을 유지한 채 다시 로그인만 요구한다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);

    // 로드까지는 통과시키고, 저장 시점부터 401 로 만든다(세션 만료와 같은 상황).
    await page.route('**/api/projects/**', route => (
        route.request().method() === 'GET'
            ? route.fallback()
            : route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' })
    ));

    // 편집 → 1.5s 디바운스 후 저장 시도 → 401
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();

    const gate = page.locator('.login-gate');
    await expect(gate).toBeVisible({ timeout: 10000 });
    await expect(gate).toContainText('세션이 만료되었습니다');
    // 편집하던 화면은 살아 있다 — 여기서 새로고침하면 아직 저장 못 한 편집이 사라진다.
    await expect(page.locator('.app')).toHaveCount(1);
});
