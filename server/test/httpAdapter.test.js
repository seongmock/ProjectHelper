// Service 결과 → HTTP 응답 변환.
//
// 이 얇은 층이 API 계약 세 가지를 혼자 지고 있다: ① 성공은 언제나 `{ok:true, ...}`
// ② AppError 는 그 status 로 나가고 예상 못한 예외는 **삼키지 않고** 전역 핸들러로 간다
// (여기서 500 을 직접 만들면 스택이 사라진다) ③ 오류 응답에도 서버 리비전을 실어 보낸다 —
// 브라우저가 409 를 받고 재조회 없이 곧장 서버 상태로 맞출 수 있게 하는 것이 그 계약이고,
// 이게 빠지면 저장 충돌이 무한 재시도로 변한다.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { route } = require('../lib/httpAdapter');
const { AppError, badRequest, notFound, conflict } = require('../lib/errors');

// express 없이 호출한다 — 이 층은 express 를 알 필요가 없다.
const fakeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const call = (handler, req = {}, successStatus) => {
    const res = fakeRes();
    let nextErr = 'not called';
    route(handler, successStatus)(req, res, (err) => { nextErr = err; });
    return { res, nextErr };
};

const storeWithRevision = (revision) => ({ readMeta: () => ({ revision }) });

describe('성공 응답', () => {
    test('반환값을 { ok: true } 와 합친다', () => {
        const { res, nextErr } = call(() => ({ tasks: [1, 2] }));
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { ok: true, tasks: [1, 2] });
        assert.equal(nextErr, 'not called');
    });

    test('생성처럼 다른 상태코드가 필요한 라우트는 지정할 수 있다', () => {
        const { res } = call(() => ({ task: { id: 't1' } }), {}, 201);
        assert.equal(res.statusCode, 201);
    });

    test('반환값이 없어도 ok 는 나간다', () => {
        const { res } = call(() => undefined);
        assert.deepEqual(res.body, { ok: true });
    });

    test('핸들러는 req 를 그대로 받는다', () => {
        const req = { params: { pid: 'p1' }, body: { name: 'x' } };
        const { res } = call((r) => ({ echo: r.params.pid + r.body.name }), req);
        assert.equal(res.body.echo, 'p1x');
    });
});

describe('AppError 는 그 status 로 나간다', () => {
    const cases = [
        [badRequest('bad'), 400, 'bad'],
        [notFound('project'), 404, 'project not found'],
        [conflict(), 409, 'revision mismatch'],
        [new AppError(403, 'forbidden'), 403, 'forbidden'],
    ];

    for (const [err, status, message] of cases) {
        test(`${status} — ${message}`, () => {
            const { res, nextErr } = call(() => { throw err; });
            assert.equal(res.statusCode, status);
            assert.deepEqual(res.body, { ok: false, error: message });
            assert.equal(nextErr, 'not called', 'AppError 는 전역 핸들러로 새지 않는다');
        });
    }
});

describe('예상 못한 예외는 삼키지 않는다', () => {
    test('일반 Error 는 next 로 넘긴다 (여기서 500 을 만들면 스택이 사라진다)', () => {
        const boom = new TypeError('x is not a function');
        const { res, nextErr } = call(() => { throw boom; });
        assert.equal(nextErr, boom);
        assert.equal(res.statusCode, null, '응답을 직접 쓰지 않는다');
    });
});

describe('오류 응답에 서버 리비전을 싣는다', () => {
    test('프로젝트 스코프가 있으면 현재 리비전을 함께 보낸다', () => {
        const req = { projectStore: storeWithRevision(7) };
        const { res } = call(() => { throw conflict(); }, req);
        assert.deepEqual(res.body, { ok: false, error: 'revision mismatch', revision: 7 });
    });

    test('프로젝트 스코프가 없는 라우트에는 리비전이 없다', () => {
        const { res } = call(() => { throw notFound('project'); });
        assert.equal('revision' in res.body, false);
    });

    test('리비전을 읽다 실패해도 원래 오류가 그대로 나간다', () => {
        // 메타 파일이 깨진 상황. 여기서 터지면 400 이 500 으로 바뀌어 원인이 뒤바뀐다.
        const req = { projectStore: { readMeta: () => { throw new Error('corrupt meta'); } } };
        const { res, nextErr } = call(() => { throw badRequest('bad'); }, req);
        assert.deepEqual(res.body, { ok: false, error: 'bad' });
        assert.equal(nextErr, 'not called');
    });

    test('성공 응답에는 억지로 리비전을 붙이지 않는다 (서비스가 실어 보낸다)', () => {
        const req = { projectStore: storeWithRevision(7) };
        const { res } = call(() => ({ tasks: [] }), req);
        assert.deepEqual(res.body, { ok: true, tasks: [] });
    });
});
