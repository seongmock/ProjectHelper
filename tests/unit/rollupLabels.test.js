// 접힌 행의 숨은 마일스톤 라벨 — 자리가 있을 때만, 그리고 이웃 행의 라벨과 같은 띠에 포개지지 않게.
// 첫 구현은 행마다 따로 판정해서 한 행의 아래 라벨과 다음 행의 위 라벨이 포개졌다(2026-10-14).
import { describe, it, expect } from 'vitest';
import { planRollupLabels, rollupMilestoneItems } from '../../src/features/timeline/rollupLabels';

const at = (id, x, label = '라벨') => ({ id, x, label });
const row = (id, { own = [], hidden = [] } = {}) => ({ id, own, hidden });

describe('planRollupLabels', () => {
    it('자리가 있으면 단다 — 첫 행은 아래, 다른 행은 위부터', () => {
        const plan = planRollupLabels([row('r0', { hidden: [at('a', 100)] }), row('r1', { hidden: [at('b', 500)] })], 1000);
        expect(plan.get('r0').get('a').position).toBe('bottom');
        expect(plan.get('r1').get('b').position).toBe('top');
    });

    it('위 행이 아래에 단 라벨과 내 위 라벨은 같은 띠다 — 겹치면 아래로, 아래도 막히면 달지 않는다', () => {
        const plan = planRollupLabels([
            row('r0', { hidden: [at('a', 300)] }),          // 첫 행 → 아래(= r0 과 r1 사이 띠)
            row('r1', { hidden: [at('b', 302), at('c', 304)] }),
        ], 1000);
        expect(plan.get('r0').get('a').position).toBe('bottom');
        expect(plan.get('r1').get('b').position).toBe('bottom'); // 위 띠는 a 가 차지했다
        expect(plan.get('r1').has('c')).toBe(false);              // 위도 아래도 막혔다
    });

    it('아래 행이 위에 단 자신의 라벨도 피한다', () => {
        const plan = planRollupLabels([
            row('r0', { own: [at('own0', 900)] }),
            row('r1', { hidden: [at('h', 400), at('h2', 402)] }),
            row('r2', { own: [at('own2', 401)] }),               // r2 의 위 라벨(0층) = r1 아래 띠
        ], 1000);
        expect(plan.get('r1').get('h').position).toBe('top');
        expect(plan.get('r1').has('h2')).toBe(false); // 위는 h, 아래는 r2 의 라벨이 차지했다
    });

    it('그 행 자신의 라벨 자리는 비워 둔다', () => {
        const plan = planRollupLabels([row('r0'), row('r1', { own: [at('o', 200)], hidden: [at('h', 201)] })], 1000);
        expect(plan.get('r1').get('h').position).toBe('bottom'); // 자신의 o 가 위 0층에 앉았다
    });
});

describe('rollupMilestoneItems', () => {
    it('축 안의 숨은 마일스톤만, 마커와 같은 x 로', () => {
        const range = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 11) };
        const items = rollupMilestoneItems({ milestones: [
            { id: 'a', date: '2026-01-06', label: 'A' }, { id: 'b', date: '2026-02-01', label: 'B' },
        ] }, range, 1000, false);
        expect(items.map(i => i.id)).toEqual(['a']);
        expect(items[0].x).toBeCloseTo(500);
        expect(rollupMilestoneItems({ milestones: [{ id: 'a', date: '2026-01-06', label: 'A' }] }, range, 1000, true)[0].label).toBe('26.01.06');
    });
});
