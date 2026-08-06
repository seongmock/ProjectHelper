// 타임라인 좌표 계산 단위 테스트.
//
// 이 함수들은 TimelineView.jsx 안에 있을 때 화면으로만 검증할 수 있었다.
// 날짜 → 픽셀 변환이 1일씩 어긋나도 눈으로는 잘 안 보여서, 의존성 선이
// 바 안쪽에 박히는 회귀가 조용히 들어오던 자리다.
import { describe, it, expect } from 'vitest';
import {
    computeDateRange,
    computeTodayPosition,
    buildItemMap,
    itemAnchor,
    dependencyPath,
} from '../../src/features/timeline/timelineGeometry';
import { dateUtils } from '../../src/utils/dateUtils';

const task = (over = {}) => ({
    id: 't1',
    name: '작업',
    timeRanges: [{ id: 'r1', startDate: '2026-03-10', endDate: '2026-03-20' }],
    milestones: [],
    children: [],
    ...over,
});

describe('computeDateRange', () => {
    it('작업이 없으면 오늘부터 90일', () => {
        const today = new Date('2026-05-01T00:00:00');
        const range = computeDateRange([], 'monthly', false, today);
        expect(dateUtils.getDaysBetween(range.start, range.end)).toBe(90);
    });

    it('월별 보기는 월 경계로 스냅한다 (14일 여유 포함)', () => {
        // 3/10 - 14일 = 2/24 → 2월 1일, 3/20 + 14일 = 4/3 → 4월 30일
        const range = computeDateRange([task()], 'monthly', false);
        expect(dateUtils.formatDate(range.start)).toBe('2026-02-01');
        expect(dateUtils.formatDate(range.end)).toBe('2026-04-30');
    });

    it('분기별 보기는 분기 경계로 스냅한다', () => {
        const range = computeDateRange([task()], 'quarterly', false);
        expect(dateUtils.formatDate(range.start)).toBe('2026-01-01');
        expect(dateUtils.formatDate(range.end)).toBe('2026-06-30');
    });

    it('자식의 날짜도 범위에 포함한다', () => {
        const parent = task({
            children: [task({ id: 't2', timeRanges: [{ id: 'r2', startDate: '2026-08-01', endDate: '2026-08-05' }] })],
        });
        const range = computeDateRange([parent], 'monthly', false);
        expect(dateUtils.formatDate(range.end)).toBe('2026-08-31');
    });

    it('마일스톤 날짜도 범위에 포함한다', () => {
        const withMs = task({ milestones: [{ id: 'm1', date: '2026-12-01' }] });
        const range = computeDateRange([withMs], 'monthly', false);
        expect(dateUtils.formatDate(range.end)).toBe('2026-12-31');
    });

    it('timeRanges 가 없는 레거시 작업은 startDate/endDate 를 쓴다', () => {
        const legacy = { id: 'l1', startDate: '2026-03-10', endDate: '2026-03-20', children: [] };
        const range = computeDateRange([legacy], 'monthly', false);
        expect(dateUtils.formatDate(range.start)).toBe('2026-02-01');
    });

    it("showToday 가 꺼져 있으면 오늘은 범위를 넓히지 않는다", () => {
        const today = new Date('2027-01-01T00:00:00');
        const off = computeDateRange([task()], 'monthly', false, today);
        const on = computeDateRange([task()], 'monthly', true, today);
        expect(dateUtils.formatDate(off.end)).toBe('2026-04-30');
        expect(dateUtils.formatDate(on.end)).toBe('2027-01-31');
    });
});

describe('computeTodayPosition', () => {
    const range = { start: new Date('2026-03-01T00:00:00'), end: new Date('2026-03-31T00:00:00') };

    it('showToday 가 꺼져 있으면 null', () => {
        expect(computeTodayPosition(range, 1000, false, new Date('2026-03-16T00:00:00'))).toBeNull();
    });

    it('범위 밖이면 null', () => {
        expect(computeTodayPosition(range, 1000, true, new Date('2026-05-01T00:00:00'))).toBeNull();
    });

    it('범위 안이면 경과 비율만큼의 x 좌표', () => {
        // 3/1~3/31 은 31일(끝일 포함), 3/16 은 시작에서 15일 경과
        const x = computeTodayPosition(range, 310, true, new Date('2026-03-16T00:00:00'));
        expect(x).toBeCloseTo(150, 5);
    });

    it('범위 첫날이면 0', () => {
        expect(computeTodayPosition(range, 310, true, new Date('2026-03-01T00:00:00'))).toBe(0);
    });
});

