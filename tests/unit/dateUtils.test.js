// `dateUtils` — 타임라인의 모든 좌표와 스냅이 여기서 나온다.
//
// 이 파일이 존재하는 이유는 커버리지 숫자가 아니다. 저장 데이터의 날짜는 **시각이 없는
// `YYYY-MM-DD` 문자열**인데 `new Date('2026-03-15')` 는 그것을 UTC 자정으로 파싱하고,
// 이 모듈은 결과를 `getFullYear/getMonth/getDate` 같은 **로컬** 접근자로 다시 읽는다.
// 두 기준이 어긋나는 시간대(UTC 서쪽)에서는 스냅과 이동이 통째로 하루씩 밀렸다.
// 그래서 아래 검사는 **여러 시간대에서 같은 답이 나오는지**를 본다 — 한국 시간대에서만
// 돌려 보면 이 결함은 영원히 보이지 않는다.
import { describe, it, expect, afterAll } from 'vitest';
import { dateUtils } from '../../src/utils/dateUtils.js';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

// Node 는 `process.env.TZ` 변경을 이후의 Date 에 즉시 반영한다.
const inTZ = (tz, fn) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try { return fn(); } finally { process.env.TZ = prev; }
};

// UTC 동쪽 / UTC / UTC 서쪽 — 세 번째가 예전에 하루씩 밀리던 쪽이다.
const ZONES = ['Asia/Seoul', 'UTC', 'America/New_York'];
const everyZone = (fn) => ZONES.map(tz => [tz, inTZ(tz, fn)]);
const f = (d) => dateUtils.formatDate(d);

describe('시간대에 흔들리지 않는다 (UTC 파싱 + 로컬 접근자 혼용 회귀)', () => {
    it('snapToDay 는 어느 시간대에서도 같은 날을 돌려준다', () => {
        expect(everyZone(() => f(dateUtils.snapToDay('2026-03-15'))))
            .toEqual(ZONES.map(tz => [tz, '2026-03-15']));
    });

    it('addDays(+1) 은 어느 시간대에서도 다음 날이다', () => {
        expect(everyZone(() => f(dateUtils.addDays('2026-03-15', 1))))
            .toEqual(ZONES.map(tz => [tz, '2026-03-16']));
    });

    it('주 스냅은 어느 시간대에서도 같은 월요일~일요일을 준다', () => {
        // 2026-03-15 는 일요일 → 그 주(월요일 기준)는 03-09 ~ 03-15
        expect(everyZone(() => [
            f(dateUtils.snapToWeek('2026-03-15', 'start')),
            f(dateUtils.snapToWeek('2026-03-15', 'end')),
        ])).toEqual(ZONES.map(tz => [tz, ['2026-03-09', '2026-03-15']]));
    });

    it('월·분기 스냅도 시간대에 흔들리지 않는다', () => {
        expect(everyZone(() => [
            f(dateUtils.snapToMonth('2026-03-15', 'start')),
            f(dateUtils.snapToMonth('2026-03-15', 'end')),
            f(dateUtils.snapToQuarter('2026-03-15', 'start')),
            f(dateUtils.snapToQuarter('2026-03-15', 'end')),
        ])).toEqual(ZONES.map(tz => [tz, ['2026-03-01', '2026-03-31', '2026-01-01', '2026-03-31']]));
    });

    it('기간 계산도 마찬가지다', () => {
        expect(everyZone(() => dateUtils.getDuration('2026-03-01', '2026-03-31')))
            .toEqual(ZONES.map(tz => [tz, 31]));
    });

    it('일광절약시간 경계를 넘어도 하루가 하루다', () => {
        // 미국 DST 전환일(2026-03-08). UTC 오프셋이 바뀌는 날이라 시각 기반 산술은 여기서 깨진다.
        expect(everyZone(() => f(dateUtils.addDays('2026-03-07', 1))))
            .toEqual(ZONES.map(tz => [tz, '2026-03-08']));
        expect(everyZone(() => dateUtils.getDuration('2026-03-07', '2026-03-09')))
            .toEqual(ZONES.map(tz => [tz, 3]));
    });
});

