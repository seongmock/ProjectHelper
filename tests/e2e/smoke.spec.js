// 스모크 테스트 — AGENTS.md 수동 검증 체크리스트의 자동화 버전
// 리팩토링 전후로 실행하여 동작 보존을 검증한다.
//
// 전제: 신선한 브라우저 컨텍스트(localStorage 비어있음) + dev 서버.
// 서버 API가 없거나 실패해도 앱은 localStorage/샘플 데이터로 폴백해야 한다.
import { test, expect } from '@playwright/test';

// 각 테스트는 독립 컨텍스트에서 시작 → 샘플 데이터('프로젝트 기획' 등)가 로드됨
// API 서버가 떠 있으면 서버 데이터를 비워 샘플 데이터 로드를 보장 (없으면 무시)
test.beforeEach(async ({ page, request }) => {
    await request.post('/api/data', { data: [] }).catch(() => {});
    await page.goto('/');
    // 로딩 스피너가 사라지고 앱이 렌더될 때까지 대기
    await expect(page.locator('.header-title')).toContainText('프로젝트 타임라인 관리');
    await expect(page.getByText('데이터 불러오는 중')).toHaveCount(0);
});

const openTableView = async (page) => {
    await page.getByTitle('표 뷰').click();
    await expect(page.locator('.table-view')).toBeVisible();
};

test.describe('앱 로드', () => {
    test('타임라인 뷰가 기본으로 표시되고 샘플 데이터가 보인다', async ({ page }) => {
        await expect(page.getByText('프로젝트 기획').first()).toBeVisible();
        // 타임라인 뷰 버튼이 활성 상태
        await expect(page.getByTitle('타임라인 뷰')).toHaveClass(/active/);
    });
});

test.describe('작업 CRUD (표 뷰)', () => {
    test('새 작업 추가 → 목록에 표시', async ({ page }) => {
        await openTableView(page);
        await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();
    });

    test('작업명 더블클릭 → 인라인 편집 → Enter 저장', async ({ page }) => {
        await openTableView(page);
        const name = page.locator('.task-name', { hasText: '프로젝트 기획' }).first();
        await name.dblclick();
        const input = page.locator('input.name-input');
        await expect(input).toBeVisible();
        await input.fill('기획 단계 (수정됨)');
        await input.press('Enter');
        await expect(page.locator('.task-name', { hasText: '기획 단계 (수정됨)' })).toBeVisible();
    });

    test('하위 작업 추가 (계층 구조)', async ({ page }) => {
        await openTableView(page);
        const row = page.locator('.task-row', { hasText: '요구사항 분석' }).first();
        await row.getByTitle('하위 작업 추가').click();
        // 새 작업이 level-2 (3단계)로 추가됨
        await expect(page.locator('.task-row.level-2', { hasText: '새 작업' })).toBeVisible();
    });

    // 새 작업은 목록 **끝**에 붙는다 — 목록이 화면보다 길면 추가해도 시야에는 아무 변화가
    // 없다. 검색 해제로 트리 전체가 돌아올 때도 같은 자리에 걸린다.
    test('목록이 길어도 새 작업을 화면 안으로 들여놓는다', async ({ page, request }) => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            id: `seed-${i}`, name: `기존 작업 ${i}`, children: [], timeRanges: [], milestones: [],
        }));
        // 초기 자동저장(1.5s 디바운스)이 이 쓰기를 덮지 않도록 먼저 가라앉힌다
        await page.waitForTimeout(2000);
        expect((await request.post('/api/data', { data: many })).ok()).toBe(true);
        await page.reload();
        await openTableView(page);
        await expect(page.locator('.task-row')).toHaveCount(40);

        await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeInViewport();
    });

    test('작업 삭제 → 자식 포함 제거', async ({ page }) => {
        await openTableView(page);
        page.on('dialog', (dialog) => dialog.accept());
        const row = page.locator('.task-row', { hasText: '프로젝트 기획' }).first();
        await row.getByTitle('삭제 (Delete)').click();
        await expect(page.locator('.task-row', { hasText: '프로젝트 기획' })).toHaveCount(0);
        // 자식('요구사항 분석')도 함께 삭제
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toHaveCount(0);
    });
});

