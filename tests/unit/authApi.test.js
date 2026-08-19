// 인증 API 래퍼. 여기서 지켜야 하는 것은 두 가지다.
//
// ① **오류가 오류로 도착해야 한다.** 이 래퍼는 `res.ok` 를 직접 보고 던진다 — 안 던지면
//    호출부는 `{ok:false}` 본문을 성공으로 읽고, 로그인 실패가 "로그인 성공"이 된다.
//    던질 때 `status` 를 실어야 useAuth 가 401(신원 없음)과 403(권한 부족)을 구분한다.
// ② **본문이 없어도 죽지 않아야 한다.** logout 이나 204 응답은 JSON 이 아니다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authApi } from '../../src/features/auth/authApi.js';

let fetchMock;

// 본문이 아예 JSON 이 아닌 응답(204, 프록시가 돌려준 HTML)을 흉내내는 표식.
const NO_JSON = Symbol('no json body');

const respond = ({ ok = true, status = 200, body = {} } = {}) => {
    fetchMock.mockResolvedValueOnce({
        ok, status,
        json: async () => {
            if (body === NO_JSON) throw new SyntaxError('Unexpected end of JSON input');
            return body;
        },
    });
};

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

const lastCall = () => fetchMock.mock.calls.at(-1);

describe('요청 조립', () => {
    it('/api 를 베이스로 붙인다', async () => {
        respond({ body: { mode: 'open', user: null } });
        await authApi.me();
        expect(lastCall()[0]).toBe('/api/auth/me');
    });

    it('로그인은 POST 로 이름/비밀번호를 싣는다', async () => {
        respond({ body: { ok: true } });
        await authApi.login('sm.yoo', 'pw');
        const [url, options] = lastCall();
        expect(url).toBe('/api/auth/login');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ name: 'sm.yoo', password: 'pw' });
        expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('이름은 URL 에 넣기 전에 인코딩한다 (계정 이름은 자유 문자열이다)', async () => {
        respond({ body: {} });
        await authApi.deleteUser('한글 이름/슬래시');
        expect(lastCall()[0]).toBe(`/api/users/${encodeURIComponent('한글 이름/슬래시')}`);
        expect(lastCall()[1].method).toBe('DELETE');
    });

    it('사용자 수정은 PATCH 로 patch 만 보낸다', async () => {
        respond({ body: {} });
        await authApi.updateUser('a', { role: 'admin' });
        expect(lastCall()[1].method).toBe('PATCH');
        expect(JSON.parse(lastCall()[1].body)).toEqual({ role: 'admin' });
    });

    it('setup 은 첫 관리자 생성 경로다', async () => {
        respond({ body: { ok: true } });
        await authApi.setup('admin', 'pw');
        expect(lastCall()[0]).toBe('/api/auth/setup');
        expect(lastCall()[1].method).toBe('POST');
    });

    it('logout 은 본문 없이 POST 한다', async () => {
        respond({ body: {} });
        await authApi.logout();
        expect(lastCall()[0]).toBe('/api/auth/logout');
        expect(lastCall()[1].method).toBe('POST');
        expect(lastCall()[1].body).toBeUndefined();
    });
});

describe('응답 해석', () => {
    it('목록은 감싼 껍데기를 벗겨서 준다', async () => {
        respond({ body: { ok: true, users: [{ name: 'a' }] } });
        expect(await authApi.listUsers()).toEqual([{ name: 'a' }]);
    });

    it('본문이 JSON 이 아니어도 성공은 성공이다', async () => {
        respond({ body: NO_JSON });
        expect(await authApi.logout()).toBeNull();
    });
});

describe('오류는 던진다 — 성공으로 읽히면 안 된다', () => {
    it('서버가 준 메시지를 그대로 전한다', async () => {
        respond({ ok: false, status: 401, body: { error: '이름 또는 비밀번호가 올바르지 않습니다' } });
        await expect(authApi.login('a', 'b')).rejects.toThrow('이름 또는 비밀번호가 올바르지 않습니다');
    });

    it('상태코드를 실어 보낸다 (401 과 403 은 다른 화면이다)', async () => {
        respond({ ok: false, status: 403, body: { error: 'forbidden' } });
        await expect(authApi.listUsers()).rejects.toMatchObject({ status: 403 });
    });

    it('메시지가 없으면 상태코드로 대신한다', async () => {
        respond({ ok: false, status: 500, body: {} });
        await expect(authApi.me()).rejects.toThrow('요청 실패 (500)');
    });

    it('오류 본문이 JSON 이 아니어도 던진다 (프록시가 HTML 을 돌려줄 수 있다)', async () => {
        respond({ ok: false, status: 502, body: NO_JSON });
        await expect(authApi.me()).rejects.toMatchObject({ status: 502 });
    });

    it('네트워크 실패는 그대로 올라간다 (오프라인을 로그인 실패로 바꾸지 않는다)', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(authApi.me()).rejects.toThrow('Failed to fetch');
    });
});