describe('formatDate', () => {
    it('문자열은 그대로 통과시킨다 (이미 저장 형식이다)', () => {
        expect(dateUtils.formatDate('2026-01-02')).toBe('2026-01-02');
    });

    it('한 자리 월/일을 0으로 채운다', () => {
        expect(dateUtils.formatDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    });
});

describe('getDaysBetween / getDuration', () => {
    it('getDaysBetween 은 경계를 포함하지 않고 getDuration 은 포함한다', () => {
        expect(dateUtils.getDaysBetween('2026-03-01', '2026-03-02')).toBe(1);
        expect(dateUtils.getDuration('2026-03-01', '2026-03-02')).toBe(2);
    });

    it('같은 날은 하루다', () => {
        expect(dateUtils.getDuration('2026-03-01', '2026-03-01')).toBe(1);
    });

    // 역전된 기간은 화면에서 0px 막대가 된다 — 그 규칙이 여기서 나온다.
    it('종료가 시작보다 앞서면 0이다 (음수가 아니다)', () => {
        expect(dateUtils.getDuration('2026-03-10', '2026-03-01')).toBe(0);
    });

    it('윤년 2월을 센다', () => {
        expect(dateUtils.getDuration('2028-02-01', '2028-02-29')).toBe(29);
    });
});

describe('generateMonthRange / generateQuarterRange — 축 눈금', () => {
    it('시작월의 1일부터 종료일을 덮을 때까지 만든다', () => {
        const months = dateUtils.generateMonthRange('2026-03-15', '2026-06-02');
        expect(months.map(m => m.label)).toEqual(['2026년 3월', '2026년 4월', '2026년 5월', '2026년 6월']);
    });

    it('같은 달 안이면 눈금 하나다', () => {
        expect(dateUtils.generateMonthRange('2026-03-02', '2026-03-28')).toHaveLength(1);
    });

    it('분기는 그 분기의 첫 달부터 시작한다', () => {
        const quarters = dateUtils.generateQuarterRange('2026-02-10', '2026-08-01');
        expect(quarters.map(q => q.label)).toEqual(['2026년 Q1', '2026년 Q2', '2026년 Q3']);
    });

    it('해를 넘겨도 이어진다', () => {
        const quarters = dateUtils.generateQuarterRange('2026-11-01', '2027-02-01');
        expect(quarters.map(q => q.label)).toEqual(['2026년 Q4', '2027년 Q1']);
    });
});

describe('calculateWidth — 뷰 밖으로 나간 막대는 잘려서 그려진다', () => {
    const VIEW = ['2026-03-01', '2026-03-31'];

    it('뷰 전체를 덮는 기간은 폭 전체를 차지한다', () => {
        const { width, offset } = dateUtils.calculateWidth(...VIEW, ...VIEW, 310);
        expect(width).toBeCloseTo(310);
        expect(offset).toBeCloseTo(0);
    });

    it('왼쪽으로 넘친 기간은 뷰 시작에서 잘리고 offset 이 0 이다', () => {
        const { width, offset } = dateUtils.calculateWidth('2026-02-01', '2026-03-10', ...VIEW, 310);
        expect(offset).toBeCloseTo(0);
        expect(width).toBeCloseTo((10 / 31) * 310);
    });

    it('오른쪽으로 넘친 기간은 뷰 끝에서 잘린다', () => {
        const { width, offset } = dateUtils.calculateWidth('2026-03-21', '2026-04-30', ...VIEW, 310);
        expect(offset).toBeCloseTo((20 / 31) * 310);
        expect(width).toBeCloseTo((11 / 31) * 310);
    });
});

describe('snapAdaptive — 타임라인이 길수록 눈금이 굵어진다', () => {
    const D = '2026-03-15';

    it('2개월 미만은 일 단위', () => {
        expect(f(dateUtils.snapAdaptive(D, 'start', 30))).toBe('2026-03-15');
    });

    it('6개월 미만은 주 단위', () => {
        expect(f(dateUtils.snapAdaptive(D, 'start', 120))).toBe('2026-03-09');
    });

    it('2년 미만은 월 단위', () => {
        expect(f(dateUtils.snapAdaptive(D, 'start', 400))).toBe('2026-03-01');
    });

    it('2년 이상은 분기 단위', () => {
        expect(f(dateUtils.snapAdaptive(D, 'start', 1000))).toBe('2026-01-01');
    });
});

describe('snapToMonth("closest") — 가장 가까운 경계', () => {
    it('월 초반은 그 달 1일로', () => {
        expect(f(dateUtils.snapToMonth('2026-03-03', 'closest'))).toBe('2026-03-01');
    });

    it('월 말은 말일로', () => {
        expect(f(dateUtils.snapToMonth('2026-03-29', 'closest'))).toBe('2026-03-31');
    });

    it('말일 자체는 다음 달 1일이 아니라 말일이다', () => {
        expect(f(dateUtils.snapToMonth('2026-03-31', 'closest'))).toBe('2026-03-31');
    });
});
