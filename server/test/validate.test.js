// 서버 검증 로직 테스트. node:test 사용 — 런타임 의존성을 늘리지 않는다.
// 실행: npm run test:server  (= node --test server/test/)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    validate, validateTaskTree, validateSettings, mergeSettings, applySettingsPatch,
    MAX_TASKS, MAX_DEPTH, MAX_SETTING_KEYS,
} = require('../lib/validate');

const task = (id, extra = {}) => ({ id, name: id, children: [], timeRanges: [], ...extra });

describe('validateTaskTree — POST /api/data 파괴 경로 차단', () => {
    // 2026-08-05: 이 검증이 없어서 {"not":"an array"} 한 번으로 운영 트리가 소실됐다.
    test('배열이 아니면 거부', () => {
        assert.match(validateTaskTree({ not: 'an array' }), /must be an array/);
        assert.match(validateTaskTree('string'), /must be an array/);
        assert.match(validateTaskTree(null), /must be an array/);
        assert.match(validateTaskTree(42), /must be an array/);
    });

    test('빈 배열은 허용 (모든 작업을 지운 정상 상태)', () => {
        assert.equal(validateTaskTree([]), null);
    });

    test('정상 트리는 통과', () => {
        const tree = [
            task('a', { children: [task('a1'), task('a2')] }),
            task('b', { timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-02-01' }] }),
        ];
        assert.equal(validateTaskTree(tree), null);
    });

    test('id 가 없거나 빈 문자열이면 거부', () => {
        assert.match(validateTaskTree([{ name: 'x', children: [] }]), /id must be a non-empty string/);
        assert.match(validateTaskTree([{ id: '', name: 'x' }]), /id must be a non-empty string/);
        assert.match(validateTaskTree([{ id: 123, name: 'x' }]), /id must be a non-empty string/);
    });

    test('name 이 문자열이 아니면 거부', () => {
        assert.match(validateTaskTree([{ id: 'a', name: 42 }]), /name must be a string/);
    });

    test('중복 id 를 거부한다', () => {
        // 중복 id 는 updateTaskInTree/deleteFromTree 가 엉뚱한 노드를 건드리게 만든다
        assert.match(validateTaskTree([task('dup'), task('dup')]), /duplicate task id: dup/);
        assert.match(
            validateTaskTree([task('a', { children: [task('a')] })]),
            /duplicate task id: a/
        );
    });

    test('중첩 노드의 오류도 잡아낸다', () => {
        const tree = [task('a', { children: [{ name: 'no-id' }] })];
        assert.match(validateTaskTree(tree), /id must be a non-empty string/);
    });

    test('children 이 배열이 아니면 거부', () => {
        assert.match(validateTaskTree([{ id: 'a', name: 'a', children: 'nope' }]), /must be an array/);
    });

    test('children 이 없어도 통과 (정규화 전 데이터 허용)', () => {
        assert.equal(validateTaskTree([{ id: 'a', name: 'a' }]), null);
    });

    test('timeRanges 날짜 형식을 검사한다', () => {
        assert.match(
            validateTaskTree([task('a', { timeRanges: [{ id: 'r', startDate: '2026/01/01' }] })]),
            /startDate must be YYYY-MM-DD/
        );
        assert.match(
            validateTaskTree([task('a', { timeRanges: [{ id: 'r', endDate: 'tomorrow' }] })]),
            /endDate must be YYYY-MM-DD/
        );
    });

    test('timeRanges 가 배열이 아니면 거부', () => {
        assert.match(validateTaskTree([task('a', { timeRanges: {} })]), /timeRanges must be an array/);
    });

    test('milestones 가 배열이 아니면 거부', () => {
        assert.match(validateTaskTree([task('a', { milestones: 'x' })]), /milestones must be an array/);
    });

    test('노드 수 상한을 넘으면 거부 (자원 고갈 방지)', () => {
        const tree = Array.from({ length: MAX_TASKS + 1 }, (_, i) => task(`n${i}`));
        assert.match(validateTaskTree(tree), new RegExp(`exceeds limit of ${MAX_TASKS}`));
    });

    test('깊이 상한을 넘으면 거부 (스택 오버플로 방지)', () => {
        let deep = task('leaf');
        for (let i = 0; i < MAX_DEPTH + 2; i++) deep = task(`d${i}`, { children: [deep] });
        assert.match(validateTaskTree([deep]), /exceeds max depth/);
    });
});

describe('validate — 필드 단위 검증', () => {
    test('필수 필드 누락을 잡는다', () => {
        assert.match(validate({}, { name: { type: 'string', required: true } }), /missing required field/);
    });

    test('알 수 없는 필드를 거부한다', () => {
        assert.match(validate({ bogus: 1 }, { name: { type: 'string' } }), /unknown field/);
    });

    // 상한이 없으면 요청 하나가 임의 길이를 실어 온다. dependencies 처럼 원소마다
    // 트리를 BFS 하는 필드에서는 그것이 곧 CPU 고갈이다.
    test('max 는 문자열과 배열의 길이를 함께 막는다', () => {
        assert.equal(validate({ p: 'abc' }, { p: { type: 'string', max: 3 } }), null);
        assert.match(validate({ p: 'abcd' }, { p: { type: 'string', max: 3 } }), /exceeds max length of 3/);
        assert.equal(validate({ p: ['a', 'b'] }, { p: { type: 'stringArray', max: 2 } }), null);
        assert.match(validate({ p: ['a', 'b', 'c'] }, { p: { type: 'stringArray', max: 2 } }), /exceeds max length of 2/);
    });

    test('null 은 nullable 일 때만 허용', () => {
        assert.match(validate({ p: null }, { p: { type: 'string' } }), /must not be null/);
        assert.equal(validate({ p: null }, { p: { type: 'string', nullable: true } }), null);
    });

    test('date 는 YYYY-MM-DD 만 허용', () => {
        assert.equal(validate({ d: '2026-08-05' }, { d: { type: 'date' } }), null);
        assert.match(validate({ d: '2026-8-5' }, { d: { type: 'date' } }), /must be a valid date/);
    });

    test('color 는 hex 만 허용', () => {
        assert.equal(validate({ c: '#4A90E2' }, { c: { type: 'color' } }), null);
        assert.match(validate({ c: 'red' }, { c: { type: 'color' } }), /must be a valid color/);
    });

    test('enum 을 강제한다', () => {
        const spec = { shape: { enum: ['diamond', 'circle'] } };
        assert.equal(validate({ shape: 'circle' }, spec), null);
        assert.match(validate({ shape: 'hexagon' }, spec), /must be one of/);
    });

    test('body 가 객체가 아니면 거부', () => {
        assert.match(validate([], {}), /must be a JSON object/);
        assert.match(validate(null, {}), /must be a JSON object/);
    });
});

// ── 전역 뷰 설정 ─────────────────────────────────────
describe('validateSettings / mergeSettings — POST /api/settings', () => {
    test('평평한 스칼라 묶음은 통과한다', () => {
        assert.equal(validateSettings({ darkMode: true, zoomLevel: 1.5, timeScale: 'week', theme: null }), null);
    });

    test('객체가 아니면 거부 — 예전에는 무엇이든 그대로 파일이 됐다', () => {
        assert.match(validateSettings([]), /must be a JSON object/);
        assert.match(validateSettings('darkMode'), /must be a JSON object/);
    });

    test('중첩 객체/배열은 거부 — 설정은 스칼라만이다', () => {
        assert.match(validateSettings({ nested: { a: 1 } }), /must be a string, number, boolean or null/);
        assert.match(validateSettings({ list: [1, 2] }), /must be a string, number, boolean or null/);
    });

    test('키 이름과 개수, 문자열 길이에 상한이 있다', () => {
        assert.match(validateSettings({ 'bad key': 1 }), /invalid settings key/);
        assert.match(validateSettings({ ['a'.repeat(41)]: 1 }), /invalid settings key/);
        const many = {};
        for (let i = 0; i <= MAX_SETTING_KEYS; i++) many[`k${i}`] = i;
        assert.match(validateSettings(many), /too many settings keys/);
        assert.match(validateSettings({ label: 'x'.repeat(201) }), /too long/);
    });

    test('NaN/Infinity 는 거부한다 — JSON.stringify 가 null 로 바꿔 조용히 설정을 지운다', () => {
        assert.match(validateSettings({ zoomLevel: NaN }), /must be finite/);
        assert.match(validateSettings({ zoomLevel: Infinity }), /must be finite/);
    });

    // 통짜 덮어쓰기였을 때, 설정 하나만 담은 요청(가져오기 경로와 AI)이
    // 사용자의 나머지 뷰 설정을 전부 지웠다.
    test('병합은 보내지 않은 키를 남긴다', () => {
        assert.deepEqual(
            mergeSettings({ darkMode: true, zoomLevel: 2, timeScale: 'week' }, { zoomLevel: 3 }),
            { darkMode: true, zoomLevel: 3, timeScale: 'week' },
        );
    });

    test('null 로는 값을 덮어쓸 수 있다 (깊은 병합이 아니다)', () => {
        assert.deepEqual(mergeSettings({ theme: 'ocean' }, { theme: null }), { theme: null });
    });

    test('기존 값이 없거나 깨져 있어도 새 설정만 남는다', () => {
        assert.deepEqual(mergeSettings(undefined, { darkMode: true }), { darkMode: true });
        assert.deepEqual(mergeSettings('garbage', { darkMode: true }), { darkMode: true });
    });
});

// 2026-09-01 레드팀. 프로토타입 체인을 타는 키 이름이 검사 자체를 통과했다.
describe('validate — Object.prototype 의 키 이름', () => {
    const spec = { name: { type: 'string', required: true } };

    test('constructor·toString·__proto__ 는 미지의 필드로 거부된다', () => {
        // `k in spec` 이던 동안 이 이름들은 미지 키 검사도, spec 순회도 지나치지 못해
        // **타입 검사 없이** 트리에 그대로 저장됐다.
        for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
            assert.match(validate({ name: 'a', [key]: 'PWNED' }, spec), /unknown field/);
        }
        // __proto__ 는 리터럴로 쓰면 own 속성이 안 되므로 JSON 이 오는 실제 경로로 만든다.
        assert.match(validate(JSON.parse('{"name":"a","__proto__":"x"}'), spec), /unknown field/);
    });

    test('정상 필드는 그대로 통과한다', () => {
        assert.equal(validate({ name: 'a' }, spec), null);
    });
});

describe('validators.date — 달력에 없는 날짜', () => {
    test('2026-02-30 은 거부된다 (저장은 원문, 투영은 3월 2일이 됐다)', () => {
        const spec = { d: { type: 'date' } };
        assert.match(validate({ d: '2026-02-30' }, spec), /valid date/);
        assert.match(validate({ d: '2026-04-31' }, spec), /valid date/);
        assert.match(validate({ d: '2025-02-29' }, spec), /valid date/);
    });

    test('실재하는 날짜는 통과한다 (윤년 포함)', () => {
        const spec = { d: { type: 'date' } };
        for (const d of ['2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01']) {
            assert.equal(validate({ d }, spec), null, d);
        }
    });
});

describe('applySettingsPatch — 병합 결과에 걸리는 상한', () => {
    const keys = (n, prefix) => Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`${prefix}${i}`, i]));

    test('요청은 상한 이내여도 병합 결과가 넘으면 거부한다', () => {
        // 상한을 요청 단위로만 세면, 상한 이내의 쓰기를 반복해 무한히 누적할 수 있었다.
        const current = keys(MAX_SETTING_KEYS - 10, 'a');
        const { error, merged } = applySettingsPatch(current, keys(20, 'b'));
        assert.match(error, /merged settings invalid/);
        assert.match(error, /too many settings keys/);
        assert.equal(merged, undefined);
    });

    test('누적이 상한을 넘지 않으면 통과한다', () => {
        const { error, merged } = applySettingsPatch(keys(10, 'a'), keys(10, 'b'));
        assert.equal(error, undefined);
        assert.equal(Object.keys(merged).length, 20);
    });

    test('덮어쓰는 키는 개수를 늘리지 않는다', () => {
        const current = keys(MAX_SETTING_KEYS, 'a');
        const { error } = applySettingsPatch(current, { a0: 99 });
        assert.equal(error, undefined);
    });

    test('patch 자체의 오류는 병합 전에 잡힌다', () => {
        assert.match(applySettingsPatch({}, { 'bad key': 1 }).error, /invalid settings key/);
        assert.match(applySettingsPatch({}, null).error, /must be a JSON object/);
    });
});
