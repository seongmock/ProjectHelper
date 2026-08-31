const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { renderAsciiChart } = require('../lib/asciiChart');

const range = (startDate, endDate, extra = {}) => ({
    id: `r-${startDate}-${endDate}`,
    startDate,
    endDate,
    label: '',
    dependencies: [],
    ...extra,
});

const task = (name, extra = {}) => ({
    id: `t-${name}-${Math.random()}`,
    name,
    children: [],
    ...extra,
});

describe('renderAsciiChart', () => {
    test('빈 트리 → (일정 없음)', () => {
        assert.equal(renderAsciiChart([]), '(일정 없음)');
    });

    test('날짜 없는 작업만 → (일정 없음)', () => {
        const tasks = [task('할 일', { timeRanges: [], milestones: [] })];
        assert.equal(renderAsciiChart(tasks), '(일정 없음)');
    });

    test('단일 작업: 헤더가 from~to 를 담고, 막대가 #를 포함한다', () => {
        const tasks = [
            task('설계', { timeRanges: [range('2026-01-05', '2026-02-10')] }),
        ];
        const out = renderAsciiChart(tasks);
        const [header1] = out.split('\n');
        assert.match(header1, /2026-01-05/);
        assert.match(header1, /2026-02-10/);
        assert.match(header1, /~/);
        assert.ok(out.includes('#'));
    });

    test('두 작업의 막대 시작 칸이 날짜 순서대로 다르다', () => {
        const tasks = [
            task('먼저', { timeRanges: [range('2026-01-01', '2026-01-10')] }),
            task('나중', { timeRanges: [range('2026-03-01', '2026-03-10')] }),
        ];
        const lines = renderAsciiChart(tasks).split('\n');
        const line1 = lines.find((l) => l.startsWith('먼저'));
        const line2 = lines.find((l) => l.startsWith('나중'));
        assert.ok(line1 && line2);
        const idx1 = line1.indexOf('#');
        const idx2 = line2.indexOf('#');
        assert.notEqual(idx1, -1);
        assert.notEqual(idx2, -1);
        assert.ok(idx2 > idx1);
    });

    test('마일스톤 글리프가 출력에 있고, 그 칸이 #가 아니다', () => {
        const tasks = [
            task('출시', {
                timeRanges: [range('2026-01-01', '2026-01-30')],
                milestones: [{ id: 'm1', date: '2026-01-15', label: '베타', shape: 'star', color: null }],
            }),
        ];
        const out = renderAsciiChart(tasks);
        assert.ok(out.includes('★'));
        const lines = out.split('\n');
        const line = lines.find((l) => l.startsWith('출시'));
        const starIdx = line.indexOf('★');
        assert.notEqual(starIdx, -1);
        assert.notEqual(line[starIdx], '#');
    });

    test('progress 50 인 작업의 막대 앞부분에 =가 있고 뒤에 #가 있다', () => {
        const tasks = [
            task('작업', {
                progress: 50,
                timeRanges: [range('2026-01-01', '2026-01-30')],
            }),
        ];
        const out = renderAsciiChart(tasks, { width: 100 });
        const line = out.split('\n').find((l) => l.startsWith('작업'));
        const eqIdx = line.indexOf('=');
        const hashIdx = line.indexOf('#');
        assert.notEqual(eqIdx, -1);
        assert.notEqual(hashIdx, -1);
        assert.ok(eqIdx < hashIdx);
    });

    test('뒤집힌 range(start > end)는 #를 만들지 않는다', () => {
        const tasks = [
            task('뒤집힘', { timeRanges: [range('2026-02-01', '2026-01-01')] }),
        ];
        const out = renderAsciiChart(tasks);
        const line = out.split('\n').find((l) => l.startsWith('뒤집힘'));
        assert.ok(line);
        assert.ok(!line.includes('#'));
        assert.ok(!line.includes('='));
    });

    test('maxRows 초과 시 생략 줄이 나온다', () => {
        const tasks = Array.from({ length: 5 }, (_, i) =>
            task(`작업${i}`, { timeRanges: [range('2026-01-01', '2026-01-10')] }));
        const out = renderAsciiChart(tasks, { maxRows: 2 });
        const lastLine = out.split('\n').pop();
        assert.match(lastLine, /생략/);
        assert.match(lastLine, /\+3/);
    });

    test('모든 출력 줄의 길이가 width 이하다', () => {
        const width = 80;
        const tasks = [
            task('설계', {
                progress: 40,
                timeRanges: [range('2026-01-05', '2026-04-20')],
                milestones: [{ id: 'm1', date: '2026-02-15', label: 'M1', shape: 'diamond', color: null }],
                children: [
                    task('요구사항 정리 아주 길게 길게 길게', {
                        timeRanges: [range('2026-01-05', '2026-01-20')],
                    }),
                ],
            }),
            task('개발', {
                timeRanges: [range('2026-03-01', '2026-06-30')],
                milestones: [{ id: 'm2', date: '2026-05-01', label: 'M2', shape: 'flag', color: null }],
            }),
        ];
        const out = renderAsciiChart(tasks, { width });
        out.split('\n').forEach((line) => {
            assert.ok(line.length <= width, `line too long: "${line}" (${line.length})`);
        });
    });
});

// 한글 이름은 모노스페이스에서 두 칸을 차지한다 — 코드유닛으로 채우면 막대 시작 칸이
// 행마다 어긋나 보인다. 이름 칸의 **표시 폭**이 모든 행에서 같은지 본다.
test('한글/영문 이름이 섞여도 이름 칸의 표시 폭이 같다', () => {
    const { displayWidth } = require('../lib/asciiChart');
    const tasks = [
        { id: 'a', name: '설계', timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-01-10' }], children: [] },
        { id: 'b', name: 'design', timeRanges: [{ id: 'r2', startDate: '2026-01-01', endDate: '2026-01-10' }], children: [] },
    ];
    const rows = renderAsciiChart(tasks, { width: 60 }).split('\n').slice(2);
    const widths = rows.map(line => displayWidth(line.slice(0, line.indexOf('#'))));
    assert.equal(widths[0], widths[1]);
    assert.equal(widths[0], 24);
});
