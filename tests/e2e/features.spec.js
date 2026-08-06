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

        await page.getByTitle('표 뷰').click();
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
        await page.getByTitle('표 뷰').click();

        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        const startInput = row.locator('input[type="date"]').first();
        await startInput.fill('2026-01-02');

        // 타임라인으로 전환 → 바 title에 새 날짜 반영 확인
        await page.getByTitle('타임라인 뷰').click();
        const bar = page.locator('.timeline-bar[title*="요구사항 분석"]');
        await expect(bar).toHaveAttribute('title', /2026-01-02|2026\.01\.02/);
    });

    test('표에서 마일스톤 추가 시 유효한 날짜 부여', async ({ page }) => {
        await page.getByTitle('표 뷰').click();
        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        await row.getByTitle('마일스톤 관리').click();
        await page.getByRole('button', { name: '마일스톤 추가' }).click();
        // 새 마일스톤의 date input이 비어있지 않아야 함 (기존 버그: undefined)
        const dateInput = page.locator('.milestone-date-input').last();
        const value = await dateInput.inputValue();
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

test.describe('드래그 undo 정합성', () => {
    test('행 드래그 순서 변경 → Ctrl+Z 1회로 완전 복원 (접힘 상태 오염 없음)', async ({ page }) => {
        await page.getByTitle('표 뷰').click();

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

test.describe('상태 색상 모드', () => {
    // 실사 §5.2 "범례 없음": 기본 모드의 색은 사용자가 고른 그룹 구분일 뿐이라 해석할
    // 방법이 없었다. 상태 색상 모드는 색을 일정 상태에 고정하고 범례를 함께 띄운다.
    const STATUS_RGB = [
        'rgb(46, 158, 107)',  // 완료
        'rgb(59, 130, 246)',  // 진행중
        'rgb(152, 162, 179)', // 예정
        'rgb(217, 83, 79)',   // 지연
    ];

    test('상태 색상을 고르면 범례가 뜨고 바 색이 상태색으로 바뀐다', async ({ page }) => {
        const legend = page.locator('.timeline-legend');
        await expect(legend).toHaveCount(0);

        const bar = page.locator('.timeline-bar').first();
        const before = await bar.evaluate(el => getComputedStyle(el).backgroundColor);

        await page.getByTitle('표시 옵션').click();
        await page.getByRole('menuitemradio', { name: '상태 색상' }).click();
        await page.keyboard.press('Escape');

        await expect(legend).toBeVisible();
        await expect(legend).toContainText('지연');
        expect(STATUS_RGB).toContain(
            await bar.evaluate(el => getComputedStyle(el).backgroundColor));

        // 설정은 전역(프로젝트 스코프 밖)이라 되돌리지 않으면 다른 테스트로 샌다
        await page.getByTitle('표시 옵션').click();
        await page.getByRole('menuitemradio', { name: '작업 색상' }).click();
        await page.keyboard.press('Escape');

        await expect(legend).toHaveCount(0);
        expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(before);
    });
});

test.describe('키보드 일정 편집', () => {
    // 실사 §5.3: 바가 마우스 드래그 전용이라 키보드만으로는 일정을 바꿀 수 없었다.
    test('↑↓ 로 선택하고 [ ] 로 일정을 옮긴다', async ({ page }) => {
        await page.getByTitle('표 뷰').click();

        // 마우스 없이 진입 — 선택이 없을 때 ↓ 는 첫 작업을 잡는다
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.task-row.selected')).toContainText('프로젝트 기획');
        await page.keyboard.press('ArrowDown');
        const selected = page.locator('.task-row.selected');
        await expect(selected).toContainText('요구사항 분석');

        const startInput = selected.locator('input[type="date"]').first();
        await expect(startInput).toHaveValue('2026-01-06');

        await page.keyboard.press(']');
        await expect(startInput).toHaveValue('2026-01-07');

        // Shift 는 일주일 단위 — 연 경계를 넘는 계산까지 확인한다
        await page.keyboard.press('Shift+BracketLeft');
        await expect(startInput).toHaveValue('2025-12-31');

        // 되돌릴 수 있어야 한다 (한 번에 한 단계씩 히스토리에 남는다)
        await page.keyboard.press('Control+z');
        await expect(startInput).toHaveValue('2026-01-07');
    });

    test('Alt+[ ] 는 종료일만 조정한다', async ({ page }) => {
        await page.getByTitle('표 뷰').click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');

        const selected = page.locator('.task-row.selected');
        const [startInput, endInput] = [
            selected.locator('input[type="date"]').first(),
            selected.locator('input[type="date"]').nth(1),
        ];
        await expect(endInput).toHaveValue('2026-01-20');

        await page.keyboard.press('Alt+BracketRight');
        await expect(endInput).toHaveValue('2026-01-21');
        await expect(startInput).toHaveValue('2026-01-06');
    });
});

test.describe('툴바 레이아웃', () => {
    // P1-7 "우상단 클리핑". 툴바가 flex 한 줄인데 가로 스크롤이 없어서, 좁은 화면에서
    // 오른쪽 그룹(검색 · 작업 추가)이 잘려 나가고 접근 자체가 불가능했다.
    test('좁은 화면에서도 오른쪽 그룹이 잘리지 않는다', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 800 });

        const addButton = page.getByTitle('새 작업 추가 (Ctrl+N)');
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

test.describe('인스펙터 패널', () => {
    // 실사 §5.4-12 / P3-5. 그전까지 작업 편집은 전부 우클릭 팝오버여서, 존재를 모르면
    // 열 수 없고 선택과 연결돼 있지도 않았다.
    test('선택을 따라가며 요약을 보여 주고 거기서 편집한다', async ({ page }) => {
        await page.getByTitle('표 뷰').click();

        const panel = page.locator('.inspector-panel');
        await expect(panel).toHaveCount(0);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('작업을 선택하면');

        // 키보드 선택을 그대로 따라간다
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(page.getByTestId('inspector-name')).toHaveValue('요구사항 분석');
        await expect(page.getByTestId('inspector-dates')).toHaveText('2026-01-06 ~ 2026-01-20');
        await expect(page.getByTestId('inspector-status')).toHaveText('지연');

        // 진행률 편집 → 표에 즉시 반영
        await page.getByTestId('inspector-progress').fill('60');
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' }).first()
            .locator('.progress-badge')).toHaveText('60%');

        // 이름은 Enter/blur 에 커밋된다 — 글자마다 커밋하면 undo 히스토리가 타이핑으로 찬다
        const nameField = page.getByTestId('inspector-name');
        await nameField.fill('요구사항 재정의');
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toHaveCount(1);
        await nameField.press('Enter');
        await expect(page.locator('.task-row', { hasText: '요구사항 재정의' })).toHaveCount(1);

        // 그래서 되돌리기 한 번이면 이름 편집 전체가 복원된다
        await page.keyboard.press('Control+z');
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toHaveCount(1);

        // 설정은 전역(프로젝트 스코프 밖)이라 되돌리지 않으면 다른 테스트로 샌다
        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });
});