describe('buildItemMap', () => {
    const flat = [
        {
            id: 't1', name: 'A', color: '#111',
            timeRanges: [
                { id: 'r1', startDate: '2026-03-10', endDate: '2026-03-12' },
                { id: 'r2', startDate: '2026-03-20', endDate: '2026-03-25', color: '#222' },
            ],
            milestones: [{ id: 'm1', date: '2026-03-15', label: '중간' }],
        },
        { id: 't2', name: 'B', startDate: '2026-04-01', endDate: '2026-04-05' },
    ];

    it('작업 · 기간 · 마일스톤을 모두 한 Map 에 담는다', () => {
        const map = buildItemMap(flat);
        expect([...map.keys()].sort()).toEqual(['m1', 'r1', 'r2', 't1', 't2']);
    });

    it('작업 항목은 모든 기간을 아우르는 전체 범위를 갖는다', () => {
        const t1 = buildItemMap(flat).get('t1');
        expect(t1.type).toBe('task');
        expect(dateUtils.formatDate(new Date(t1.startDate))).toBe('2026-03-10');
        expect(dateUtils.formatDate(new Date(t1.endDate))).toBe('2026-03-25');
    });

    it('행 번호는 flat 배열의 인덱스다', () => {
        const map = buildItemMap(flat);
        expect(map.get('r2').index).toBe(0);
        expect(map.get('m1').parentIndex).toBe(0);
        expect(map.get('t2').index).toBe(1);
    });

    it('기간 색상은 기간 > 작업 순으로 우선한다', () => {
        const map = buildItemMap(flat);
        expect(map.get('r1').color).toBe('#111');
        expect(map.get('r2').color).toBe('#222');
    });

    it('id 없는 기간은 건너뛴다 (선을 걸 대상이 없다)', () => {
        const map = buildItemMap([{ id: 'x', timeRanges: [{ startDate: '2026-01-01', endDate: '2026-01-02' }] }]);
        expect(map.size).toBe(1);
    });

    it('timeRanges 없는 레거시 작업은 startDate/endDate 를 그대로 쓴다', () => {
        expect(buildItemMap(flat).get('t2').startDate).toBe('2026-04-01');
    });
});

describe('itemAnchor', () => {
    // 앱에서 기간/마일스톤 날짜는 모두 'YYYY-MM-DD' 문자열에서 나오므로 UTC 로 파싱된다.
    // 기준점도 같은 방식으로 맞춰 순수 좌표 계산만 검증한다 (아래 별도 테스트 참고).
    const dateRange = { start: new Date('2026-03-01'), end: new Date('2026-03-31') };
    const totalDays = 31;
    const contentWidth = 310; // 하루 = 10px
    const rowHeight = 40;

    const range = {
        type: 'range', index: 2,
        startDate: new Date('2026-03-11').getTime(),
        endDate: new Date('2026-03-20').getTime(),
    };

    it("start 는 바의 왼쪽 끝 (경과일 그대로)", () => {
        // 3/1 → 3/11 은 10일 경과 → 100px
        expect(itemAnchor(range, 'start', dateRange, totalDays, contentWidth, rowHeight).x).toBeCloseTo(100, 5);
    });

    it("end 는 바의 오른쪽 끝 (끝일을 포함하므로 +1일)", () => {
        // 3/1 → 3/20 은 20일(끝일 포함) → 200px
        expect(itemAnchor(range, 'end', dateRange, totalDays, contentWidth, rowHeight).x).toBeCloseTo(200, 5);
    });

    it('같은 날짜라도 end 가 start 보다 딱 하루만큼 오른쪽이다', () => {
        const oneDay = { type: 'range', index: 0, startDate: new Date('2026-03-05').getTime(), endDate: new Date('2026-03-05').getTime() };
        const s = itemAnchor(oneDay, 'start', dateRange, totalDays, contentWidth, rowHeight).x;
        const e = itemAnchor(oneDay, 'end', dateRange, totalDays, contentWidth, rowHeight).x;
        expect(e - s).toBeCloseTo(contentWidth / totalDays, 5);
    });

    it('y 는 행의 중앙이다', () => {
        expect(itemAnchor(range, 'start', dateRange, totalDays, contentWidth, rowHeight).y).toBe(2 * 40 + 20);
    });

    it('마일스톤은 edge 와 무관하게 자기 날짜를 쓰고 부모 행에 놓인다', () => {
        const ms = { type: 'milestone', parentIndex: 3, date: '2026-03-11' };
        const anchor = itemAnchor(ms, 'start', dateRange, totalDays, contentWidth, rowHeight);
        expect(anchor.x).toBeCloseTo(100, 5);
        expect(anchor.y).toBe(3 * 40 + 20);
    });

    // 기존 동작 기록: computeDateRange 는 new Date(y, m, 1) 로 *로컬* 자정을 만들고,
    // 항목 날짜는 'YYYY-MM-DD' 문자열이라 *UTC* 자정으로 파싱된다. UTC 동쪽(KST 등)에서는
    // 이 차이 때문에 getDaysBetween 의 Math.ceil 이 하루를 올려버린다. 기간과 마일스톤이
    // 같은 방향으로 밀리므로 선은 어긋나지 않지만, 고칠 때는 양쪽을 함께 고쳐야 한다.
    it('로컬 자정 기준점과 UTC 파싱 날짜를 섞으면 하루가 밀린다 (기존 동작)', () => {
        const localStart = { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31) };
        const x = itemAnchor(range, 'start', localStart, totalDays, contentWidth, rowHeight).x;
        const offsetDays = new Date().getTimezoneOffset() < 0 ? 11 : 10;
        expect(x).toBeCloseTo(offsetDays * 10, 5);
    });
});

describe('dependencyPath', () => {
    it('여유가 충분한 정방향은 ㄱ자 3구간 경로', () => {
        const d = dependencyPath(0, 20, 200, 60);
        expect(d).toBe('M 0 20 L 20 20 L 20 60 L 200 60');
    });

    it('같은 행 · 정방향 · 짧은 거리는 직선', () => {
        expect(dependencyPath(100, 20, 110, 20)).toBe('M 100 20 L 110 20');
    });

    it('역방향(후행이 왼쪽)은 우회 경로 5구간', () => {
        const d = dependencyPath(200, 20, 100, 60);
        expect(d).toBe('M 200 20 L 210 20 L 210 40 L 70 40 L 70 60 L 100 60');
    });
});
