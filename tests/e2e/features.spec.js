// v1.1 기능 테스트 — 진행률, 지연 표시, 표 날짜 편집 동기화, 드래그 undo 정합성
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
    await request.post('/api/data', { data: [] }).catch(() => {});
    await page.goto('/');
    await expect(page.locator('.header-title')).toContainText('프로젝트 타임라인 관리');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
});

test.describe('진행률 (Progress)', () => {
    // v2 부터 우클릭은 팝오버를 띄우지 않고 인스펙터를 연다(P3-5).
    // showInspector 는 **전역 설정**이라 각 테스트가 끝에서 반드시 되돌린다.
    test('인스펙터 슬라이더로 설정 → 바 오버레이 표시 → undo로 복원', async ({ page }) => {
        await page.locator('.timeline-bar').first().click({ button: 'right' });
        const slider = page.getByTestId('inspector-progress');
        await expect(slider).toBeVisible();

        await slider.fill('50');
        await expect(page.locator('.bar-progress-fill').first()).toBeVisible();
        const width = await page.locator('.bar-progress-fill').first().evaluate(el => el.style.width);
        expect(width).toBe('50%');

        await page.keyboard.press('Control+z');
        await expect(page.locator('.bar-progress-fill')).toHaveCount(0);

        await page.getByTitle('인스펙터 패널').click();
        await expect(page.locator('.inspector-panel')).toHaveCount(0);
    });

    test('표 뷰에 진행률 배지 표시', async ({ page }) => {
        await page.locator('.timeline-bar').first().click({ button: 'right' });
        await page.getByTestId('inspector-progress').fill('75');

        await page.getByTitle('표 뷰').click();
        await expect(page.locator('.progress-badge').first()).toHaveText('75%');

        await page.getByTitle('인스펙터 패널').click();
        await expect(page.locator('.inspector-panel')).toHaveCount(0);
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

    // 역전된 기간(종료 < 시작)은 폭 0 이라 타임라인에서 **아무것도 보이지 않는다**.
    // 마우스 리사이즈는 경계에서 멈추고 키보드는 종료일을 맞추고 서버는 400 으로 거부하는데,
    // 타이핑만 그대로 통과했다 — 방금 넣은 날짜 때문에 바가 사라지는 것처럼 보였다.
    test('종료일을 시작일 앞으로 보내면 시작일로 되돌아가고 바가 남는다', async ({ page }) => {
        await page.getByTitle('표 뷰').click();

        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        const endInput = row.locator('input[type="date"]').nth(1);
        await endInput.fill('2026-01-01'); // 시작일(2026-01-06)보다 앞

        // 되돌리는 것은 방금 편집한 종료일뿐 — 손대지 않은 시작일은 그대로다
        await expect(endInput).toHaveValue('2026-01-06');
        await expect(row.locator('input[type="date"]').first()).toHaveValue('2026-01-06');

        await page.getByTitle('타임라인 뷰').click();
        const bar = page.locator('.timeline-bar[title^="요구사항 분석 ("]');
        const box = await bar.boundingBox();
        expect(box.width).toBeGreaterThan(0); // 역전됐다면 0px 였다
    });
});

// v4: 표가 갖고 있던 "마일스톤 관리" 모달을 폐기하고 인스펙터로 흡수했다. 표의 칼럼은
// 이제 읽기(미리보기) + 지목만 한다 — 타임라인 마일스톤 우클릭과 같은 경로다.
// showInspector 는 전역 설정이라 각 테스트가 끝에서 되돌린다.
test.describe('표 마일스톤 칼럼 → 인스펙터', () => {
    const dateLike = /^\d{4}-\d{2}-\d{2}$/;

    test('미리보기를 누르면 그 작업을 선택하고 첫 마일스톤을 지목한다 (표 자체 모달은 없다)', async ({ page }) => {
        await page.getByTitle('표 뷰').click();
        const row = page.locator('.task-row', { hasText: '프로젝트 기획' }).first();
        await row.getByTitle('마일스톤 — 인스펙터에서 편집').click();

        const panel = page.locator('.inspector-panel');
        await expect(panel).toBeVisible();
        await expect(page.locator('.milestone-manager')).toHaveCount(0); // 폐기한 모달
        await expect(page.getByTestId('inspector-name')).toHaveValue('프로젝트 기획');

        const focused = panel.locator('.inspector-milestone.is-focused');
        await expect(focused).toHaveCount(1);
        await expect(focused).toBeInViewport();
        await expect(panel.getByTestId('inspector-milestone-label').first()).toHaveValue('초안 완료');

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });

    test('마일스톤 없는 작업 → 인스펙터에서 추가, 유효한 날짜가 붙고 표 미리보기에 반영', async ({ page }) => {
        await page.getByTitle('표 뷰').click();
        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        await row.getByTitle('마일스톤 — 인스펙터에서 편집').click();

        const panel = page.locator('.inspector-panel');
        await expect(page.getByTestId('inspector-name')).toHaveValue('요구사항 분석');
        await expect(panel.getByTestId('inspector-milestone')).toHaveCount(0);

        await panel.getByTestId('inspector-add-milestone').click();
        // 추가 모달의 날짜는 미리 채워져 있어야 한다 (과거 버그: undefined 가 들어갔다)
        const quickAdd = page.locator('.modal-overlay', { hasText: '마일스톤 추가' });
        await expect(quickAdd.locator('input[type="date"]')).toHaveValue(dateLike);
        await quickAdd.getByRole('button', { name: '추가' }).click();

        await expect(panel.getByTestId('inspector-milestone')).toHaveCount(1);
        await expect(panel.getByTestId('inspector-milestone-date')).toHaveValue(dateLike);
        await expect(row.locator('.milestone-shape-preview')).toHaveCount(1);

        await page.keyboard.press('Control+z');
        await expect(panel.getByTestId('inspector-milestone')).toHaveCount(0);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
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

    // v2: TimelineBarPopover 를 이 패널이 흡수하고 폐기했다. 우클릭은 팝오버가 아니라
    // "선택 + 인스펙터 열기 + 지목한 기간 강조"가 된다.
    test('우클릭이 인스펙터를 열고 그 기간을 강조하며, 기간 편집을 여기서 한다', async ({ page }) => {
        const panel = page.locator('.inspector-panel');
        await expect(panel).toHaveCount(0);

        await page.locator('.timeline-bar').first().click({ button: 'right' });
        await expect(panel).toBeVisible();
        await expect(page.locator('.timeline-popover')).toHaveCount(0); // 팝오버는 더 이상 없다
        await expect(panel.locator('.inspector-range.is-focused')).toHaveCount(1);

        // 기간의 종료일을 늘리면 작업 전체 bounds 가 함께 재계산된다
        await panel.getByTestId('inspector-range-end').first().fill('2026-03-15');
        await expect(page.getByTestId('inspector-dates')).toContainText('~ 2026-03-15');

        // 기간 추가 → 2개, undo 로 원복
        await panel.getByTestId('inspector-add-range').click();
        await expect(panel.getByTestId('inspector-range')).toHaveCount(2);
        await page.keyboard.press('Control+z');
        await expect(panel.getByTestId('inspector-range')).toHaveCount(1);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });

    // v3: MilestoneEditPopover 도 흡수·폐기했다. 선택 단위는 여전히 작업 하나이고,
    // 마일스톤은 기간과 마찬가지로 "그 작업 안에서 지목한 항목"이다.
    test('마일스톤 우클릭이 인스펙터에서 그 마일스톤을 열고, 편집·삭제를 여기서 한다', async ({ page }) => {
        const panel = page.locator('.inspector-panel');
        const marker = page.locator('.milestone-marker').first();

        await marker.click({ button: 'right' });
        await expect(panel).toBeVisible();
        await expect(page.locator('.milestone-popover')).toHaveCount(0); // 팝오버는 더 이상 없다

        // 선택은 마일스톤이 아니라 그 소유 작업으로 간다
        await expect(page.getByTestId('inspector-name')).toHaveValue('프로젝트 기획');
        const focused = panel.locator('.inspector-milestone.is-focused');
        await expect(focused).toHaveCount(1);
        // 마일스톤 구역은 패널 아래쪽이라 열기만 해서는 화면 밖이다 — 지목한 카드까지 스크롤한다
        await expect(focused).toBeInViewport();

        // 날짜 편집 → 타임라인 마커에 즉시 반영 (title = "라벨 (날짜)")
        await panel.getByTestId('inspector-milestone-date').first().fill('2026-01-27');
        await expect(marker).toHaveAttribute('title', '초안 완료 (2026-01-27)');

        // 이름은 기간 라벨과 같이 Enter/blur 커밋이다
        const label = panel.getByTestId('inspector-milestone-label').first();
        await label.fill('초안 확정');
        await label.press('Enter');
        await expect(marker).toHaveAttribute('title', '초안 확정 (2026-01-27)');

        // 삭제 → undo 로 복원
        page.on('dialog', (d) => d.accept());
        await panel.getByLabel('마일스톤 삭제').first().click();
        await expect(panel.getByTestId('inspector-milestone')).toHaveCount(0);
        await page.keyboard.press('Control+z');
        await expect(panel.getByTestId('inspector-milestone')).toHaveCount(1);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });

    // 표와 같은 규칙이 여기에도 적용된다 — 기간을 고치는 경로가 patchRange 하나이기 때문이다.
    test('시작일을 종료일 뒤로 보내면 종료일로 되돌아간다', async ({ page }) => {
        const panel = page.locator('.inspector-panel');
        await page.locator('.timeline-bar[title^="요구사항 분석 ("]').click({ button: 'right' });
        await expect(panel).toBeVisible();

        const start = panel.getByTestId('inspector-range-start').first();
        const end = panel.getByTestId('inspector-range-end').first();
        await start.fill('2026-02-01'); // 종료일(2026-01-20)보다 뒤

        await expect(start).toHaveValue('2026-01-20');
        await expect(end).toHaveValue('2026-01-20');
        await expect(panel.getByTestId('inspector-range-invalid')).toHaveCount(0);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });

    // 이 화면을 거치지 않은 쓰기(blob POST·가져오기·과거 데이터)는 여전히 역전된 기간을
    // 남길 수 있다. 타임라인에서는 폭 0 이라 아무것도 안 보이므로 여기서 말해 주지 않으면
    // 왜 바가 없는지 알 방법이 없다.
    test('이 화면을 거치지 않은 쓰기가 남긴 역전된 기간을 알려 준다', async ({ page, request }) => {
        await page.waitForTimeout(2500); // 초기 저장 안정화
        const { data } = await (await request.get('/api/data')).json();
        const target = data.find(t => (t.timeRanges || []).length > 0);
        target.timeRanges[0].endDate = '2020-01-01';
        expect((await request.post('/api/data', { data })).ok()).toBe(true);

        await page.reload();
        await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);

        const panel = page.locator('.inspector-panel');
        await page.locator('.task-name-item', { hasText: target.name }).first().click();
        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toBeVisible();
        await expect(panel.getByTestId('inspector-range-invalid')).toHaveCount(1);

        // 어느 한쪽만 고쳐도 역전이 풀린다
        await panel.getByTestId('inspector-range-end').first().fill('2026-03-01');
        await expect(panel.getByTestId('inspector-range-invalid')).toHaveCount(0);

        await page.getByTitle('인스펙터 패널').click();
        await expect(panel).toHaveCount(0);
    });
});

test.describe('명령 팔레트 (Ctrl+K)', () => {
    // 실사 §5.4-13. 팔레트가 실행하는 것은 전부 이미 툴바·헤더에 있는 핸들러다 —
    // 여기서 확인하는 것은 "이름으로 찾아 Enter 로 실행된다"는 경로 자체다.
    const input = (page) => page.getByTestId('command-palette-input');

    test('툴바 버튼과 Ctrl+K 로 열리고 Esc 로 닫힌다', async ({ page }) => {
        await page.getByTitle('명령 팔레트 (Ctrl+K)').click();
        await expect(input(page)).toBeFocused();
        // 질의가 비어 있으면 명령만 — 작업까지 나열하면 명령이 묻힌다
        await expect(page.getByTestId('command-item').first()).toContainText('새 작업 추가');

        await page.keyboard.press('Escape');
        await expect(input(page)).toHaveCount(0);

        await page.keyboard.press('Control+k');
        await expect(input(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(input(page)).toHaveCount(0);
    });

    // 팔레트는 열 때마다 새로 마운트된다 — 질의를 effect 로 비우던 예전 구조는 열고 곧바로
    // 친 글자를 지웠다. 이전 질의가 남는 것도 안 된다(첫 Enter 가 엉뚱한 명령을 실행한다).
    test('다시 열면 질의가 비어 있다', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await input(page).fill('다크');
        await expect(page.getByTestId('command-item')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+k');
        await expect(input(page)).toHaveValue('');
    });

    test('이름으로 명령을 찾아 Enter 로 실행한다', async ({ page }) => {
        // 다크 모드는 **전역 설정**이다 — 시작값을 단정하지 말고(다른 스펙이 먼저 건드릴 수
        // 있다) 뒤집혔다가 되돌아오는 것만 본다.
        const html = page.locator('html');
        const before = await html.getAttribute('data-theme');
        const flipped = before === 'dark' ? 'light' : 'dark';

        await page.keyboard.press('Control+k');
        await input(page).fill('다크');
        await expect(page.getByTestId('command-item')).toHaveCount(1);
        // 토글 명령은 현재 상태를 함께 보여 준다
        await expect(page.getByTestId('command-item').first())
            .toContainText(before === 'dark' ? '켜짐' : '꺼짐');

        await page.keyboard.press('Enter');
        await expect(input(page)).toHaveCount(0); // 실행하면 닫힌다
        await expect(html).toHaveAttribute('data-theme', flipped);

        await page.keyboard.press('Control+k');
        await input(page).fill('다크');
        await expect(page.getByTestId('command-item').first())
            .toContainText(flipped === 'dark' ? '켜짐' : '꺼짐');
        await page.keyboard.press('Enter');
        await expect(html).toHaveAttribute('data-theme', before);
    });

    test('접힌 부모 아래 작업으로 이동하면 조상을 펼치고 선택한다', async ({ page }) => {
        await page.getByTitle('표 뷰').click();

        const parent = page.locator('.task-row', { hasText: '프로젝트 기획' }).first();
        await parent.locator('.expand-toggle').click();
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toHaveCount(0);

        await page.keyboard.press('Control+k');
        await input(page).fill('요구사항');
        const first = page.getByTestId('command-item').first();
        await expect(first).toContainText('요구사항 분석');
        await expect(first).toContainText('프로젝트 기획'); // 부모 경로가 hint 로 붙는다
        await page.keyboard.press('Enter');

        const row = page.locator('.task-row', { hasText: '요구사항 분석' });
        await expect(row).toBeVisible();
        await expect(row).toHaveClass(/selected/);
    });
});

test.describe('의존성 정합성', () => {
    // 이 세 가지는 그전까지 아무도 말해 주지 않았다: 순환(A→B→A)을 만들 수 있었고,
    // 후행이 선행 종료보다 먼저 시작해도 화살표는 똑같이 회색이었고, 선행 작업을 지우면
    // 상대의 dependencies 에 존재하지 않는 id 가 조용히 남았다.
    // 판정은 taskTree.js 의 findDependencyIssues 하나가 한다(단위테스트가 규칙을 고정한다).
    //
    // 샘플 데이터: 설계 문서 작성(~2026-02-15) / 개발(2026-02-10~) → 5일 겹친다.
    const bar = (page, name) => page.locator(`.timeline-bar[title^="${name} ("]`);

    // 설계 문서 작성 → 개발 을 잇는다(= 위반이 되는 연결)
    const linkOverlapping = async (page) => {
        await bar(page, '설계 문서 작성').click({ button: 'right' });
        await expect(page.locator('.inspector-panel')).toBeVisible();
        await page.getByTestId('inspector-link').click();
        await bar(page, '개발').click();
        await expect(page.locator('.dependency-layer path')).toHaveCount(1);
    };

    // showInspector 는 전역 설정이라 각 테스트가 끝에서 되돌린다
    const closeInspector = async (page) => {
        await page.getByTitle('인스펙터 패널').click();
        await expect(page.locator('.inspector-panel')).toHaveCount(0);
    };

    test('후행이 선행 종료보다 먼저 시작하면 화살표와 인스펙터가 위반을 알린다', async ({ page }) => {
        await linkOverlapping(page);
        await expect(page.getByTestId('dependency-overlap')).toHaveCount(1);
        await expect(page.getByTestId('dependency-ok')).toHaveCount(0);

        // 후행 쪽에서 보면 선행 목록에 배지가 붙는다 — 화살표만으로는 무엇이 문제인지 모른다
        await bar(page, '개발').click({ button: 'right' });
        await expect(page.locator('.inspector-issue.is-overlap')).toHaveCount(1);

        // 겹침을 없애면(후행 시작을 선행 종료 다음날로) 경고가 사라진다
        await page.getByTestId('inspector-range-start').first().fill('2026-02-16');
        await expect(page.getByTestId('dependency-overlap')).toHaveCount(0);
        await expect(page.getByTestId('dependency-ok')).toHaveCount(1);
        await expect(page.locator('.inspector-issue')).toHaveCount(0);

        await closeInspector(page);
    });

    test('순환이 되는 연결은 만들어지기 전에 막는다', async ({ page }) => {
        await linkOverlapping(page); // 설계 → 개발

        // 반대 방향으로 이으면 고리가 닫힌다
        await bar(page, '개발').click({ button: 'right' });
        await page.getByTestId('inspector-link').click();
        await bar(page, '설계 문서 작성').click();

        await expect(page.locator('.toast--error')).toContainText('순환');
        // 화살표가 늘지 않았다 = 데이터에 순환이 들어가지 않았다
        await expect(page.locator('.dependency-layer path')).toHaveCount(1);

        await closeInspector(page);
    });

    test('선행 작업을 지워도 끊어진 참조가 남지 않는다', async ({ page }) => {
        await linkOverlapping(page); // 설계 → 개발

        // 삭제는 지운 작업(과 그 기간·마일스톤)을 가리키던 참조까지 함께 걷어낸다.
        page.once('dialog', d => d.accept());
        await bar(page, '설계 문서 작성').click({ button: 'right' });
        await page.getByTestId('inspector-delete').click();
        await expect(page.locator('.dependency-layer path')).toHaveCount(0);

        await bar(page, '개발').click({ button: 'right' });
        await expect(page.getByTestId('inspector-broken-refs')).toHaveCount(0);

        // undo 한 번에 작업과 참조가 함께 돌아온다 — 두 번의 트리 변경이었다면 못 돌아온다
        await page.keyboard.press('Control+z');
        await expect(page.locator('.dependency-layer path')).toHaveCount(1);

        await closeInspector(page);
    });

    test('이 화면을 거치지 않은 쓰기가 남긴 끊어진 참조는 인스펙터에서 정리한다', async ({ page, request }) => {
        // 삭제 경로는 더 이상 끊어진 참조를 만들지 않는다(위 테스트). 그래도 정리 수단은
        // 남아 있어야 한다 — blob POST /api/data 는 순환·끊어진 참조를 막지 않고(브라우저의
        // 저장 경로이기도 하다), 2026-08-10 이전 데이터에도 남아 있을 수 있다.
        await page.waitForTimeout(2500); // 초기 저장 안정화
        const { data } = await (await request.get('/api/data')).json();
        const target = data.find(t => (t.timeRanges || []).length > 0);
        target.timeRanges[0].dependencies = ['사라진-id'];
        expect((await request.post('/api/data', { data })).ok()).toBe(true);

        await page.reload();
        await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
        await bar(page, target.name).click({ button: 'right' });

        const broken = page.getByTestId('inspector-broken-refs');
        await expect(broken).toBeVisible();
        await broken.getByLabel('끊어진 참조 정리').click();
        await expect(page.getByTestId('inspector-broken-refs')).toHaveCount(0);

        await closeInspector(page);
    });
});

test.describe('모달 포커스 관리 (접근성)', () => {
    // 실사 §5.3. 판정 규칙은 focusTrap 단위테스트가 고정하고, 여기서는 실제 DOM 에서
    // 세 가지가 성립하는지만 본다: 안으로 들어간다 · 안에서 돈다 · 원래 자리로 돌아온다.
    // 검사 대상은 공용 Modal 껍데기다(모달 5종이 전부 이것을 쓴다).
    const trigger = (page) => page.getByTitle('스냅샷 관리');

    test('열면 포커스가 안으로 들어가고 닫으면 열었던 버튼으로 돌아온다', async ({ page }) => {
        await trigger(page).click();
        await expect(page.locator('.modal-content')).toBeVisible();
        // 첫 후보는 헤더의 닫기 버튼이다
        await expect(page.locator('.modal-close')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-content')).toHaveCount(0);
        // 돌려주지 않으면 포커스가 <body> 로 떨어져 다음 Tab 이 페이지 맨 위에서 시작한다
        await expect(trigger(page)).toBeFocused();
    });

    test('Tab 이 모달 안에서 돌고 배경으로 새지 않는다', async ({ page }) => {
        await trigger(page).click();
        await expect(page.locator('.modal-close')).toBeFocused();

        // 첫 후보에서 뒤로 → 마지막 후보(푸터의 닫기). 그 사이 후보 수는 스냅샷 개수에
        // 따라 달라지므로 개수를 단정하지 않고 양 끝만 본다.
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('.modal-footer button')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('.modal-close')).toBeFocused();

        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
        const stillInside = await page.evaluate(
            () => !!document.activeElement?.closest('.modal-overlay')
        );
        expect(stillInside).toBe(true);

        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-content')).toHaveCount(0);
    });

    test('자식이 Tab 을 쓰는 모달에서는 가두기가 비켜 준다 (명령 팔레트)', async ({ page }) => {
        // 팔레트는 Tab 을 목록 이동으로 쓴다(preventDefault). 가두기가 이것을 가로채면
        // 포커스가 검색창을 떠나 첫 후보로 튀고 타이핑이 끊긴다.
        await page.keyboard.press('Control+k');
        const items = page.getByTestId('command-item');
        await expect(items.first()).toHaveClass(/active/);

        await page.keyboard.press('Tab');
        await expect(items.nth(1)).toHaveClass(/active/);
        await expect(page.getByTestId('command-palette-input')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('command-palette-input')).toHaveCount(0);
    });
});
