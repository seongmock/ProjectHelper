// 접힌 가지의 요약 막대 단위 테스트.
//
// 여기서 고정하는 규칙은 "접으면 일정이 사라진다"를 없애는 것이다. 화면의 행은
// expanded 만 보는 flattenTasks 가 정하므로, 가지를 접으면 그 안의 기간·마일스톤은
// 그릴 행이 없어진다 — 축은 자손까지 훑어 자리를 비워 두므로 **일정이 없는 것과
// 접은 것이 똑같아 보였다.** 그 침묵이 다시 들어오지 않게 하는 것이 이 파일의 목적이다.
import { describe, it, expect } from 'vitest';
import { resolveRollup, rollupSegmentTitle, rollupMilestoneTitle } from '../../src/features/timeline/rollupBars';

const range = (startDate, endDate) => ({ id: `r-${startDate}`, startDate, endDate });

const task = (id, name, over = {}) => ({
    id,
    name,
    expanded: true,
    timeRanges: [],
    milestones: [],
    children: [],
    ...over,
});

describe('resolveRollup — 무엇을 요약하는가', () => {
    it('펼쳐진 가지는 요약하지 않는다 — 자손이 자기 행에 그려진다', () => {
        const parent = task('p', '부모', {
            expanded: true,
            children: [task('c', '자식', { timeRanges: [range('2026-01-01', '2026-01-10')] })],
        });
        expect(resolveRollup(parent)).toBeNull();
    });

    it('자식이 없는 작업은 접힘 여부와 무관하게 요약하지 않는다', () => {
        expect(resolveRollup(task('t', '홀로', { expanded: false }))).toBeNull();
    });

    it('접힌 가지의 기간을 끌어올리고 하위 작업 수를 센다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', { timeRanges: [range('2026-01-01', '2026-01-10')] })],
        });

        const rollup = resolveRollup(parent);
        expect(rollup.segments).toEqual([
            { startDate: '2026-01-01', endDate: '2026-01-10', count: 1, names: ['자식'] },
        ]);
        expect(rollup.taskCount).toBe(1);
    });

    it('손자까지 내려간다 — 중간 노드가 펼쳐져 있어도 화면에는 없다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', {
                expanded: true,
                children: [task('g', '손자', { timeRanges: [range('2026-03-01', '2026-03-05')] })],
            })],
        });

        const rollup = resolveRollup(parent);
        expect(rollup.segments).toHaveLength(1);
        expect(rollup.segments[0].names).toEqual(['손자']);
        expect(rollup.taskCount).toBe(2); // 자식 + 손자
    });

    it('레거시 startDate/endDate 만 있는 자손도 요약한다 — 화면에서는 바 하나다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '옛 작업', { startDate: '2026-02-01', endDate: '2026-02-10' })],
        });

        expect(resolveRollup(parent).segments[0]).toMatchObject({
            startDate: '2026-02-01', endDate: '2026-02-10',
        });
    });

    it('날짜가 아예 없는 가지는 요약하지 않는다 — 그릴 것이 없다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식')],
        });
        expect(resolveRollup(parent)).toBeNull();
    });
});