test.describe('실행 취소 / 다시 실행', () => {
    test('Ctrl+Z로 작업 추가 취소, Ctrl+Y로 재실행', async ({ page }) => {
        await openTableView(page);
        await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();

        await page.keyboard.press('Control+z');
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toHaveCount(0);

        await page.keyboard.press('Control+y');
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();
    });
});

test.describe('뷰 전환', () => {
    test('표 / 타임라인 / 분할 뷰 전환', async ({ page }) => {
        await openTableView(page);
        await expect(page.locator('.timeline-view')).toHaveCount(0);

        await page.getByTitle('분할 뷰').click();
        await expect(page.locator('.table-view')).toBeVisible();
        await expect(page.locator('.timeline-view').first()).toBeVisible();

        await page.getByTitle('타임라인 뷰').click();
        await expect(page.locator('.table-view')).toHaveCount(0);
        await expect(page.locator('.timeline-view').first()).toBeVisible();
    });
});

test.describe('검색', () => {
    test('작업명 검색 → 매칭 항목만 표시', async ({ page }) => {
        await openTableView(page);
        await page.getByPlaceholder('작업 검색...').fill('요구사항');
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toBeVisible();
        await expect(page.locator('.task-row', { hasText: '설계 문서 작성' })).toHaveCount(0);
    });

    // 회귀: 예전에는 접힌 부모 아래의 일치가 필터를 통과하고도 그려지지 않았다.
    // 화면에는 이름이 일치하지도 않는 부모 행만 남아, 왜 걸렸는지 읽을 수 없었다.
    test('접힌 부모 아래에 숨은 일치도 보여 준다', async ({ page }) => {
        await openTableView(page);
        const parent = page.locator('.task-row', { hasText: '프로젝트 기획' }).first();
        await parent.locator('.expand-toggle').click();
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toHaveCount(0);

        await page.getByPlaceholder('작업 검색...').fill('요구사항');
        await expect(page.locator('.task-row', { hasText: '요구사항 분석' })).toBeVisible();
    });

    test('일치가 없으면 "작업이 없습니다"가 아니라 "검색 결과가 없습니다"', async ({ page }) => {
        await openTableView(page);
        await page.getByPlaceholder('작업 검색...').fill('존재하지않는작업명');
        await expect(page.locator('.empty-state')).toContainText('검색 결과가 없습니다');
        // 작업은 있으므로 "첫 작업 추가하기"는 거짓이다 (추가는 툴바·Ctrl+N 으로 한다)
        await expect(page.getByRole('button', { name: '첫 작업 추가하기' })).toHaveCount(0);
    });

    // 회귀: 예전에는 검색 중에 작업을 추가하면 새 작업('새 작업')이 질의에 걸리지 않아
    // **화면에 아무 일도 일어나지 않았다.** 선택만 보이지 않는 작업으로 옮겨갔다.
    test('검색 중 작업 추가 → 검색이 해제되고 새 작업이 보인다', async ({ page }) => {
        await openTableView(page);
        const search = page.getByPlaceholder('작업 검색...');
        await search.fill('요구사항');
        await expect(page.locator('.task-row')).toHaveCount(2); // 부모 + 일치

        await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
        await expect(search).toHaveValue('');
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();
        await expect(page.locator('.task-row.selected', { hasText: '새 작업' })).toBeVisible();
    });

    test('새 작업이 질의에 걸리면 검색을 유지한다', async ({ page }) => {
        await openTableView(page);
        const search = page.getByPlaceholder('작업 검색...');
        await search.fill('작업'); // 샘플 데이터에는 '작업'을 포함하는 이름이 없다

        await page.getByTitle('새 작업 추가 (Ctrl+N)').click();
        await expect(search).toHaveValue('작업');
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();
    });

    test('검색 결과 0건에서 Ctrl+N → 검색이 해제되고 새 작업이 보인다', async ({ page }) => {
        await openTableView(page);
        const search = page.getByPlaceholder('작업 검색...');
        await search.fill('존재하지않는작업명');
        await expect(page.locator('.empty-state')).toBeVisible();

        // 검색창을 떠난 뒤 누른다 — 입력 중에는 트리를 바꾸는 단축키가 막히는 것이
        // 의도된 동작이다(shared/keyboard.js). 여기서 보려는 것은 단축키 경로도 같은
        // 관문(handleAddTask)을 지나는지다.
        await page.locator('.empty-state').click();
        await page.keyboard.press('Control+n');
        await expect(search).toHaveValue('');
        await expect(page.locator('.task-row', { hasText: '새 작업' })).toBeVisible();
    });
});

