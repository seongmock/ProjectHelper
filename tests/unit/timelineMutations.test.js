// 타임라인 드롭 결과 계산 단위 테스트.
//
// 복사/이동 × 같은 작업/다른 작업의 네 경우가 TimelineView.jsx 안에서는 주석으로만
// 구분돼 있었고 도달 불가능한 분기까지 섞여 있었다. 네 경우를 전부 못 박아 둔다.
import { describe, it, expect } from 'vitest';
import { planRangeDrop, planMilestoneDrop } from '../../src/utils/timelineMutations';

const source = () => ({
    id: 'src',
    color: '#111',
    timeRanges: [
        { id: 'r1', startDate: '2026-03-01', endDate: '2026-03-05' },
        { id: 'r2', startDate: '2026-03-10', endDate: '2026-03-15' },
    ],
});

const target = () => ({
    id: 'tgt',
    timeRanges: [{ id: 'r9', startDate: '2026-04-01', endDate: '2026-04-02' }],
});

const drop = (over) => planRangeDrop({
    sourceTask: source(),
    targetTask: null,
    rangeId: 'r1',
    startDate: new Date(2026, 4, 1),
    endDate: new Date(2026, 4, 10),
    isCopyMode: false,
    ...over,
});

describe('planRangeDrop', () => {
    it('원본 작업이 없으면 아무것도 하지 않는다', () => {
        expect(planRangeDrop({ sourceTask: null })).toEqual([]);
    });

    it('같은 작업 안에서의 이동 — 해당 기간의 날짜만 바뀐다', () => {
        const [update] = drop();
        expect(update.taskId).toBe('src');
        expect(update.updates.timeRanges).toHaveLength(2);
        expect(update.updates.timeRanges[0]).toMatchObject({
            id: 'r1', startDate: '2026-05-01', endDate: '2026-05-10',
        });
        expect(update.updates.timeRanges[1]).toEqual(source().timeRanges[1]);
    });

    it('작업의 전체 시작/종료일을 다시 계산한다', () => {
        const [update] = drop();
        expect(update.updates.startDate).toBe('2026-03-10');
        expect(update.updates.endDate).toBe('2026-05-10');
    });

    it('같은 작업에 복사 — 원본은 남고 새 id 로 하나 늘어난다', () => {
        const [update] = drop({ isCopyMode: true });
        const ranges = update.updates.timeRanges;
        expect(ranges).toHaveLength(3);
        expect(ranges.slice(0, 2)).toEqual(source().timeRanges);
        expect(ranges[2].id).not.toBe('r1');
        expect(ranges[2]).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-10' });
    });

    it('다른 작업으로 이동 — 원본에서 빠지고 대상에 같은 id 로 붙는다', () => {
        const updates = drop({ targetTask: target() });
        expect(updates).toHaveLength(2);

        const [from, to] = updates;
        expect(from.taskId).toBe('src');
        expect(from.updates.timeRanges.map(r => r.id)).toEqual(['r2']);
        expect(to.taskId).toBe('tgt');
        expect(to.updates.timeRanges.map(r => r.id)).toEqual(['r9', 'r1']);
    });

    it('다른 작업으로 복사 — 원본은 그대로, 대상에만 새 id 로 붙는다', () => {
        const updates = drop({ targetTask: target(), isCopyMode: true });
        expect(updates).toHaveLength(1);
        expect(updates[0].taskId).toBe('tgt');

        const added = updates[0].updates.timeRanges[1];
        expect(added.id).not.toBe('r1');
        expect(added.startDate).toBe('2026-05-01');
    });

    it('기간이 하나도 안 남으면 시작/종료일은 null 이다 (바 없음)', () => {
        const single = { id: 'src', timeRanges: [{ id: 'r1', startDate: '2026-03-01', endDate: '2026-03-05' }] };
        const [from] = planRangeDrop({
            sourceTask: single, targetTask: target(), rangeId: 'r1',
            startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 10), isCopyMode: false,
        });
        expect(from.updates.timeRanges).toEqual([]);
        expect(from.updates.startDate).toBeNull();
        expect(from.updates.endDate).toBeNull();
    });

    it('옮겨진 기간은 작업 색상을 물려받는다', () => {
        const updates = drop({ targetTask: target() });
        expect(updates[1].updates.timeRanges[1].color).toBe('#111');
    });

    it('기간별 색상이 있으면 그것을 유지한다', () => {
        const colored = { ...source(), timeRanges: [{ id: 'r1', startDate: '2026-03-01', endDate: '2026-03-05', color: '#abc' }] };
        const updates = planRangeDrop({
            sourceTask: colored, targetTask: target(), rangeId: 'r1',
            startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 10), isCopyMode: false,
        });
        expect(updates[1].updates.timeRanges[1].color).toBe('#abc');
    });

    it('없는 기간 id 로 다른 작업에 떨어뜨리면 아무것도 하지 않는다', () => {
        expect(drop({ targetTask: target(), rangeId: 'nope' })).toEqual([]);
    });

    it("timeRanges 가 없는 레거시 작업은 rangeId 'legacy' 로 기간이 만들어진다", () => {
        const legacy = { id: 'src', startDate: '2026-01-01', endDate: '2026-01-05' };
        const [update] = planRangeDrop({
            sourceTask: legacy, targetTask: null, rangeId: 'legacy',
            startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 10), isCopyMode: false,
        });
        expect(update.updates.timeRanges).toHaveLength(1);
        expect(update.updates.timeRanges[0]).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-10' });
        expect(update.updates.startDate).toBe('2026-05-01');
    });

    it('원본 객체를 변경하지 않는다', () => {
        const s = source();
        const t = target();
        planRangeDrop({
            sourceTask: s, targetTask: t, rangeId: 'r1',
            startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 10), isCopyMode: false,
        });
        expect(s).toEqual(source());
        expect(t).toEqual(target());
    });
});

