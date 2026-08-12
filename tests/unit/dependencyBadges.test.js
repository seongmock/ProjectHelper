// 표의 의존성 배지 단위 테스트.
//
// 표에는 의존성 표현이 아예 없었다 — 연결은 타임라인 화살표와 인스펙터에만 있어서,
// 표만 쓰는 사용자에게는 **연결이 존재한다는 사실 자체**가 보이지 않았다. 여기서 고정하는
// 것은 (1) 방향을 정확히 세는가 (2) 접어서 가린 연결을 조상 행으로 끌어올리는가
// (3) 문제(순환·일정 위반·끊어진 참조)를 같은 우선순위로 말하는가 — 셋이다.
import { describe, it, expect } from 'vitest';
import { summarizeRowDependencies, describeRowDependencies } from '../../src/features/table/dependencyBadges';
import { findDependencyIssues } from '../../src/utils/taskTree';
import { flattenTasks } from '../../src/utils/dataModel';

const range = (id, startDate, endDate, deps) => ({
    id, startDate, endDate, ...(deps ? { dependencies: deps } : {}),
});

const task = (id, name, over = {}) => ({
    id, name, expanded: true, timeRanges: [], milestones: [], children: [], ...over,
});

// 화면이 실제로 그리는 행 = flattenTasks(트리) — expanded 를 존중한다.
const summarize = (tree) => summarizeRowDependencies(
    tree,
    new Set(flattenTasks(tree).map(t => t.id)),
    findDependencyIssues(tree),
);

// 부모(접을 수 있다) 아래 자식 하나 + 별개의 형제. 자식 기간 → 형제 기간 의존성.
const treeWithCrossLink = (parentOver = {}) => ([
    task('p', '기획', {
        ...parentOver,
        children: [task('c', '설계', { timeRanges: [range('rc', '2026-01-01', '2026-01-10')] })],
    }),
    task('s', '개발', { timeRanges: [range('rs', '2026-02-01', '2026-02-10', ['rc'])] }),
]);

describe('summarizeRowDependencies — 방향과 이름', () => {
    it('선행 쪽 행에는 후행이, 후행 쪽 행에는 선행이 선다', () => {
        const rows = summarize(treeWithCrossLink());
        expect(rows.get('c').successors).toEqual([{ name: '개발 (기간 1)', via: null, issue: null }]);
        expect(rows.get('s').predecessors).toEqual([{ name: '설계 (기간 1)', via: null, issue: null }]);
        // 연결이 없는 행은 항목 자체가 없다 — 화면이 "—" 를 그린다
        expect(rows.has('p')).toBe(false);
    });

    it('작업 단위(레거시) 의존성도 센다 — 인스펙터가 세는 것과 같아야 한다', () => {
        const tree = [task('a', '선행'), task('b', '후행', { dependencies: ['a'] })];
        const rows = summarize(tree);
        expect(rows.get('b').predecessors.map(e => e.name)).toEqual(['선행']);
        expect(rows.get('a').successors.map(e => e.name)).toEqual(['후행']);
    });

    it('마일스톤이 든 의존성은 소유 작업의 행에 선다', () => {
        const tree = [
            task('a', '선행', { timeRanges: [range('ra', '2026-01-01', '2026-01-05')] }),
            task('b', '후행', { milestones: [{ id: 'm1', date: '2026-01-10', label: '착수', dependencies: ['ra'] }] }),
        ];
        const rows = summarize(tree);
        expect(rows.get('b').predecessors.map(e => e.name)).toEqual(['선행 (기간 1)']);
        expect(rows.get('a').successors.map(e => e.name)).toEqual(['착수']);
    });

    it('한 작업 안에서 닫힌 연결은 세지 않는다 — 자기 자신과 연결된 것처럼 읽힌다', () => {
        const tree = [task('a', '작업', {
            timeRanges: [range('r1', '2026-01-01', '2026-01-05'), range('r2', '2026-01-06', '2026-01-10', ['r1'])],
        })];
        expect(summarize(tree).has('a')).toBe(false);
    });
});

