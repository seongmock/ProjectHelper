// 구조화 로그 — 사고 시 "누가 언제 무엇을 바꿨는가"를 답하는 유일한 상시 기록이다
// (events.jsonl 은 데이터 쓰기만 남긴다. 401·403·400 으로 막힌 시도는 여기에만 남는다).
//
// 그래서 검사 대상은 문구가 아니라 **한 줄이 JSON 으로 파싱되는가**와 **변경 요청에
// audit 필드가 붙는가**다. 문자열 연결로 로그를 만드는 순간 한 줄이 깨지고, 깨진 줄은
// 수집기가 통째로 버린다 — 그때는 아무도 눈치채지 못한다.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { logger, requestLogger } = require('../lib/logger');

let out;
let originalOut;
let originalErr;

beforeEach(() => {
    out = { stdout: [], stderr: [] };
    originalOut = process.stdout.write;
    originalErr = process.stderr.write;
    process.stdout.write = (chunk) => { out.stdout.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { out.stderr.push(String(chunk)); return true; };
});

afterEach(() => {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
});

const lines = (stream = 'stdout') => out[stream].map(l => JSON.parse(l));

describe('한 줄 = 한 JSON', () => {
    test('레벨·메시지·시각을 담는다', () => {
        logger.info('hello', { a: 1 });
        const [line] = lines();
        assert.equal(line.level, 'info');
        assert.equal(line.msg, 'hello');
        assert.equal(line.a, 1);
        assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    test('개행이 섞인 값이 들어와도 한 줄로 나간다', () => {
        logger.warn('multi', { detail: 'a\nb' });
        assert.equal(out.stdout.length, 1);
        assert.equal(out.stdout[0].endsWith('\n'), true);
        assert.equal(lines()[0].detail, 'a\nb');
    });

    test('error 만 stderr 로 간다 (stdout 파이프가 막혀도 사고 기록은 남는다)', () => {
        logger.error('boom');
        assert.equal(out.stdout.length, 0);
        assert.equal(lines('stderr')[0].level, 'error');
    });

    test('debug 는 기본 레벨(info)에서 나오지 않는다', () => {
        logger.debug('noisy');
        assert.equal(out.stdout.length, 0);
    });
});

describe('requestLogger — 응답 완료 시 한 줄', () => {
    const fakeReq = (over = {}) => ({ method: 'GET', originalUrl: '/api/tasks', ...over });

    // res.on('finish') 만 쓰므로 EventEmitter 흉내로 충분하다.
    const fakeRes = (statusCode) => {
        const handlers = [];
        return {
            statusCode,
            on: (event, fn) => { if (event === 'finish') handlers.push(fn); },
            finish: () => handlers.forEach(fn => fn()),
        };
    };

    const run = (req, res) => {
        let nexted = false;
        requestLogger(req, res, () => { nexted = true; });
        res.finish();
        return nexted;
    };

    test('다음 미들웨어를 막지 않는다', () => {
        assert.equal(run(fakeReq(), fakeRes(200)), true);
    });

    test('메서드·경로·상태·소요시간을 남긴다', () => {
        run(fakeReq(), fakeRes(200));
        const [line] = lines();
        assert.equal(line.msg, 'request');
        assert.equal(line.method, 'GET');
        assert.equal(line.path, '/api/tasks');
        assert.equal(line.status, 200);
        assert.equal(typeof line.durationMs, 'number');
    });

    test('변경 요청에는 감사 정보(사용자·프로젝트)가 붙는다', () => {
        run(fakeReq({ method: 'PATCH', user: 'sm.yoo', projectId: 'proj-1' }), fakeRes(200));
        assert.deepEqual(lines()[0].audit, true);
        assert.equal(lines()[0].user, 'sm.yoo');
        assert.equal(lines()[0].project, 'proj-1');
    });

    test('읽기 요청에는 붙지 않는다 (감사 로그가 조회로 덮이면 못 읽는다)', () => {
        run(fakeReq({ method: 'GET', user: 'sm.yoo' }), fakeRes(200));
        assert.equal('audit' in lines()[0], false);
        assert.equal('user' in lines()[0], false);
    });

    test('4xx 는 warn, 5xx 는 error 로 올라간다', () => {
        run(fakeReq(), fakeRes(404));
        assert.equal(lines()[0].level, 'warn');

        run(fakeReq(), fakeRes(500));
        assert.equal(lines('stderr')[0].level, 'error');
    });

    test('막힌 변경 시도도 감사 대상이다 (401 이어도 누가 시도했는지 남는다)', () => {
        run(fakeReq({ method: 'DELETE', originalUrl: '/api/projects/p1' }), fakeRes(401));
        const [line] = lines();
        assert.equal(line.level, 'warn');
        assert.equal(line.audit, true);
        assert.equal(line.path, '/api/projects/p1');
    });
});
