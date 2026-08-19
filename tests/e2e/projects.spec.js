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

// 관리(이름 변경·삭제)는 드롭다운이 아니라 프로젝트 관리 모달에 있다 — 되돌릴 수 없는
// 동작을 hover 로만 보이는 아이콘 + 브라우저 confirm 으로 처리하던 것을 옮겼다.
const openManager = async (page, tab = 'projects') => {
    if (tab === 'projects') {
        await page.getByTestId('project-switcher').click();
        await page.getByTestId('project-switcher-manage').click();
    } else {
        await page.getByTitle('프로젝트 관리').click();
    }
    await expect(page.getByTestId(`pm-panel-${tab}`)).toBeVisible();
};

const createProjectViaUI = async (page, name) => {
    await openSwitcher(page);
    await page.getByRole('button', { name: '새 프로젝트' }).click();
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
    await page.getByTitle('표 뷰').click();
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
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
    await page.getByTitle('표 뷰').click();
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
    await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();

    // B로 전환 후 Ctrl+Z → 아무 일도 없어야 함 (B는 빈 프로젝트 유지)
    await createProjectViaUI(page, '프로젝트 B');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await expect(page.locator('.task-row')).toHaveCount(0);
});

test('프로젝트 이름 변경 → 새로고침 후에도 유지', async ({ page }) => {
    await createProjectViaUI(page, '이름변경 대상');
    await openManager(page);
    const row = page.getByTestId('pm-project-row').filter({ hasText: '이름변경 대상' });
    await row.getByTitle('이름 변경').click();
    await page.getByTestId('pm-project-rename-input').fill('변경된 이름');
    await page.getByTestId('pm-project-rename-input').press('Enter');
    await expect(page.getByTestId('project-switcher')).toContainText('변경된 이름');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByTestId('project-switcher')).toContainText('변경된 이름');
});

test('삭제 가드: 마지막 프로젝트 삭제 불가 + 활성 프로젝트 삭제 시 자동 전환', async ({ page }) => {
    // 프로젝트 1개(default)일 때 삭제 버튼 비활성
    await openManager(page);
    const defaultRow = page.getByTestId('pm-project-row').filter({ hasText: '기본 프로젝트' });
    await expect(defaultRow.locator('button[title*="삭제"]')).toBeDisabled();
    await page.keyboard.press('Escape');

    // B 생성(활성) 후 삭제 → default로 자동 전환.
    // 확인은 브라우저 dialog 가 아니라 행 안에서 받는다 — 무엇을 지우는지 화면에 남는다.
    await createProjectViaUI(page, '삭제될 프로젝트');
    await openManager(page);
    const target = page.getByTestId('pm-project-row').filter({ hasText: '삭제될 프로젝트' });
    await target.locator('button[title="삭제"]').click();
    await expect(target.getByTestId('pm-confirm')).toContainText('되돌릴 수 없다');
    await target.getByTestId('pm-confirm-yes').click();
    await expect(page.getByTestId('project-switcher')).toContainText('기본 프로젝트');
    await page.keyboard.press('Escape');
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

// 버전(스냅샷)은 "프로젝트"가 아니라 **현재 프로젝트의 시점 사본**이다. 예전 모달은 둘을
// 같은 이름으로 불러서(''X' 프로젝트를 덮어쓰시겠습니까?') 헤더의 `+ 새 프로젝트` 와
// 구별되지 않았다 — 그래서 같은 모달의 다른 탭으로 세우고 문구를 갈랐다.
test('버전 탭: 현재 상태를 저장하고 그 시점으로 복원한다', async ({ page, request }) => {
    // 이전 테스트가 남긴 버전을 지운다 (스냅샷은 data 초기화에 딸려 오지 않는다)
    const { data: existing } = await (await request.get('/api/snapshots')).json();
    for (const s of existing || []) {
        await request.delete(`/api/snapshots/${s.id}`);
    }

    await page.getByTitle('표 뷰').click();
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
    const row = page.locator('.task-row', { hasText: '새 작업' }).first();
    await row.locator('.task-name').dblclick();
    await page.locator('input.name-input').fill('저장 시점 작업');
    await page.locator('input.name-input').press('Enter');
    await page.waitForTimeout(2000); // 자동 저장 디바운스

    await openManager(page, 'versions');
    await expect(page.getByTestId('pm-panel-versions')).toContainText('기본 프로젝트');
    await page.getByTestId('pm-version-name-input').fill('v1');
    await page.getByRole('button', { name: '현재 상태 저장' }).click();
    await expect(page.getByTestId('pm-version-row').filter({ hasText: 'v1' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 저장 이후의 변경 — 복원하면 이것이 사라져야 한다
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
    await expect(page.locator('.task-row', { hasText: '새 작업' })).toHaveCount(1);

    await openManager(page, 'versions');
    const version = page.getByTestId('pm-version-row').filter({ hasText: 'v1' });
    await version.getByRole('button', { name: '복원' }).click();
    await expect(version.getByTestId('pm-confirm')).toContainText('사라진다');
    await version.getByTestId('pm-confirm-yes').click();

    // 복원은 모달을 닫는다 — 되돌린 결과를 볼 수 없으면 복원했는지 알 수 없다
    await expect(page.getByTestId('pm-panel-versions')).toHaveCount(0);
    await expect(page.locator('.task-row', { hasText: '저장 시점 작업' })).toHaveCount(1);
    await expect(page.locator('.task-row', { hasText: '새 작업' })).toHaveCount(0);
});

test('버전 삭제는 무엇을 지우는지 보여 준 채로 한 번 더 묻는다', async ({ page, request }) => {
    const { data: existing } = await (await request.get('/api/snapshots')).json();
    for (const s of existing || []) {
        await request.delete(`/api/snapshots/${s.id}`);
    }

    await openManager(page, 'versions');
    await page.getByTestId('pm-version-name-input').fill('지울 버전');
    await page.getByRole('button', { name: '현재 상태 저장' }).click();
    const version = page.getByTestId('pm-version-row').filter({ hasText: '지울 버전' });
    await expect(version).toBeVisible();

    await version.locator('button[title="삭제"]').click();
    await expect(version.getByTestId('pm-confirm')).toContainText('지울 버전');

    // 취소하면 남는다 — 확인 줄이 곧 삭제가 되면 안 된다
    await version.getByRole('button', { name: '취소' }).click();
    await expect(version).toBeVisible();

    await version.locator('button[title="삭제"]').click();
    await version.getByTestId('pm-confirm-yes').click();
    await expect(page.getByTestId('pm-version-row').filter({ hasText: '지울 버전' })).toHaveCount(0);
    await page.keyboard.press('Escape');
});