test.describe('다크 모드', () => {
    test('토글 시 data-theme 속성 전환', async ({ page }) => {
        const html = page.locator('html');
        const initial = await html.getAttribute('data-theme');
        await page.getByTitle('테마 변경').click();
        const toggled = await html.getAttribute('data-theme');
        expect(toggled).not.toBe(initial);
        expect(['dark', 'light']).toContain(toggled);
    });
});

test.describe('가져오기 / 내보내기', () => {
    test('Ctrl+S → JSON 파일 다운로드', async ({ page }) => {
        const downloadPromise = page.waitForEvent('download');
        await page.keyboard.press('Control+s');
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^project-timeline-.*\.json$/);
    });

    test('잘못된 JSON 붙여넣기 → 에러 토스트', async ({ page }) => {
        await page.getByTitle('가져오기').click();
        await page.getByRole('button', { name: 'JSON 붙여넣기' }).click();
        await page.locator('textarea').fill('{ not valid json');
        await page.getByRole('button', { name: '데이터 적용' }).click();
        await expect(page.locator('.toast--error')).toBeVisible();
    });

    // 버그 3a 수정 검증: 내보내기({meta, data}) → 가져오기 왕복이 성공해야 한다
    test('내보내기 → 붙여넣기 가져오기 왕복', async ({ page }) => {
        // 내보내기: JSON 복사 탭에서 텍스트 획득
        await page.getByTitle('내보내기').click();
        await page.getByRole('button', { name: 'JSON 복사' }).click();
        // textarea는 비동기로 채워짐 — 값이 채워질 때까지 대기 (전체 실행 시 레이스 방지)
        const exportArea = page.locator('textarea');
        await expect(exportArea).toHaveValue(/"data"/, { timeout: 5000 });
        const jsonText = await exportArea.inputValue();
        await page.locator('.modal-close').click();

        // 데이터 전부 삭제 후 가져오기로 복원
        await openTableView(page);
        page.on('dialog', (d) => d.accept());
        for (const taskName of ['프로젝트 기획', '디자인', '개발']) {
            const row = page.locator('.task-row', { hasText: taskName }).first();
            if (await row.count()) await row.getByTitle('삭제 (Delete)').click();
        }

        await page.getByTitle('가져오기').click();
        await page.getByRole('button', { name: 'JSON 붙여넣기' }).click();
        await page.locator('textarea').fill(jsonText);
        await page.getByRole('button', { name: '데이터 적용' }).click();
        await expect(page.locator('.toast--success')).toBeVisible();
        // 가져오기가 meta.viewSettings(viewMode='timeline')도 복원하므로 뷰 독립적으로 확인
        await expect(page.getByText('프로젝트 기획').first()).toBeVisible();
    });

    // 병합 가져오기는 충돌을 피하려고 id 를 새로 발급한다. 기간 id 까지 갈고 의존성을
    // **사본끼리** 다시 잇지 않으면, 사본의 화살표가 옛 id 를 따라 **원본에 가서 붙는다**
    // — 사용자가 그리지 않은 연결이다. 규칙은 regenerateIds 단위테스트가 고정한다.
    test('같은 데이터를 병합해도 사본의 연결이 원본에 붙지 않는다', async ({ page }) => {
        const range = (id, startDate, endDate, dependencies) =>
            ({ id, startDate, endDate, dependencies });
        const fixture = JSON.stringify({
            data: [
                {
                    id: 't-p', name: '병합선행', children: [], milestones: [],
                    timeRanges: [range('r-p', '2026-05-01', '2026-05-05', [])],
                },
                {
                    id: 't-s', name: '병합후행', children: [], milestones: [],
                    timeRanges: [range('r-s', '2026-05-06', '2026-05-10', ['r-p'])],
                },
            ],
        });

        const pasteImport = async (merge) => {
            await page.getByTitle('가져오기').click();
            await page.getByRole('button', { name: 'JSON 붙여넣기' }).click();
            if (merge) await page.locator('.option-row input[type="checkbox"]').check();
            await page.locator('textarea').fill(fixture);
            await page.getByRole('button', { name: '데이터 적용' }).click();
            // 앞선 토스트가 아직 떠 있을 수 있으므로 문구로 구분한다
            const done = merge ? '병합되었습니다' : '가져왔습니다';
            await expect(page.locator('.toast--success', { hasText: done })).toBeVisible();
        };

        await pasteImport(false); // 교체 — 트리를 이 둘만 남긴다
        await expect(page.locator('.timeline-bar')).toHaveCount(2);
        await expect(page.locator('.dependency-layer path')).toHaveCount(1);

        await pasteImport(true); // 병합 — 같은 파일을 한 번 더
        await expect(page.locator('.timeline-bar')).toHaveCount(4);
        await expect(page.locator('.dependency-layer path')).toHaveCount(2);

        // 원본 선행과 사본 선행이 후행을 하나씩 나눠 갖는다.
        // 옛 동작에서는 원본이 둘(자기 것 + 사본 것)을 갖고 사본은 하나도 없었다.
        const predecessors = page.locator('.timeline-bar[title^="병합선행 ("]');
        for (const index of [0, 1]) {
            await predecessors.nth(index).click({ button: 'right' });
            const panel = page.locator('.inspector-panel');
            await expect(panel.locator('.inspector-list-meta', { hasText: '후행' })).toHaveCount(1);
            await expect(panel.getByTestId('inspector-broken-refs')).toHaveCount(0);
        }

        // showInspector 는 전역 설정이라 되돌린다
        await page.getByTitle('인스펙터 패널').click();
        await expect(page.locator('.inspector-panel')).toHaveCount(0);
    });
});