describe('summarizeRowDependencies — 접힌 가지 (화면에 행이 없다)', () => {
    const collapsed = () => treeWithCrossLink({ expanded: false });

    it('숨은 자손의 연결을 조상 행으로 끌어올린다 (사라지지 않는다)', () => {
        const rows = summarize(collapsed());
        expect(rows.has('c')).toBe(false); // 자식은 행이 없다
        expect(rows.get('p').successors).toEqual([
            { name: '개발 (기간 1)', via: '설계 (기간 1)', issue: null },
        ]);
        // 상대 쪽은 그대로다 — 이름은 여전히 숨은 자손 자신의 것이다
        expect(rows.get('s').predecessors).toEqual([
            { name: '설계 (기간 1)', via: null, issue: null },
        ]);
    });

    it('양 끝이 같은 조상으로 끌어올려지면 세지 않는다 (펼치면 드러난다)', () => {
        const tree = [task('p', '기획', {
            expanded: false,
            children: [
                task('c1', '설계', { timeRanges: [range('r1', '2026-01-01', '2026-01-05')] }),
                task('c2', '구현', { timeRanges: [range('r2', '2026-01-06', '2026-01-10', ['r1'])] }),
            ],
        })];
        expect(summarize(tree).has('p')).toBe(false);
    });

    it('조상까지 전부 화면에 없으면(검색 밖) 얹을 행이 없다 — 남은 쪽만 센다', () => {
        const tree = treeWithCrossLink();
        // 검색 필터가 형제만 남긴 상태를 흉내낸다: 보이는 행이 's' 하나뿐
        const rows = summarizeRowDependencies(tree, new Set(['s']), findDependencyIssues(tree));
        expect(rows.get('s').predecessors.map(e => e.name)).toEqual(['설계 (기간 1)']);
        expect([...rows.keys()]).toEqual(['s']);
    });
});

describe('summarizeRowDependencies — 문제 표시', () => {
    it('순환은 양쪽 행에 cycle 로 선다', () => {
        const tree = [
            task('a', '가', { timeRanges: [range('ra', '2026-01-01', '2026-01-05', ['rb'])] }),
            task('b', '나', { timeRanges: [range('rb', '2026-01-06', '2026-01-10', ['ra'])] }),
        ];
        const rows = summarize(tree);
        expect(rows.get('a').issue).toBe('cycle');
        expect(rows.get('b').issue).toBe('cycle');
    });

    it('후행이 선행 종료보다 먼저 시작하면 overlap', () => {
        const tree = [
            task('a', '가', { timeRanges: [range('ra', '2026-01-01', '2026-01-20')] }),
            task('b', '나', { timeRanges: [range('rb', '2026-01-05', '2026-01-10', ['ra'])] }),
        ];
        const rows = summarize(tree);
        expect(rows.get('b').issue).toBe('overlap');
        expect(rows.get('b').predecessors[0].issue).toBe('overlap');
    });

    it('끊어진 참조는 수만 세고 broken 으로 표시한다 — 상대가 없어 방향이 없다', () => {
        const tree = [task('b', '나', { timeRanges: [range('rb', '2026-01-05', '2026-01-10', ['사라진id'])] })];
        const rows = summarize(tree);
        expect(rows.get('b')).toMatchObject({ predecessors: [], successors: [], broken: 1, issue: 'broken' });
    });

    it('순환 > 일정 위반 > 끊어진 참조 순으로 하나만 말한다', () => {
        const tree = [
            task('a', '가', { timeRanges: [range('ra', '2026-01-01', '2026-01-20')] }),
            task('b', '나', {
                timeRanges: [range('rb', '2026-01-05', '2026-01-10', ['ra', '사라진id'])],
            }),
        ];
        expect(summarize(tree).get('b').issue).toBe('overlap');
    });
});

describe('describeRowDependencies — 툴팁', () => {
    it('상대 이름을 싣는다 — 이름이 빠지면 인스펙터를 열어야만 상대를 알 수 있다', () => {
        const text = describeRowDependencies(summarize(treeWithCrossLink()).get('s'));
        expect(text).toContain('선행: 설계 (기간 1)');
        expect(text).toContain('클릭하면 인스펙터에서 본다');
    });

    it('끌어올린 연결은 어느 하위가 들고 있는지까지 밝힌다', () => {
        const text = describeRowDependencies(summarize(treeWithCrossLink({ expanded: false })).get('p'));
        expect(text).toContain('후행: 개발 (기간 1) (하위 설계 (기간 1))');
    });

    it('문제가 있으면 그 문구를 덧붙인다', () => {
        const tree = [task('b', '나', { timeRanges: [range('rb', '2026-01-05', '2026-01-10', ['사라진id'])] })];
        expect(describeRowDependencies(summarize(tree).get('b'))).toContain('끊어진 참조 1건');
    });

    it('항목이 없으면 빈 문자열이다', () => {
        expect(describeRowDependencies(undefined)).toBe('');
    });
});
