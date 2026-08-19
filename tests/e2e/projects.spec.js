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

// 전환은 좌측 레일에서 한다(드롭다운은 없어졌다). 레일은 접힌 상태가 기본이라 화면에
// 남는 것은 배지 한 글자뿐이고, 이름은 title 속성으로만 있다 — 그래서 title 로 고른다.
const railProject = (page, name) => page.locator(`.rail-project[title="${name}"]`);

const switchViaRail = async (page, name) => {
    await railProject(page, name).click();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.locator('.header-title')).toContainText(name);
};

// 관리(만들기·이름 변경·삭제)는 전부 프로젝트 관리 모달에 있다 — 되돌릴 수 없는
// 동작을 hover 로만 보이는 아이콘 + 브라우저 confirm 으로 처리하던 것을 옮겼다.
const openManager = async (page, tab = 'projects') => {
    if (tab === 'projects') {
        await page.getByTestId('rail-new-project').click();
    } else {
        await page.getByTitle('프로젝트 관리').click();
    }
    await expect(page.getByTestId(`pm-panel-${tab}`)).toBeVisible();
};

const createProjectViaUI = async (page, name) => {
    await openManager(page);
    await page.getByTestId('pm-new-project-input').fill(name);
    await page.getByTestId('pm-new-project-input').press('Enter');
    await expect(page.locator('.header-title')).toContainText(name);
    await page.keyboard.press('Escape');
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
    await switchViaRail(page, '기본 프로젝트');
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
    await expect(page.locator('.header-title')).toContainText('변경된 이름');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.locator('.header-title')).toContainText('변경된 이름');
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
    await expect(page.locator('.header-title')).toContainText('기본 프로젝트');
    await page.keyboard.press('Escape');
});

test('레일: 전환은 클릭 하나, 접기/펴기는 새로고침 뒤에도 남는다', async ({ page }) => {
    await createProjectViaUI(page, '레일 프로젝트');

    // 아무것도 열지 않았는데 두 프로젝트가 모두 화면에 있다 — 레일의 존재 이유가 이것이다
    await expect(page.getByTestId('rail-project')).toHaveCount(2);
    await expect(railProject(page, '레일 프로젝트')).toHaveClass(/is-active/);

    await switchViaRail(page, '기본 프로젝트');
    await expect(railProject(page, '기본 프로젝트')).toHaveClass(/is-active/);
    await expect(railProject(page, '레일 프로젝트')).not.toHaveClass(/is-active/);

    // 접힌 레일에는 이름이 들어갈 자리가 없다 — 펴야 나온다
    const name = railProject(page, '기본 프로젝트').locator('.rail-label');
    await expect(name).toBeHidden();
    await page.getByTestId('rail-toggle').click();
    await expect(name).toBeVisible();

    // 폭은 설정이다 — 새로고침마다 접혀 있으면 매번 다시 펴야 한다
    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByTestId('project-rail')).toHaveClass(/is-expanded/);
    await page.getByTestId('rail-toggle').click(); // 설정은 전역이다 — 뒷 테스트를 위해 되돌린다
    await expect(page.getByTestId('project-rail')).not.toHaveClass(/is-expanded/);
});

test('AI가 REST로 만든 프로젝트+계획 → 레일에서 전환해 확인', async ({ page, request }) => {
    // 외부(AI)가 프로젝트 생성 + 계획 주입
    const created = await (await request.post('/api/projects', { data: { name: 'AI 프로젝트' } })).json();
    const pid = created.project.id;
    await request.post(`/api/projects/${pid}/tasks`, {
        data: { name: 'AI가 만든 계획', startDate: '2026-08-01', endDate: '2026-08-20' },
    });

    // 레일에는 "여는 순간"이 없다 — 목록은 리비전 폴링(10초)이 함께 갱신한다.
    // 이 대기가 곧 그 규약의 검증이다: 새로고침 없이도 나타나야 한다.
    await expect(railProject(page, 'AI 프로젝트')).toBeVisible({ timeout: 20000 });
    await railProject(page, 'AI 프로젝트').click();
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

// 다른 사람(또는 AI)이 지금 편집 중인 프로젝트를 지우면, 예전에는 화면이 이유 없는
// '저장 실패'만 반복했다 — 재시도는 404 를 향해 60초까지 백오프하고, 편집분은
// localStorage 에만 남고, 무슨 일이 일어났는지 알 방법이 없었다. 이제는 폴링이 목록에서
// 사라진 것을 보고 **삭제됐다고 말하고**, 화면의 트리를 새 프로젝트로 옮길 길을 준다.
test('편집 중인 프로젝트가 외부에서 삭제되면 — 이름을 말하고 새 프로젝트로 구해 낸다', async ({ page, request }) => {
    test.setTimeout(60_000); // 리비전 폴링 1주기(10초)를 기다려야 한다

    await createProjectViaUI(page, '지워질 프로젝트');
    await page.getByTitle('표 뷰').click();
    await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
    const row = page.locator('.task-row', { hasText: '새 작업' }).first();
    await row.locator('.task-name').dblclick();
    await page.locator('input.name-input').fill('구조될 작업');
    await page.locator('input.name-input').press('Enter');
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync-state', 'saved');

    const { projects } = await (await request.get('/api/projects')).json();
    const target = projects.find(p => p.name === '지워질 프로젝트');
    expect((await request.delete(`/api/projects/${target.id}`)).ok()).toBe(true);

    // 폴링이 알아차린다. 재시도 버튼이 아니라 복구 버튼이어야 한다 — 대상이 없으므로
    // 몇 번을 눌러도 404 다.
    const indicator = page.getByTestId('sync-indicator');
    await expect(indicator).toHaveAttribute('data-sync-state', 'gone', { timeout: 20_000 });
    await expect(indicator).toContainText('프로젝트 삭제됨');
    await expect(page.locator('.toast')).toContainText('삭제되었습니다');

    // 누르면 화면의 트리가 새 프로젝트로 넘어간다 — 지워진 이름을 달고.
    await indicator.click();
    await expect(page.locator('.header-title')).toContainText('지워질 프로젝트 (복구)');
    await expect(page.getByText('구조될 작업').first()).toBeVisible();

    // 그리고 실제로 서버에 저장된다 — 저장되지 않으면 새로고침 한 번에 다시 사라진다.
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync-state', 'saved');
    await page.reload();
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
    await expect(page.getByText('구조될 작업').first()).toBeVisible();
});
