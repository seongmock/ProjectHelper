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

test('편집 충돌(409) → 서버 우선으로 자동 재로드', async ({ page, request }) => {
    await page.waitForTimeout(2500); // 초기 저장 안정화

    // 1. 브라우저에서 로컬 편집 (디바운스 시작)
    await page.getByRole('button', { name: '➕ 새 작업' }).click();

    // 2. 디바운스가 flush되기 전에 외부(AI)가 서버 리비전을 올림
    const res = await request.post('/api/tasks', { data: { name: '외부 우선 작업' } });
    expect(res.status()).toBe(201);

    // 3. 브라우저 저장 → 409 → 서버 상태 재로드 (외부 작업이 보여야 함)
    await expect(page.getByText('외부 우선 작업').first()).toBeVisible({ timeout: 15_000 });
});