test.describe('저장 / 불러오기 모달', () => {
    test('스냅샷 모달 열림 + 목록 렌더', async ({ page }) => {
        await page.getByTitle('스냅샷 관리').click();
        await expect(page.getByText('프로젝트 저장/불러오기')).toBeVisible();
        await expect(page.getByText('저장된 목록')).toBeVisible();
        await page.locator('.modal-footer').getByRole('button', { name: '닫기' }).click();
        await expect(page.getByText('프로젝트 저장/불러오기')).toHaveCount(0);
    });
});

test.describe('AI 프롬프트 가이드', () => {
    test('가이드 모달 열림/닫힘', async ({ page }) => {
        await page.getByTitle('프롬프트 도우미').click();
        await expect(page.locator('.modal-overlay')).toBeVisible();
        await page.locator('.modal-close').first().click();
        await expect(page.locator('.modal-overlay')).toHaveCount(0);
    });
});

// P2-5: 모달마다 껍데기를 복사해 갖고 있어서 Escape 로 닫히는 모달과 안 닫히는 모달이
// 섞여 있었다. 공용 Modal 로 통일한 뒤로는 전부 동일하게 동작해야 한다.
test.describe('모달 공통 동작', () => {
    test('Escape 로 닫히고 dialog 역할을 갖는다', async ({ page }) => {
        await page.getByTitle('프롬프트 도우미').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');

        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay')).toHaveCount(0);
    });

    test('스냅샷 모달도 Escape 로 닫힌다', async ({ page }) => {
        await page.getByTitle('스냅샷 관리').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay')).toHaveCount(0);
    });
});
