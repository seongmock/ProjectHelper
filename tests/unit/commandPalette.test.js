// 명령 팔레트 순수함수 단위 테스트.
//
// 여기서 지키려는 것은 두 가지다:
//   1) 순위 — 이름을 정확히 친 항목이 우연한 부분수열보다 위에 온다. 팔레트는 첫 줄에서
//      Enter 를 치는 도구라 1등이 틀리면 잘못된 명령이 실행된다.
//   2) 목록 구성 — "지금 할 수 없는 명령은 목록에 없다"(표 뷰의 이미지 복사 등).
import { describe, it, expect, vi } from 'vitest';
import { matchQuery, filterItems, buildTaskItems, buildCommands } from '../../src/features/shell/commandPalette.js';

const labels = (results) => results.map(r => r.item.label);
const ids = (commands) => commands.map(c => c.id);

describe('matchQuery', () => {
    it('빈 질의는 점수 0 으로 통과시킨다', () => {
        expect(matchQuery('아무거나', '')).toEqual({ score: 0, indices: [] });
    });

    it('부분 문자열이면 일치 위치를 전부 돌려준다', () => {
        expect(matchQuery('다크 모드', '모드').indices).toEqual([3, 4]);
    });

    it('대소문자를 가리지 않는다', () => {
        expect(matchQuery('HTML 코드 복사', 'html')).not.toBeNull();
    });

    it('띄어쓰기를 건너뛴 부분수열도 찾는다', () => {
        expect(matchQuery('다크 모드', '다크모드')).not.toBeNull();
    });

    it('순서가 어긋나면 못 찾는다', () => {
        expect(matchQuery('다크 모드', '모드다크')).toBeNull();
    });

    it('부분 문자열이 부분수열보다, 앞쪽 일치가 뒤쪽보다 높다', () => {
        const exact = matchQuery('내보내기', '내보').score;
        const later = matchQuery('작업 내보내기', '내보').score;
        const loose = matchQuery('내 작업 보관하기', '내보').score;
        expect(exact).toBeGreaterThan(later);
        expect(later).toBeGreaterThan(loose);
    });
});

describe('filterItems', () => {
    const items = [
        { id: '1', label: '새 작업 추가' },
        { id: '2', label: '작업명 표시' },
        { id: '3', label: '다크 모드', keywords: 'dark theme' },
        { id: '4', label: '가져오기', hint: 'json' },
    ];

    it('질의가 비면 원래 순서 그대로', () => {
        expect(labels(filterItems(items, ''))).toEqual(items.map(i => i.label));
        expect(filterItems(items, '  ')[0].indices).toEqual([]);
    });

    it('일치하지 않는 항목은 빠진다', () => {
        expect(labels(filterItems(items, '다크'))).toEqual(['다크 모드']);
    });

    it('라벨 앞쪽에서 걸린 항목이 먼저 온다', () => {
        expect(labels(filterItems(items, '작업'))).toEqual(['작업명 표시', '새 작업 추가']);
    });

    it('keywords/hint 로도 찾지만 라벨 일치보다 뒤에 온다', () => {
        const byKeyword = filterItems(items, 'dark');
        expect(labels(byKeyword)).toEqual(['다크 모드']);
        // 보조 텍스트에서 걸린 것은 강조 위치가 없다 (라벨 기준이 아니므로)
        expect(byKeyword[0].indices).toEqual([]);
        expect(labels(filterItems(items, 'json'))).toEqual(['가져오기']);
    });

    it('limit 으로 결과 수를 자른다', () => {
        expect(filterItems(items, '', 2)).toHaveLength(2);
    });
});

describe('buildTaskItems', () => {
    const tree = [
        {
            id: 'a', name: '설계', children: [
                { id: 'a1', name: '검토', children: [] },
            ],
        },
        { id: 'b', name: '개발', children: [] },
    ];

    it('접힌 가지까지 전부 편다 — 숨어 있어도 찾을 수 있어야 한다', () => {
        expect(buildTaskItems(tree).map(i => i.taskId)).toEqual(['a', 'a1', 'b']);
    });

    it('부모 경로를 hint 로 싣는다 (동명 작업의 유일한 구분 근거)', () => {
        expect(buildTaskItems(tree)[1].hint).toBe('설계');
        expect(buildTaskItems(tree)[0].hint).toBe('');
    });

    it('id 는 명령 id 와 겹치지 않게 접두어를 붙인다', () => {
        expect(buildTaskItems(tree)[0].id).toBe('task:a');
    });

    it('빈 트리도 견딘다', () => {
        expect(buildTaskItems([])).toEqual([]);
        expect(buildTaskItems(null)).toEqual([]);
    });
});

