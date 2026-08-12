// 의존성 간선 해석 단위 테스트.
//
// 여기서 고정하는 규칙은 "연결이 있는데 화면에 안 보인다"를 없애는 것이다. 예전에는
// 한쪽 끝이 화면에 없으면 그 간선을 조용히 버려서, **연결을 지운 것과 접어서 가린 것이
// 똑같아 보였다.** 그 침묵이 다시 들어오지 않게 하는 것이 이 파일의 목적이다.
import { describe, it, expect } from 'vitest';
import { resolveDependencyLinks } from '../../src/features/timeline/dependencyLinks';
import { buildItemMap } from '../../src/features/timeline/timelineGeometry';
import { flattenTasks } from '../../src/utils/dataModel';

const range = (id, startDate, endDate, deps) => ({
    id, startDate, endDate, ...(deps ? { dependencies: deps } : {}),
});

const task = (id, name, over = {}) => ({
    id,
    name,
    expanded: true,
    timeRanges: [],
    milestones: [],
    children: [],
    ...over,
});

// 부모(접을 수 있다) 아래 자식 하나 + 별개의 형제 작업. 자식 기간 → 형제 기간 의존성.
const treeWithCrossLink = (parentOver = {}) => ([
    task('p', '기획', {
        ...parentOver,
        children: [task('c', '설계', { timeRanges: [range('rc', '2026-01-01', '2026-01-10')] })],
    }),
    task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['rc'])] }),
]);

const resolveFor = (tree) => resolveDependencyLinks(buildItemMap(flattenTasks(tree)), tree);

describe('resolveDependencyLinks — 다 보이는 경우', () => {
    it('양 끝이 화면에 있으면 그대로 잇는다 (끌어올림 없음)', () => {
        const { links, hiddenEdges } = resolveFor(treeWithCrossLink());
        expect(links).toHaveLength(1);
        expect(links[0].source.data.id).toBe('rc');
        expect(links[0].target.data.id).toBe('rs');
        expect(links[0].rolledUpNames).toEqual([]);
        expect(hiddenEdges).toEqual([]);
    });

    it('끊어진 참조는 간선도 표식도 만들지 않는다 — 진단은 findDependencyIssues 의 몫이다', () => {
        const tree = [task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['없는id'])] })];
        const { links, hiddenEdges } = resolveFor(tree);
        expect(links).toEqual([]);
        expect(hiddenEdges).toEqual([]);
    });
});

describe('resolveDependencyLinks — 접힌 가지 (보이는 조상이 있다)', () => {
    const collapsed = () => treeWithCrossLink({ expanded: false });

    it('숨은 끝을 조상 행으로 끌어올려 **그대로 그린다** (사라지지 않는다)', () => {
        const { links, hiddenEdges } = resolveFor(collapsed());
        expect(links).toHaveLength(1);
        expect(hiddenEdges).toEqual([]);
        // 부모 'p' 는 0행, 형제 's' 는 1행 — 자식의 기간이 0행으로 올라왔다
        expect(links[0].source.index).toBe(0);
        expect(links[0].source.rolledUp).toBe(true);
        expect(links[0].target.index).toBe(1);
    });

    it('끌어올린 끝의 날짜는 **숨은 항목 자신의 것**이다 — x 는 정확하고 y 만 대표 행이다', () => {
        const { links } = resolveFor(collapsed());
        expect(links[0].source.startDate).toBe(new Date('2026-01-01').getTime());
        expect(links[0].source.endDate).toBe(new Date('2026-01-10').getTime());
    });

    it('끌어올린 끝의 이름을 함께 돌려준다 — 어느 자손의 선인지는 이것으로만 읽는다', () => {
        const { links } = resolveFor(collapsed());
        expect(links[0].rolledUpNames).toEqual(['설계 (기간 1)']);
    });

    it('보유자 쪽이 숨어 있어도 열거된다 — 예전에는 간선 자체가 목록에 오르지 못했다', () => {
        // 방향을 뒤집는다: 보이는 형제 → 접힌 가지 안의 자식
        const tree = [
            task('p', '기획', {
                expanded: false,
                children: [task('c', '설계', {
                    timeRanges: [range('rc', '2026-03-01', '2026-03-10', ['rs'])],
                })],
            }),
            task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10')] }),
        ];
        const { links } = resolveFor(tree);
        expect(links).toHaveLength(1);
        expect(links[0].target.rolledUp).toBe(true);
        expect(links[0].rolledUpNames).toEqual(['설계 (기간 1)']);
    });

    it('마일스톤도 같은 규칙으로 대표 행에 올라온다', () => {
        const tree = [
            task('p', '기획', {
                expanded: false,
                children: [task('c', '설계', { milestones: [{ id: 'mc', date: '2026-01-05', label: '초안' }] })],
            }),
            task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['mc'])] }),
        ];
        const { links } = resolveFor(tree);
        expect(links).toHaveLength(1);
        expect(links[0].source.parentIndex).toBe(0);
        expect(links[0].rolledUpNames).toEqual(['초안']);
    });

    it('양 끝이 같은 대표 행으로 올라오면 그리지 않는다 — 펼치면 드러나고, 겹쳐 봐야 읽을 수 없다', () => {
        const tree = [
            task('p', '기획', {
                expanded: false,
                children: [
                    task('c1', '설계', { timeRanges: [range('r1', '2026-01-01', '2026-01-10')] }),
                    task('c2', '검토', { timeRanges: [range('r2', '2026-01-11', '2026-01-20', ['r1'])] }),
                ],
            }),
        ];
        const { links, hiddenEdges } = resolveFor(tree);
        expect(links).toEqual([]);
        expect(hiddenEdges).toEqual([]);
    });
});

