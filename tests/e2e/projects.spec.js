// 다중 프로젝트 테스트 — 생성/전환/격리/이름변경/삭제 가드/AI 연동
// 전제: API 서버(3000) 실행 중 (없으면 자동 skip)
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page, request }) => {
    const res = await request.post('/api/data', { data: [] }).catch(() => null);
    test.skip(!res || !res.ok(), 'API 서버가 실행 중이 아님');

    // 테스트 독립성: default 외 프로젝트 전부 삭제
    const { projects } = await (await request.get('/api/projects')).json();
    for (const p of projects) {
        if (p.id !== 'default') await request.delete(`/api/projects/${p.id}`);
    }

    await page.goto('/');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
});

const openSwitcher = async (page) => {
    await page.getByTestId('project-switcher').click();
    await expect(page.locator('.project-switcher-menu')).toBeVisible();
};

const createProjectViaUI = async (page, name) => {
    await openSwitcher(page);
    await page.getByRole('button', { name: '➕ 새 프로젝트' }).click();
    await page.locator('.project-switcher-input').fill(name);
    await page.locator('.project-switcher-input').press('Enter');
    await expect(page.getByTestId('project-switcher')).toContainText(name);
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
};

test('UI로 프로젝트 생성 → 자동 전환', async ({ page }) => {
    await createProjectViaUI(page, '프로젝트 B');
    // 새 프로젝트는 빈 상태 (샘플 아님 — 서버가 빈 배열로 초기화)
    await expect(page.locator('.timeline-bar')).toHaveCount(0);
});

test('프로젝트 간 데이터 격리 + 전환 왕복', async ({ page }) => {
    // default에 작업 추가 (표 뷰에서 이름 확인 가능하게)
    await page.getByRole('button', { name: '📋 표' }).click();
    await page.getByRole('button', { name: '➕ 새 작업' }).click();
    const row = page.locator('.task-row', { hasText: '새 작업' }).first();
    await row.locator('.task-name').dblclick();
    await page.locator('input.name-input').fill('A전용 작업');
    await page.locator('input.name-input').press('Enter');
    await page.waitForTimeout(2000); // 디바운스 flush 대기

    // B 생성/전환 → A의 작업이 보이지 않아야 함
    await createProjectViaUI(page, '프로젝트 B');
    await expect(page.getByText('A전용 작업')).toHaveCount(0);

    // 다시 default로 → 작업 복귀
    await openSwitcher(page);
    await page.locator('.project-switcher-item-name', { hasText: '기본 프로젝트' }).click();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByText('A전용 작업').first()).toBeVisible();
});

test('전환 후 Ctrl+Z가 이전 프로젝트 상태를 복원하지 않음 (히스토리 리셋)', async ({ page }) => {
    // default에서 편집 발생 (undo 히스토리 생성)
    await page.getByRole('button', { name: '📋 표' }).click();
    await page.getByRole('button', { name: '➕ 새 작업' }).click();
    await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();

    // B로 전환 후 Ctrl+Z → 아무 일도 없어야 함 (B는 빈 프로젝트 유지)
    await createProjectViaUI(page, '프로젝트 B');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await expect(page.locator('.task-row')).toHaveCount(0);
});

test('프로젝트 이름 변경 → 새로고침 후에도 유지', async ({ page }) => {
    await createProjectViaUI(page, '이름변경 대상');
    await openSwitcher(page);
    const item = page.locator('.project-switcher-item', { hasText: '이름변경 대상' });
    await item.hover();
    await item.getByTitle('이름 변경').click();
    await page.locator('.project-switcher-input').fill('변경된 이름');
    await page.locator('.project-switcher-input').press('Enter');
    await expect(page.getByTestId('project-switcher')).toContainText('변경된 이름');

    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByTestId('project-switcher')).toContainText('변경된 이름');
});

test('삭제 가드: 마지막 프로젝트 삭제 불가 + 활성 프로젝트 삭제 시 자동 전환', async ({ page }) => {
    // 프로젝트 1개(default)일 때 삭제 버튼 비활성
    await openSwitcher(page);
    const defaultItem = page.locator('.project-switcher-item', { hasText: '기본 프로젝트' });
    await defaultItem.hover();
    await expect(defaultItem.locator('button[title*="삭제"]')).toBeDisabled();
    await page.keyboard.press('Escape');

    // B 생성(활성) 후 삭제 → default로 자동 전환
    await createProjectViaUI(page, '삭제될 프로젝트');
    page.on('dialog', (d) => d.accept());
    await openSwitcher(page);
    const target = page.locator('.project-switcher-item', { hasText: '삭제될 프로젝트' });
    await target.hover();
    await target.getByTitle('삭제').click();
    await expect(page.getByTestId('project-switcher')).toContainText('기본 프로젝트');
});

test('AI가 REST로 만든 프로젝트+계획 → 드롭다운에서 전환해 확인', async ({ page, request }) => {
    // 외부(AI)가 프로젝트 생성 + 계획 주입
    const created = await (await request.post('/api/projects', { data: { name: 'AI 프로젝트' } })).json();
    const pid = created.project.id;
    await request.post(`/api/projects/${pid}/tasks`, {
        data: { name: 'AI가 만든 계획', startDate: '2026-08-01', endDate: '2026-08-20' },
    });

    // 드롭다운 열기 → 목록 refetch로 AI 프로젝트 표시 → 전환
    await openSwitcher(page);
    await page.locator('.project-switcher-item-name', { hasText: 'AI 프로젝트' }).click();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByText('AI가 만든 계획').first()).toBeVisible();
});