describe('buildCommands', () => {
    const handlers = () => ({
        addTask: vi.fn(), undo: vi.fn(), redo: vi.fn(),
        setViewMode: vi.fn(), setSetting: vi.fn(), toggleSetting: vi.fn(),
        zoomIn: vi.fn(), zoomOut: vi.fn(), copyImage: vi.fn(),
        exportFile: vi.fn(), importFile: vi.fn(), exportHtml: vi.fn(),
        openSnapshots: vi.fn(), openPromptGuide: vi.fn(), switchProject: vi.fn(),
    });

    const build = (over = {}, h = handlers()) => buildCommands({
        viewMode: 'timeline',
        settings: { showInspector: false, darkMode: false, timeScale: 'monthly', colorMode: 'task' },
        canUndo: false,
        canRedo: false,
        projects: [],
        activeProjectId: 'default',
        handlers: h,
        ...over,
    });

    it('id 가 중복되지 않는다 (React key + 팔레트 커서가 id 기준)', () => {
        const list = ids(build({ projects: [{ id: 'p1', name: 'P1' }], canUndo: true, canRedo: true }));
        expect(new Set(list).size).toBe(list.length);
    });

    it('되돌릴 것이 없으면 실행 취소가 목록에 없다', () => {
        expect(ids(build())).not.toContain('task:undo');
        expect(ids(build({ canUndo: true }))).toContain('task:undo');
    });

    it('현재 뷰는 전환 명령으로 제시하지 않는다', () => {
        expect(ids(build({ viewMode: 'timeline' }))).not.toContain('view:timeline');
        expect(ids(build({ viewMode: 'table' }))).toContain('view:timeline');
    });

    it('표 뷰에서는 타임라인 전용 명령이 빠진다', () => {
        // 이미지 복사·줌·표시 토글은 타임라인 핸들이 있어야 동작한다
        const list = ids(build({ viewMode: 'table' }));
        expect(list).not.toContain('file:image');
        expect(list).not.toContain('view:zoom-in');
        expect(list).not.toContain('display:showBarLabels');
    });

    it('분할 뷰는 타임라인으로 취급한다', () => {
        expect(ids(build({ viewMode: 'split' }))).toContain('file:image');
    });

    it('현재 시간축은 다시 제시하지 않는다', () => {
        const list = ids(build({ settings: { timeScale: 'quarterly', colorMode: 'task' } }));
        expect(list).toContain('view:monthly');
        expect(list).not.toContain('view:quarterly');
    });

    it('토글 명령은 현재 상태를 함께 보여 준다', () => {
        const on = build({ settings: { showInspector: true, darkMode: false, timeScale: 'monthly', colorMode: 'task' } });
        expect(on.find(c => c.id === 'view:inspector').state).toBe('켜짐');
        expect(on.find(c => c.id === 'view:dark').state).toBe('꺼짐');
    });

    it('바 색상 명령의 라벨은 "바뀔 결과"를 말한다', () => {
        expect(build().find(c => c.id === 'display:colorMode').label).toBe('바 색상: 상태 색상');
        const status = build({ settings: { timeScale: 'monthly', colorMode: 'status' } });
        expect(status.find(c => c.id === 'display:colorMode').label).toBe('바 색상: 작업 색상');
    });

    it('현재 프로젝트는 전환 대상에서 빠진다', () => {
        const list = ids(build({
            projects: [{ id: 'default', name: '기본' }, { id: 'p2', name: '두번째' }],
        }));
        expect(list).toEqual(expect.arrayContaining(['project:p2']));
        expect(list).not.toContain('project:default');
    });

    it('run 은 기존 핸들러를 그대로 부른다 — 팔레트 전용 동작을 만들지 않는다', () => {
        const h = handlers();
        const list = build({ canUndo: true, projects: [{ id: 'p2', name: '두번째' }] }, h);
        const run = (id) => list.find(c => c.id === id).run();

        run('task:add');
        run('task:undo');
        run('view:table');
        run('display:showToday');
        run('file:image');
        run('project:p2');

        expect(h.addTask).toHaveBeenCalled();
        expect(h.undo).toHaveBeenCalled();
        expect(h.setViewMode).toHaveBeenCalledWith('table');
        expect(h.toggleSetting).toHaveBeenCalledWith('showToday');
        expect(h.copyImage).toHaveBeenCalled();
        expect(h.switchProject).toHaveBeenCalledWith('p2');
    });
});
