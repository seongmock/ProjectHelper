// v1.1 기능 테스트 — 진행률, 지연 표시, 표 날짜 편집 동기화, 드래그 undo 정합성
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
    await request.post('/api/data', { data: [] }).catch(() => {});
    await page.goto('/');
    await expect(page.locator('.header-title')).toContainText('프로젝트 타임라인 관리');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
});

test.describe('진행률 (Progress)', () => {
    test('팝오버 슬라이더로 설정 → 바 오버레이 표시 → undo로 복원', async ({ page }) => {
        // 타임라인 바 우클릭 → 작업 설정 팝오버
        await page.locator('.timeline-bar').first().click({ button: 'right' });
        const slider = page.getByTestId('progress-slider');
        await expect(slider).toBeVisible();

        await slider.fill('50');
        await expect(page.locator('.bar-progress-fill').first()).toBeVisible();
        const width = await page.locator('.bar-progress-fill').first().evaluate(el => el.style.width);
        expect(width).toBe('50%');

        // 팝오버 닫고 undo → 오버레이 사라짐
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+z');
        await expect(page.locator('.bar-progress-fill')).toHaveCount(0);
    });

    test('표 뷰에 진행률 배지 표시', async ({ page }) => {
        await page.locator('.timeline-bar').first().click({ button: 'right' });
        await page.getByTestId('progress-slider').fill('75');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: '📋 표' }).click();
        await expect(page.locator('.progress-badge').first()).toHaveText('75%');
    });
});

test.describe('지연 (Overdue) 하이라이트', () => {
    test('과거 종료일 + 미완료 → overdue 표시, progress 100 → 해제 (API 경유)', async ({ page, request }) => {
        await page.waitForTimeout(2500); // 초기 자동저장 안정화

        // 외부(AI) API로 과거 일정 작업 생성
        const res = await request.post('/api/tasks', {
            data: { name: '지연된 작업', startDate: '2026-01-05', endDate: '2026-01-20' },
        });
        expect(res.status()).toBe(201);
        const { task } = await res.json();

        // 폴링 반영 후 해당 작업의 바에 overdue 클래스 확인
        // (샘플 데이터도 과거 일정이라 overdue일 수 있으므로 특정 바에 스코프)
        const bar = page.locator('.timeline-bar[title*="지연된 작업"]');
        await expect(bar).toBeVisible({ timeout: 15_000 });
        await expect(bar).toHaveClass(/overdue/);

        // progress 100 → 해당 바의 overdue 해제
        const patch = await request.patch(`/api/tasks/${task.id}`, { data: { progress: 100 } });
        expect(patch.ok()).toBeTruthy();
        await expect(bar).not.toHaveClass(/overdue/, { timeout: 15_000 });
    });
});

test.describe('표 날짜 편집 ↔ 타임라인 동기화', () => {
    test('표에서 시작일 변경 → 타임라인 바 날짜 반영', async ({ page }) => {
        await page.getByRole('button', { name: '📋 표' }).click();

        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        const startInput = row.locator('input[type="date"]').first();
        await startInput.fill('2026-01-02');

        // 타임라인으로 전환 → 바 title에 새 날짜 반영 확인
        await page.getByRole('button', { name: '📈 타임라인' }).click();
        const bar = page.locator('.timeline-bar[title*="요구사항 분석"]');
        await expect(bar).toHaveAttribute('title', /2026-01-02|2026\.01\.02/);
    });

    test('표에서 마일스톤 추가 시 유효한 날짜 부여', async ({ page }) => {
        await page.getByRole('button', { name: '📋 표' }).click();
        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        await row.getByTitle('마일스톤 관리').click();
        await page.getByRole('button', { name: '➕ 마일스톤 추가' }).click();
        // 새 마일스톤의 date input이 비어있지 않아야 함 (기존 버그: undefined)
        const dateInput = page.locator('.milestone-date-input').last();
        const value = await dateInput.inputValue();
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

test.describe('드래그 undo 정합성', () => {
    test('행 드래그 순서 변경 → Ctrl+Z 1회로 완전 복원 (접힘 상태 오염 없음)', async ({ page }) => {
        await page.getByRole('button', { name: '📋 표' }).click();

        // 기준: 첫 최상위 작업명과 자식 노출 상태
        const firstRowName = await page.locator('.task-row.level-0 .task-name').first().textContent();
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toBeVisible();

        // 드래그: 첫 행을 두 번째 최상위 행 아래로 (마우스 시뮬레이션)
        const source = page.locator('.task-row.level-0').first();
        const target = page.locator('.task-row.level-0').nth(1);
        const sBox = await source.boundingBox();
        const tBox = await target.boundingBox();
        await page.mouse.move(sBox.x + 40, sBox.y + sBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(sBox.x + 40, sBox.y + sBox.height / 2 + 10, { steps: 3 });
        await page.mouse.move(tBox.x + 40, tBox.y + tBox.height / 2 + 10, { steps: 8 });
        await page.mouse.up();

        // 순서가 실제로 변경되었는지 확인
        const movedName = await page.locator('.task-row.level-0 .task-name').first().textContent();
        expect(movedName).not.toBe(firstRowName);

        // Ctrl+Z 1회 → 원래 순서 + 자식 여전히 펼쳐져 있어야 함
        await page.keyboard.press('Control+z');
        await expect(page.locator('.task-row.level-0 .task-name').first()).toHaveText(firstRowName);
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toBeVisible();
    });
});

test.describe('툴바 레이아웃', () => {
    // P1-7 "우상단 클리핑". 툴바가 flex 한 줄인데 가로 스크롤이 없어서, 좁은 화면에서
    // 오른쪽 그룹(검색 · 작업 추가)이 잘려 나가고 접근 자체가 불가능했다.
    test('좁은 화면에서도 오른쪽 그룹이 잘리지 않는다', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 800 });

        const addButton = page.getByRole('button', { name: '➕ 새 작업' });
        const content = page.locator('.toolbar-content');

        // 스크롤이 필요하면 스크롤해서라도 닿을 수 있어야 한다
        await addButton.scrollIntoViewIfNeeded();

        const btnBox = await addButton.boundingBox();
        const barBox = await content.boundingBox();
        expect(btnBox).not.toBeNull();
        expect(btnBox.x).toBeGreaterThanOrEqual(barBox.x - 1);
        expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);

        await addButton.click();
        await expect(page.locator('.task-name-item', { hasText: '새 작업' })).toBeVisible();
    });
});