const msSource = () => ({
    id: 'src',
    milestones: [
        { id: 'm1', date: '2026-03-01', label: '킥오프' },
        { id: 'm2', date: '2026-03-20', label: '중간' },
    ],
});

const msTarget = () => ({ id: 'tgt', milestones: [{ id: 'm9', date: '2026-04-01' }] });

const dropMs = (over) => planMilestoneDrop({
    sourceTask: msSource(),
    targetTask: msSource(),
    milestoneId: 'm1',
    date: '2026-05-01',
    isCopyMode: false,
    ...over,
});

describe('planMilestoneDrop', () => {
    it('마일스톤이 없는 작업이면 아무것도 하지 않는다', () => {
        expect(planMilestoneDrop({ sourceTask: { id: 'x' } })).toEqual([]);
    });

    it('없는 마일스톤 id 면 아무것도 하지 않는다', () => {
        expect(dropMs({ milestoneId: 'nope' })).toEqual([]);
    });

    it('같은 작업 안에서의 이동 — 날짜만 바뀐다', () => {
        const [update] = dropMs();
        expect(update.taskId).toBe('src');
        expect(update.updates.milestones).toHaveLength(2);
        expect(update.updates.milestones[0]).toMatchObject({ id: 'm1', date: '2026-05-01', label: '킥오프' });
        expect(update.updates.milestones[1]).toEqual(msSource().milestones[1]);
    });

    it('같은 작업에 복사 — 원본은 남고 새 id 로 하나 늘어난다', () => {
        const [update] = dropMs({ isCopyMode: true });
        const milestones = update.updates.milestones;
        expect(milestones).toHaveLength(3);
        expect(milestones.slice(0, 2)).toEqual(msSource().milestones);
        expect(milestones[2].id).not.toBe('m1');
        expect(milestones[2]).toMatchObject({ date: '2026-05-01', label: '킥오프' });
    });

    it('다른 작업으로 이동 — 원본에서 빠지고 대상에 같은 id 로 붙는다', () => {
        const updates = dropMs({ targetTask: msTarget() });
        expect(updates).toHaveLength(2);
        expect(updates[0].updates.milestones.map(m => m.id)).toEqual(['m2']);
        expect(updates[1].taskId).toBe('tgt');
        expect(updates[1].updates.milestones.map(m => m.id)).toEqual(['m9', 'm1']);
    });

    it('다른 작업으로 복사 — 원본은 그대로, 대상에만 새 id 로 붙는다', () => {
        const updates = dropMs({ targetTask: msTarget(), isCopyMode: true });
        expect(updates).toHaveLength(1);
        expect(updates[0].taskId).toBe('tgt');
        expect(updates[0].updates.milestones[1].id).not.toBe('m1');
    });

    it('마일스톤이 없던 작업으로도 옮길 수 있다', () => {
        const updates = dropMs({ targetTask: { id: 'tgt' } });
        expect(updates[1].updates.milestones.map(m => m.id)).toEqual(['m1']);
    });

    it('원본 객체를 변경하지 않는다', () => {
        const s = msSource();
        planMilestoneDrop({ sourceTask: s, targetTask: msTarget(), milestoneId: 'm1', date: '2026-05-01', isCopyMode: false });
        expect(s).toEqual(msSource());
    });
});
