// 서버 검증 로직 테스트. node:test 사용 — 런타임 의존성을 늘리지 않는다.
// 실행: npm run test:server  (= node --test server/test/)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validate, validateTaskTree, MAX_TASKS, MAX_DEPTH } = require('../lib/validate');

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
