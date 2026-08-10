// AI 연동 동기화 테스트 — 외부(REST API) 변경이 열린 브라우저 탭에 반영되는지 검증
// 전제: API 서버(localhost:3000)가 실행 중이어야 한다 (vite proxy 경유)
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page, request }) => {
    const res = await request.post('/api/data', { data: [] }).catch(() => null);
    test.skip(!res || !res.ok(), 'API 서버가 실행 중이 아님 — cd server && npm start');
    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
});

test('외부(AI) 작업 추가 → 열린 탭에 10초 폴링으로 자동 반영', async ({ page, request }) => {
    // 초기 자동저장(1.5s 디바운스)이 끝나 리비전이 안정될 때까지 대기
    await page.waitForTimeout(2500);

    // 외부 프로세스(AI)가 REST API로 작업 추가
    const res = await request.post('/api/tasks', {
        data: { name: 'AI가 추가한 작업', startDate: '2026-08-01', endDate: '2026-08-15' },
    });
    expect(res.status()).toBe(201);

    // 폴링 주기(10s) 내에 탭에 나타나야 한다
    await expect(page.getByText('AI가 추가한 작업').first()).toBeVisible({ timeout: 15_000 });
});

// 판정 규칙 자체는 server/test/dependency.test.js 가 고정한다. 여기서 보는 것은
// **HTTP 경계**다: 라우트가 실제로 붙어 있는지, 거부가 400 으로 나가는지.
test('의존성 정합성 — 순환은 400 으로 거부되고, 위반·끊어진 참조는 조회로 드러난다', async ({ request }) => {
    const addTask = async (name, startDate, endDate) => {
        const res = await request.post('/api/tasks', { data: { name, startDate, endDate } });
        expect(res.status()).toBe(201);
        return (await res.json()).task;
    };
    const setDeps = (task, dependencies) =>
        request.patch(`/api/tasks/${task.id}/time-ranges/${task.timeRanges[0].id}`, { data: { dependencies } });
    const issues = async () => (await request.get('/api/dependency-issues')).json();

    const a = await addTask('선행', '2026-08-01', '2026-08-10');
    const b = await addTask('후행', '2026-08-11', '2026-08-20');

    // 정상 연결: 선행 → 후행
    expect((await setDeps(b, [a.timeRanges[0].id])).status()).toBe(200);
    const clean = await issues();
    expect(clean).toMatchObject({ ok: true, cycles: [], overlaps: [], dangling: [] });

    // 되돌리는 연결은 순환이라 쓰기 자체가 막힌다
    const cyclic = await setDeps(a, [b.timeRanges[0].id]);
    expect(cyclic.status()).toBe(400);
    expect((await issues()).cycles).toEqual([]); // 거부됐으니 트리에 남지 않았다

    // 존재하지 않는 id 도 마찬가지
    expect((await setDeps(a, ['없는-id'])).status()).toBe(400);

    // 일정 위반은 쓰기 시점에 막히지 않는다 — 조회로 드러난다
    await request.patch(`/api/tasks/${b.id}/time-ranges/${b.timeRanges[0].id}`, {
        data: { startDate: '2026-08-05' },
    });
    expect((await issues()).overlaps).toHaveLength(1);

    // 선행을 지우면 그것을 가리키던 참조도 같은 쓰기에서 걷어낸다
    await request.delete(`/api/tasks/${a.id}`);
    const after = await issues();
    expect(after.overlaps).toEqual([]);
    expect(after.dangling).toEqual([]);
});

test('편집 충돌(409) → 서버 우선으로 자동 재로드', async ({ page, request }) => {
    await page.waitForTimeout(2500); // 초기 저장 안정화

    // 1. 브라우저에서 로컬 편집 (디바운스 시작)
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();

    // 2. 디바운스가 flush되기 전에 외부(AI)가 서버 리비전을 올림
    const res = await request.post('/api/tasks', { data: { name: '외부 우선 작업' } });
    expect(res.status()).toBe(201);

    // 3. 브라우저 저장 → 409 → 서버 상태 재로드 (외부 작업이 보여야 함)
    await expect(page.getByText('외부 우선 작업').first()).toBeVisible({ timeout: 15_000 });
});

// 저장 실패는 2026-08-11 까지 console.warn 하나로 끝났다 — 화면에 표시도, 재시도도
// 없었다. 사용자는 저장됐다고 믿고 편집을 멈추고, 다음 로드는 서버 우선이라 낡은
// 데이터가 localStorage 캐시까지 덮는다. 판정 규칙은 syncStatus 단위테스트가 고정하고,
// 여기서는 실제 DOM 에서 드러나는지·복구되는지만 본다.
const indicator = (page) => page.getByTestId('sync-indicator');
const breakSaving = (page) =>
    page.route('**/api/projects/*/data', route =>
        route.request().method() === 'POST' ? route.abort('failed') : route.continue());

test('서버 저장 실패가 화면에 드러나고, 재시도로 복구된다', async ({ page }) => {
    await page.waitForTimeout(2500); // 초기 자동저장 안정화
    await expect(indicator(page)).toHaveAttribute('data-sync-state', 'saved');

    // 저장(POST)만 끊는다 — 읽기·리비전 폴링은 살려 둔다
    await breakSaving(page);
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();

    // 디바운스(1.5s) 뒤 실패가 드러나야 한다. 실패 상태는 버튼이다(즉시 재시도).
    const failed = page.locator('button[data-testid="sync-indicator"][data-sync-state="error"]');
    await expect(failed).toBeVisible({ timeout: 10_000 });
    await expect(failed).toContainText('저장 실패');

    // 서버가 돌아오면 눌러서 즉시 재시도 — 백오프를 기다리지 않는다
    await page.unroute('**/api/projects/*/data');
    await failed.click();
    await expect(indicator(page)).toHaveAttribute('data-sync-state', 'saved', { timeout: 10_000 });
});

test('저장이 실패한 동안 폴링은 미저장 편집을 덮어쓰지 않는다', async ({ page, request }) => {
    // 예전에는 폴링이 dirty 여부를 보지 않고 재로드했다 — 저장이 실패한 상태에서
    // 외부 변경이 오면 내 편집이 조용히 사라졌다(재로드가 저장 에코까지 막는다).
    await page.waitForTimeout(2500);
    await breakSaving(page);

    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
    await expect(page.locator('button[data-testid="sync-indicator"][data-sync-state="error"]'))
        .toBeVisible({ timeout: 10_000 });

    // 외부(AI)가 서버 리비전을 올린다 → 폴링이 재로드하려는 조건이 성립
    expect((await request.post('/api/tasks', { data: { name: '폴링이 가져올 작업' } })).status()).toBe(201);

    // 폴링 주기(10s)를 넉넉히 넘겨도 재로드하지 않는다 — 내 편집이 살아 있어야 한다
    await page.waitForTimeout(14_000);
    await expect(page.getByText('폴링이 가져올 작업')).toHaveCount(0);
    await expect(page.locator('.task-name-item', { hasText: '새 작업' })).toBeVisible();

    // 저장 경로가 살아나면 409 로 흘러 서버 우선 재로드가 일어난다(그때는 토스트로 알린다)
    await page.unroute('**/api/projects/*/data');
    await page.locator('button[data-testid="sync-indicator"]').click();
    await expect(page.getByText('폴링이 가져올 작업').first()).toBeVisible({ timeout: 15_000 });
});