describe('resolveDependencyLinks — 화면 밖 (끌어올릴 조상이 없다)', () => {
    // 검색 필터를 통과한 트리 = 형제 하나뿐. 전체 트리에는 상대가 남아 있다.
    const filtered = () => [
        task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['rc'])] }),
    ];

    it('보이는 쪽 끝에 표식을 남기고 상대의 이름을 싣는다', () => {
        const { links, hiddenEdges } = resolveDependencyLinks(
            buildItemMap(flattenTasks(filtered())), treeWithCrossLink());
        expect(links).toEqual([]);
        expect(hiddenEdges).toHaveLength(1);
        expect(hiddenEdges[0].item.data.id).toBe('rs');
        expect(hiddenEdges[0].edge).toBe('start'); // 보이는 쪽이 후행 → 왼쪽으로 나간다
        expect(hiddenEdges[0].names).toEqual(['설계 (기간 1)']);
    });

    it('보이는 쪽이 선행이면 나가는 쪽(end)에 붙는다', () => {
        const tree = [
            task('c', '설계', { timeRanges: [range('rc', '2026-01-01', '2026-01-10')] }),
            task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['rc'])] }),
        ];
        const visibleOnly = [tree[0]];
        const { hiddenEdges } = resolveDependencyLinks(buildItemMap(flattenTasks(visibleOnly)), tree);
        expect(hiddenEdges).toHaveLength(1);
        expect(hiddenEdges[0].item.data.id).toBe('rc');
        expect(hiddenEdges[0].edge).toBe('end');
        expect(hiddenEdges[0].names).toEqual(['개발 (기간 1)']);
    });

    it('같은 끝에서 여러 개가 나가면 표식 하나에 이름을 모은다', () => {
        const tree = [
            task('c', '설계', { timeRanges: [range('rc', '2026-01-01', '2026-01-10')] }),
            task('a', '개발A', { timeRanges: [range('ra', '2026-02-01', '2026-02-10', ['rc'])] }),
            task('b', '개발B', { timeRanges: [range('rb', '2026-03-01', '2026-03-10', ['rc'])] }),
        ];
        const { hiddenEdges } = resolveDependencyLinks(buildItemMap(flattenTasks([tree[0]])), tree);
        expect(hiddenEdges).toHaveLength(1);
        expect(hiddenEdges[0].names).toEqual(['개발A (기간 1)', '개발B (기간 1)']);
    });

    it('양 끝이 다 화면 밖이면 아무것도 만들지 않는다 — 붙일 자리가 없다', () => {
        const { links, hiddenEdges } = resolveDependencyLinks(new Map(), treeWithCrossLink());
        expect(links).toEqual([]);
        expect(hiddenEdges).toEqual([]);
    });
});
