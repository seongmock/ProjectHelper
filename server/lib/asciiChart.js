// AI 에이전트가 자기가 만든 일정을 텍스트로 확인하기 위한 렌더러 (CommonJS, 외부 의존성 0).
// 입력 데이터 모델은 server/lib/taskTree.js 의 Task 형태를 그대로 따른다.

'use strict';

const { flattenAll } = require('./taskTree');

const NAME_WIDTH = 24;

const SHAPE_GLYPH = {
    diamond: '◆',
    circle: '●',
    triangle: '▲',
    square: '■',
    star: '★',
    flag: '⚑',
};

const glyphFor = (shape) => SHAPE_GLYPH[shape] || SHAPE_GLYPH.diamond;

// 'YYYY-MM-DD' 를 UTC 로 파싱한다 — 로컬 파싱은 타임존에 따라 하루가 밀린다.
const parseUtc = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`);

// DATE_RE 도 함께 본다 — 축의 from/to 는 데이터에서 뽑히고, 규약을 벗어난 문자열
// ('+010000-01' 같은 것)이 하나만 섞여도 사전순 정렬이 그것을 축의 시작으로 골라
// 차트 전체가 한 칸으로 붕괴한다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDateStr = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(parseUtc(d));

// b - a, 일수. 둘 중 하나라도 파싱 불가면 null.
const diffDays = (a, b) => {
    const ta = parseUtc(a);
    const tb = parseUtc(b);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    return Math.round((tb - ta) / 86_400_000);
};

// 한글·한자·가나는 모노스페이스에서 두 칸을 차지한다 — 코드유닛 수로 이름 칸을 채우면
// 그만큼 밀려서 막대 시작 칸이 행마다 어긋나 **보인다**. AI 는 인덱스로 읽으니 상관없지만
// 사람도 이 응답을 읽고, 어긋난 차트는 잘못 읽힌다.
// ponytail: 전각 판정은 한글·CJK·전각기호 블록만 본다 — 완전한 wcwidth 는 아니고,
// 이 도구가 다루는 한국어·영어에는 충분하다.
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const charWidth = (ch) => (WIDE_RE.test(ch) ? 2 : 1);
const displayWidth = (s) => [...s].reduce((w, ch) => w + charWidth(ch), 0);

// 이 출력은 터미널로 읽힌다. 이름의 제어문자를 그대로 흘리면 ANSI 색·벨이 주입되고,
// 개행은 **행을 하나 더 만든다** — 헤더처럼 보이는 가짜 줄을 넣어 차트가 자기 자신에
// 대해 거짓말하게 만들 수 있다. displayWidth 도 그 바이트를 폭 1로 세어 정렬이 어긋난다.
// eslint-disable-next-line no-control-regex -- 제어문자를 지우는 것이 이 정규식의 용도다
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;
// 들여쓰기에도 상한이 필요하다 — MAX_DEPTH 가 허용하는 깊이 19 에서는 '  '.repeat 이
// NAME_WIDTH(24)를 통째로 먹어 이름이 한 글자도 남지 않는다.
const MAX_INDENT = 8;

const formatName = (name, level) => {
    const indented = '  '.repeat(Math.min(level || 0, MAX_INDENT))
        + (name || '').replace(CONTROL_RE, ' ');
    const full = displayWidth(indented);
    if (full <= NAME_WIDTH) return indented + ' '.repeat(NAME_WIDTH - full);

    let out = '';
    let w = 0;
    for (const ch of indented) {
        const cw = charWidth(ch);
        if (w + cw > NAME_WIDTH - 1) break;
        out += ch;
        w += cw;
    }
    return out + '…' + ' '.repeat(Math.max(0, NAME_WIDTH - w - 1));
};

const formatDayPerCol = (totalDays, chartWidth) => {
    const raw = chartWidth > 0 ? totalDays / chartWidth : 0;
    const s = raw.toFixed(1);
    return s === '1.0' ? '1' : s;
};

const collectDates = (flat) => {
    const dates = [];
    flat.forEach((t) => {
        (t.timeRanges || []).forEach((r) => {
            if (isValidDateStr(r.startDate)) dates.push(r.startDate);
            if (isValidDateStr(r.endDate)) dates.push(r.endDate);
        });
        (t.milestones || []).forEach((m) => {
            if (isValidDateStr(m.date)) dates.push(m.date);
        });
    });
    return dates;
};

function renderAsciiChart(tasks, { width = 100, from, to, maxRows = 200 } = {}) {
    const flat = flattenAll(tasks || []);
    const dates = collectDates(flat);

    if (dates.length === 0 && (!from || !to)) {
        return '(일정 없음)';
    }

    if (!from || !to) {
        const sorted = [...dates].sort(); // 'YYYY-MM-DD' 문자열은 사전순 = 시간순
        from = from || sorted[0];
        to = to || sorted[sorted.length - 1];
    }

    const chartWidth = Math.max(0, width - NAME_WIDTH);
    const totalDays = diffDays(from, to);
    const totalDaysSafe = totalDays > 0 ? totalDays : 1;

    // 칸 인덱스: Math.floor((일수차 / 전체일수) * chartWidth), 상하한 clamp.
    const dayToCol = (dateStr) => {
        const d = diffDays(from, dateStr);
        if (d === null) return null;
        const raw = Math.floor((d / totalDaysSafe) * chartWidth);
        return Math.min(chartWidth - 1, Math.max(0, raw));
    };

    const header1 = `${from} ~ ${to} (${totalDays}일, 1칸=${formatDayPerCol(totalDays, chartWidth)}일)`;

    // 헤더 둘째 줄: 월 눈금. 각 달의 1일이 놓이는 칸에 |YYYY-MM, 뒤 눈금과 겹치면 생략.
    const tickArr = new Array(NAME_WIDTH + chartWidth).fill(' ');
    const [fy, fm0] = from.split('-').map(Number);
    const [ty, tm0] = to.split('-').map(Number);
    let y = fy;
    let m = fm0;
    let lastEnd = -Infinity;
    while (y < ty || (y === ty && m <= tm0)) {
        const monthStr = `${y}-${String(m).padStart(2, '0')}`;
        const col = dayToCol(`${monthStr}-01`);
        if (col !== null && col >= lastEnd) {
            const label = `|${monthStr}`;
            const start = NAME_WIDTH + col;
            for (let i = 0; i < label.length && start + i < tickArr.length; i++) {
                tickArr[start + i] = label[i];
            }
            lastEnd = col + label.length;
        }
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    const header2 = tickArr.join('').replace(/\s+$/, '');

    const rowsSource = flat.slice(0, maxRows);
    const lines = [header1, header2];

    rowsSource.forEach((task) => {
        const chart = new Array(chartWidth).fill(' ');

        (task.timeRanges || []).forEach((r) => {
            if (!isValidDateStr(r.startDate) || !isValidDateStr(r.endDate)) return;
            if (diffDays(r.startDate, r.endDate) < 0) return; // 뒤집힌 range 는 그리지 않는다
            const sCol = dayToCol(r.startDate);
            const eCol = dayToCol(r.endDate);
            const span = eCol - sCol + 1;
            const progressCols = task.progress > 0 ? Math.round((task.progress / 100) * span) : 0;
            for (let i = sCol; i <= eCol; i++) {
                chart[i] = (i - sCol) < progressCols ? '=' : '#';
            }
        });

        (task.milestones || []).forEach((ms) => {
            if (!isValidDateStr(ms.date)) return;
            const col = dayToCol(ms.date);
            if (col !== null && col >= 0) chart[col] = glyphFor(ms.shape);
        });

        lines.push((formatName(task.name, task.level) + chart.join('')).replace(/\s+$/, ''));
    });

    if (flat.length > maxRows) {
        lines.push(`… (+${flat.length - maxRows}개 작업 생략)`);
    }

    return lines.join('\n');
}

module.exports = { renderAsciiChart, displayWidth };