describe('resolveRollup — 구간 합치기', () => {
    it('겹치는 구간은 하나로 합치고 기여한 이름을 모두 싣는다', () => {
        const parent = task('p', '개발', {
            expanded: false,
            children: [
                task('c1', '프론트엔드', { timeRanges: [range('2026-02-10', '2026-03-31')] }),
                task('c2', '백엔드', { timeRanges: [range('2026-03-01', '2026-04-30')] }),
            ],
        });

        const { segments } = resolveRollup(parent);
        expect(segments).toEqual([{
            startDate: '2026-02-10',
            endDate: '2026-04-30',
            count: 2,
            names: ['프론트엔드', '백엔드'],
        }]);
    });

    it('떨어진 구간은 합치지 않는다 — 없는 일정을 있다고 말하지 않는다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [
                task('c1', '1월', { timeRanges: [range('2026-01-01', '2026-01-10')] }),
                task('c2', '12월', { timeRanges: [range('2026-12-01', '2026-12-10')] }),
            ],
        });

        const { segments } = resolveRollup(parent);
        expect(segments).toHaveLength(2);
        expect(segments.map(s => s.startDate)).toEqual(['2026-01-01', '2026-12-01']);
    });

    it('한 작업이 가진 여러 기간도 각각 센다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', {
                timeRanges: [range('2026-01-01', '2026-01-05'), range('2026-01-20', '2026-01-25')],
            })],
        });

        const { segments } = resolveRollup(parent);
        expect(segments).toHaveLength(2);
        expect(segments.every(s => s.names.length === 1)).toBe(true);
    });

    it('맞닿은 구간(끝일 = 시작일)은 하나로 합친다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [
                task('c1', 'A', { timeRanges: [range('2026-01-01', '2026-01-10')] }),
                task('c2', 'B', { timeRanges: [range('2026-01-10', '2026-01-20')] }),
            ],
        });

        expect(resolveRollup(parent).segments).toHaveLength(1);
    });

    it('역전된 기간은 버리지도 고쳐 쓰지도 않고 두 날짜를 덮는다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', { timeRanges: [range('2026-05-20', '2026-05-01')] })],
        });

        expect(resolveRollup(parent).segments[0]).toMatchObject({
            startDate: '2026-05-01', endDate: '2026-05-20',
        });
    });

    it('한쪽 날짜가 비면 그 기간만 건너뛴다 — 나머지는 남는다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', {
                timeRanges: [
                    { id: 'bad', startDate: '2026-01-01', endDate: '' },
                    range('2026-06-01', '2026-06-10'),
                ],
            })],
        });

        const { segments } = resolveRollup(parent);
        expect(segments).toHaveLength(1);
        expect(segments[0].startDate).toBe('2026-06-01');
    });
});

describe('resolveRollup — 숨은 마일스톤', () => {
    it('기간이 없어도 마일스톤만으로 요약이 생긴다 — 접으면 사라지던 것이다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [task('c', '자식', {
                milestones: [{ id: 'm1', date: '2026-04-01', label: '출시', color: '#f00' }],
            })],
        });

        const rollup = resolveRollup(parent);
        expect(rollup.segments).toEqual([]);
        expect(rollup.milestones).toEqual([
            { id: 'm1', date: '2026-04-01', label: '출시', color: '#f00', via: '자식' },
        ]);
    });

    it('날짜순으로 정렬하고 어느 자손의 것인지를 함께 싣는다', () => {
        const parent = task('p', '부모', {
            expanded: false,
            children: [
                task('c1', 'A', { milestones: [{ id: 'm2', date: '2026-09-01', label: '늦은' }] }),
                task('c2', 'B', { milestones: [{ id: 'm1', date: '2026-02-01', label: '이른' }] }),
            ],
        });

        expect(resolveRollup(parent).milestones.map(m => [m.id, m.via]))
            .toEqual([['m1', 'B'], ['m2', 'A']]);
    });
});

describe('툴팁', () => {
    it('끌어올린 막대는 어느 자손의 것인지 이름으로 말한다', () => {
        const title = rollupSegmentTitle({
            startDate: '2026-01-01', endDate: '2026-02-01', count: 2, names: ['설계', '개발'],
        });
        expect(title).toBe('숨은 하위 일정: 설계, 개발 (2026-01-01 ~ 2026-02-01)');
    });

    it('이름이 많으면 앞의 셋만 쓰고 나머지는 개수로 줄인다', () => {
        const title = rollupSegmentTitle({
            startDate: '2026-01-01', endDate: '2026-02-01', count: 5,
            names: ['A', 'B', 'C', 'D', 'E'],
        });
        expect(title).toContain('A, B, C 외 2개');
    });

    it('숨은 마일스톤은 라벨·날짜·보유 작업을 말한다', () => {
        expect(rollupMilestoneTitle({ date: '2026-04-01', label: '출시', via: '자식' }))
            .toBe('숨은 마일스톤: 출시 (2026-04-01) — 자식');
    });
});
