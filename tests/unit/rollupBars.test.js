// 접힌 가지의 요약 막대 단위 테스트.
//
// 여기서 고정하는 규칙은 "접으면 일정이 사라진다"를 없애는 것이다. 화면의 행은
// expanded 만 보는 flattenTasks 가 정하므로, 가지를 접으면 그 안의 기간·마일스톤은
// 그릴 행이 없어진다 — 축은 자손까지 훑어 자리를 비워 두므로 **일정이 없는 것과
// 접은 것이 똑같아 보였다.** 그 침묵이 다시 들어오지 않게 하는 것이 이 파일의 목적이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRollup, rollupSegmentTitle, rollupMilestoneTitle, chainStepTitle, tintOver, CHAIN_BACKGROUND } from '../../src/features/timeline/rollupBars';

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

describe('resolveRollup — 단계 체인(쉐브론)', () => {
    const collapsed = (...children) => task('p', '부모', { expanded: false, children });
    const step = (id, name, a, b, over = {}) => task(id, name, { color: '#4A90E2', timeRanges: [range(a, b)], ...over });

    it('하나도 겹치지 않으면 시작일 순서의 단계 목록 — 이름·색·작업을 싣는다', () => {
        const r = resolveRollup(collapsed(
            step('b', 'Kick-off', '2026-07-01', '2026-07-31', { color: '#888' }),
            step('a', '사전 논의', '2026-06-01', '2026-06-30'),
        ));
        expect(r.chain.map(s => s.name)).toEqual(['사전 논의', 'Kick-off']);
        expect(r.chain[1]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-31', color: '#888' });
        expect(r.chain[0].task.id).toBe('a'); // 상태 색상 모드가 이 작업의 상태를 판정한다
    });

    it('앞 단계 끝날에 다음 단계가 시작하는 것(맞닿음)은 겹침이 아니다 — 마일스톤 날짜로 잇는 계획', () => {
        const r = resolveRollup(collapsed(
            step('a', 'K2→K3', '2026-02-15', '2026-03-31'),
            step('b', 'K3→K4', '2026-03-31', '2026-04-30'),
        ));
        expect(r.chain).toHaveLength(2);
    });

    it('하루라도 겹치면 체인이 아니다 — 빗금 띠로 돌아간다(한 행에 두 표현을 섞지 않는다)', () => {
        const r = resolveRollup(collapsed(
            step('a', 'A', '2026-01-01', '2026-01-10'),
            step('b', 'B', '2026-01-09', '2026-01-20'),
            step('c', 'C', '2026-02-01', '2026-02-10'),
        ));
        expect(r.chain).toBeNull();
        expect(r.segments).toHaveLength(2);
    });

    it('기간의 색이 작업의 색보다 먼저다 · 날짜 없는 자식은 빠진다', () => {
        const r = resolveRollup(collapsed(
            task('a', 'A', { color: '#111', timeRanges: [{ id: 'r', startDate: '2026-01-01', endDate: '2026-01-05', color: '#222' }] }),
            task('b', '미정', { timeRanges: [] }),
        ));
        expect(r.chain).toHaveLength(1);
        expect(r.chain[0].color).toBe('#222');
    });

    it('일정 없이 마일스톤만 숨어 있으면 체인은 없다', () => {
        const r = resolveRollup(collapsed(task('a', 'A', { milestones: [{ id: 'm', date: '2026-01-01', label: 'M' }] })));
        expect(r.chain).toBeNull();
    });

    it('툴팁은 이름과 기간', () => {
        expect(chainStepTitle({ name: 'Kick-off', startDate: '2026-07-01', endDate: '2026-07-31' }))
            .toBe('Kick-off (2026-07-01 ~ 2026-07-31)');
    });
});

describe('tintOver — 단계 칸의 불투명 바탕', () => {
    it('색과 바탕을 alpha 로 섞는다 (#rgb 도 받는다)', () => {
        expect(tintOver('#000000', '#FFFFFF', 0.28)).toBe('#b8b8b8');
        expect(tintOver('#4A90E2', '#FFFFFF', 0)).toBe('#ffffff');
        expect(tintOver('#f00', '#000', 1)).toBe('#ff0000');
    });
    it('16진이 아니면 null — 호출부가 반투명으로 폴백한다', () => {
        expect(tintOver('rgb(1,2,3)', '#fff', 0.5)).toBeNull();
        expect(tintOver(undefined, '#fff', 0.5)).toBeNull();
    });
    it('섞는 바탕이 App.css 의 --color-bg-primary 와 같다 — 따로 적힌 값이 낡으면 칸 색이 틀린다', () => {
        const css = readFileSync(new URL('../../src/App.css', import.meta.url), 'utf8');
        const values = [...css.matchAll(/--color-bg-primary:\s*(#[0-9a-fA-F]{3,6})/g)].map(m => m[1].toUpperCase());
        expect(values).toEqual([CHAIN_BACKGROUND.light, CHAIN_BACKGROUND.dark]);
    });
});
