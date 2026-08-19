// 신원·권한. 두 층을 따로 본다.
//
// ① 판정 자체(lib/auth): 해시·토큰·모드. 여기서 틀리면 아무도 못 들어오거나 아무나 들어온다.
// ② 실제 배선(index.js): 진짜 서버를 띄워 HTTP 로 두드린다. 게이트는 미들웨어 **순서**에
//    달려 있어서, 라이브러리만 테스트하면 "함수는 맞는데 라우트가 그 함수를 안 부르는"
//    상태가 그대로 통과한다.
const { test, describe, after, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-auth-test-'));
process.env.PH_DATA_DIR = tmpRoot;

const auth = require('../lib/auth');

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const usersFile = path.join(tmpRoot, 'users.json');
const clearUsers = () => fs.rmSync(usersFile, { force: true });

describe('비밀번호 해시', () => {
    test('같은 비밀번호도 매번 다른 해시가 되고, 검증은 통과한다', () => {
        const a = auth.hashPassword('correct horse battery');
        const b = auth.hashPassword('correct horse battery');
        assert.notEqual(a, b); // salt
        assert.ok(auth.verifyPassword('correct horse battery', a));
        assert.ok(auth.verifyPassword('correct horse battery', b));
    });

    test('틀린 비밀번호는 거부한다', () => {
        const h = auth.hashPassword('secret-password');
        assert.equal(auth.verifyPassword('secret-passworD', h), false);
        assert.equal(auth.verifyPassword('', h), false);
    });

    test('길이 제한이 위쪽에 없다 — 긴 비밀번호일수록 좋다', () => {
        const long = 'x'.repeat(200);
        assert.ok(auth.verifyPassword(long, auth.hashPassword(long)));
    });

    test('망가진 해시는 예외가 아니라 검증 실패다', () => {
        // 손으로 고친 users.json 이 서버를 500 으로 세우면 안 된다.
        for (const broken of ['', 'not-a-hash', 'scrypt$1$2$3', 'scrypt$a$b$c$d$e', null, 42]) {
            assert.equal(auth.verifyPassword('anything', broken), false);
        }
    });
});

describe('모드 — 사용자 목록이 곧 스위치다', () => {
    beforeEach(clearUsers);

    test('계정이 없으면 open', () => {
        assert.equal(auth.mode(), 'open');
    });

    test('계정이 생기면 enforced, 다 지우면 다시 open', () => {
        auth.createUser({ name: 'admin', password: 'password123', role: 'admin' });
        assert.equal(auth.mode(), 'enforced');
        auth.deleteUser('admin');
        assert.equal(auth.mode(), 'open');
    });

    test('users.json 이 깨져 있어도 목록은 빈 배열이다', () => {
        fs.writeFileSync(usersFile, '{{{');
        assert.deepEqual(auth.readUsers(), []);
        assert.equal(auth.mode(), 'open');
    });

    test('형식이 어긋난 항목은 무시한다 — 역할 없는 계정이 권한을 얻지 않는다', () => {
        fs.writeFileSync(usersFile, JSON.stringify({ users: [
            { name: 'ok', role: 'admin', hash: 'scrypt$x' },
            { name: 'no-role', hash: 'scrypt$x' },
            { name: 'bad role', role: 'wizard', hash: 'scrypt$x' },
        ] }));
        assert.deepEqual(auth.readUsers().map(u => u.name), ['ok']);
    });

    test('공개 표현에는 해시가 없다', () => {
        clearUsers();
        const u = auth.createUser({ name: 'someone', password: 'password123', role: 'editor' });
        assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'name', 'role']);
    });
});

describe('역할 서열', () => {
    test('admin ⊃ editor ⊃ viewer', () => {
        assert.ok(auth.atLeast('admin', 'editor'));
        assert.ok(auth.atLeast('editor', 'viewer'));
        assert.ok(auth.atLeast('viewer', 'viewer'));
        assert.equal(auth.atLeast('viewer', 'editor'), false);
        assert.equal(auth.atLeast('editor', 'admin'), false);
    });
});

describe('세션 토큰', () => {
    beforeEach(clearUsers);

    test('발급한 토큰은 그 사용자로 검증된다', () => {
        auth.createUser({ name: 'kim', password: 'password123', role: 'editor' });
        const token = auth.issueToken(auth.readUsers()[0]);
        assert.equal(auth.verifyToken(token).name, 'kim');
    });

    test('서명이 어긋난 토큰·만료된 토큰·없는 사용자는 모두 null', () => {
        auth.createUser({ name: 'kim', password: 'password123', role: 'editor' });
        const user = auth.readUsers()[0];
        const token = auth.issueToken(user);
        assert.equal(auth.verifyToken(token.slice(0, -2) + 'xx'), null);
        assert.equal(auth.verifyToken('garbage'), null);
        assert.equal(auth.verifyToken(auth.issueToken(user, Date.now() - auth.SESSION_TTL_MS - 1)), null);
        auth.deleteUser('kim');
        assert.equal(auth.verifyToken(token), null);
    });

    test('비밀번호를 바꾸면 기존 토큰이 무효가 된다', () => {
        // 서명 키에 비밀번호 해시가 섞여 있어서, 세션 목록 없이도 이게 성립한다.
        auth.createUser({ name: 'kim', password: 'password123', role: 'editor' });
        const token = auth.issueToken(auth.readUsers()[0]);
        auth.updateUser('kim', { password: 'a-new-password' });
        assert.equal(auth.verifyToken(token), null);
    });
});

describe('identify — 헤더는 명시적으로 신뢰할 때만 신원이다', () => {
    beforeEach(() => { clearUsers(); delete process.env.PH_TRUST_PROXY_AUTH; });
    after(() => { delete process.env.PH_TRUST_PROXY_AUTH; delete process.env.PH_API_TOKENS; });

    const req = (headers) => ({ headers });

    test('신뢰를 켜지 않으면 X-Auth-User 는 무시된다', () => {
        // 이걸 받아들이면 누구든 헤더 한 줄로 관리자가 된다.
        assert.equal(auth.identify(req({ 'x-auth-user': 'admin' })), null);
    });

    test('신뢰를 켜면 프록시 헤더가 신원이 된다', () => {
        process.env.PH_TRUST_PROXY_AUTH = '1';
        const who = auth.identify(req({ 'x-auth-user': 'sm.yoo' }));
        assert.equal(who.name, 'sm.yoo');
        assert.equal(who.via, 'proxy');
    });

    test('서비스 토큰은 사람 계정과 섞이지 않는 별도 신원이다', () => {
        process.env.PH_API_TOKENS = 'ai-agent:editor:s3cret-token';
        const who = auth.identify(req({ authorization: 'Bearer s3cret-token' }));
        assert.equal(who.name, 'ai-agent');
        assert.equal(who.role, 'editor');
        assert.equal(who.service, true);
        assert.equal(auth.identify(req({ authorization: 'Bearer wrong' })), null);
    });

    test('쿠키가 서비스 토큰보다 앞선다', () => {
        process.env.PH_API_TOKENS = 'ai-agent:editor:s3cret-token';
        auth.createUser({ name: 'kim', password: 'password123', role: 'admin' });
        const token = auth.issueToken(auth.readUsers()[0]);
        const who = auth.identify(req({
            cookie: `${auth.COOKIE_NAME}=${token}`,
            authorization: 'Bearer s3cret-token',
        }));
        assert.equal(who.name, 'kim');
        assert.equal(who.via, 'session');
    });
});

// ── 실제 서버 ────────────────────────────────────────
describe('HTTP — 게이트가 실제 라우트에 걸려 있다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-auth-http-'));
    const port = 3400 + Math.floor(Math.random() * 100);
    const base = `http://127.0.0.1:${port}`;
    let proc;
    let cookie = '';

    const call = async (method, url, body, headers = {}) => {
        const res = await fetch(base + url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        let json = null;
        try { json = await res.json(); } catch { /* 본문이 없을 수 있다 */ }
        return { status: res.status, json };
    };
    const asUser = () => ({ Cookie: cookie });

    before(async () => {
        proc = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
            env: { ...process.env, PH_DATA_DIR: dir, PORT: String(port), PH_LOG_LEVEL: 'error' },
            stdio: 'ignore',
        });
        for (let i = 0; i < 100; i++) {
            try { await fetch(`${base}/api/health`); return; } catch { /* 아직 */ }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('서버가 뜨지 않았다');
    });

    after(() => {
        proc?.kill();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('계정이 없으면 지금까지와 똑같다 — 읽기도 쓰기도 열려 있다', async () => {
        assert.equal((await call('GET', '/api/auth/me')).json.mode, 'open');
        assert.equal((await call('GET', '/api/tasks')).status, 200);
        assert.equal((await call('POST', '/api/tasks', { name: '열린 모드 작업' })).status, 201);
    });

    test('첫 관리자를 만들면 강제 모드로 넘어가고, 그 순간부터 익명은 막힌다', async () => {
        const setup = await call('POST', '/api/auth/setup', { name: 'admin', password: 'password123' });
        assert.equal(setup.status, 200);
        assert.equal(setup.json.user.role, 'admin');
        assert.ok(cookie.startsWith(`${auth.COOKIE_NAME}=`));

        assert.equal((await call('GET', '/api/tasks')).status, 401);
        assert.equal((await call('GET', '/api/tasks', undefined, asUser())).status, 200);
    });

    test('두 번째 setup 은 거부된다 — 아무나 관리자가 되는 문이 아니다', async () => {
        assert.equal((await call('POST', '/api/auth/setup', { name: 'nope', password: 'password123' })).status, 409);
    });

    test('health 와 가이드는 인증 없이 열려 있다 — 나머지 /api 는 아니다', async () => {
        assert.equal((await call('GET', '/api/health')).status, 200);
        assert.equal((await call('GET', '/api')).status, 200);
        assert.equal((await call('GET', '/api/guide')).status, 200);
        // 접두어 매처였다면 여기가 열린다.
        assert.equal((await call('GET', '/api/health/')).status, 401);
        assert.equal((await call('GET', '/api/data')).status, 401);
        assert.equal((await call('GET', '/api/settings')).status, 401);
    });

    test('로그인은 틀린 비밀번호를 구분해 주지 않고, 맞으면 쿠키를 준다', async () => {
        const bad = await call('POST', '/api/auth/login', { name: 'admin', password: 'wrong-password' });
        assert.equal(bad.status, 401);
        const missing = await call('POST', '/api/auth/login', { name: 'ghost', password: 'wrong-password' });
        assert.equal(missing.status, 401);
        assert.equal(bad.json.error, missing.json.error);

        const ok = await call('POST', '/api/auth/login', { name: 'admin', password: 'password123' });
        assert.equal(ok.status, 200);
        assert.equal((await call('GET', '/api/auth/me', undefined, asUser())).json.user.name, 'admin');
    });

    test('viewer 는 읽을 수 있지만 쓰지 못한다', async () => {
        const adminCookie = cookie;
        assert.equal((await call('POST', '/api/users',
            { name: 'reader', password: 'password123', role: 'viewer' }, { Cookie: adminCookie })).status, 201);

        cookie = '';
        await call('POST', '/api/auth/login', { name: 'reader', password: 'password123' });
        const readerCookie = cookie;
        assert.equal((await call('GET', '/api/tasks', undefined, { Cookie: readerCookie })).status, 200);
        const denied = await call('POST', '/api/tasks', { name: '막혀야 한다' }, { Cookie: readerCookie });
        assert.equal(denied.status, 403);
        // 계정 관리도 막힌다.
        assert.equal((await call('GET', '/api/users', undefined, { Cookie: readerCookie })).status, 403);
        cookie = adminCookie;
    });

    test('editor 는 쓰지만 프로젝트를 지우지는 못한다 — 그건 전원의 데이터다', async () => {
        const adminCookie = cookie;
        await call('POST', '/api/users', { name: 'writer', password: 'password123', role: 'editor' }, { Cookie: adminCookie });
        const created = await call('POST', '/api/projects', { name: '지울 프로젝트' }, { Cookie: adminCookie });
        assert.equal(created.status, 201);
        const pid = created.json.project.id;

        cookie = '';
        await call('POST', '/api/auth/login', { name: 'writer', password: 'password123' });
        const writerCookie = cookie;
        assert.equal((await call('POST', `/api/projects/${pid}/tasks`, { name: '쓸 수 있다' }, { Cookie: writerCookie })).status, 201);
        assert.equal((await call('DELETE', `/api/projects/${pid}`, undefined, { Cookie: writerCookie })).status, 403);
        assert.equal((await call('DELETE', `/api/projects/${pid}`, undefined, { Cookie: adminCookie })).status, 200);
        cookie = adminCookie;
    });

    test('마지막 관리자는 지울 수도 강등할 수도 없다', async () => {
        assert.equal((await call('DELETE', '/api/users/admin', undefined, asUser())).status, 409);
        assert.equal((await call('PATCH', '/api/users/admin', { role: 'editor' }, asUser())).status, 409);
    });

    test('감사 로그의 actor 가 로그인한 사람이다 — 헤더로 위조되지 않는다', async () => {
        const adminCookie = cookie;
        await call('POST', '/api/tasks', { name: '누가 만들었나' },
            { Cookie: adminCookie, 'X-Auth-User': 'someone-else' });
        const events = await call('GET', '/api/events?limit=5', undefined, { Cookie: adminCookie });
        assert.equal(events.json.data[0].actor, 'admin'); // 최신순
        assert.equal(events.json.data[0].op, 'POST /api/tasks');
    });

    test('서비스 토큰으로도 쓸 수 있다 — AI·MCP 는 쿠키를 들고 다닐 수 없다', async () => {
        // 이 서버 프로세스에는 PH_API_TOKENS 가 없으므로 거부되는 쪽을 확인한다.
        assert.equal((await call('GET', '/api/tasks', undefined, { Authorization: 'Bearer whatever' })).status, 401);
    });

    test('자기 비밀번호는 스스로 바꾸고, 그 자리에서 로그아웃되지 않는다', async () => {
        const before = cookie;
        const res = await call('PATCH', '/api/users/admin', { password: 'another-password' }, { Cookie: before });
        assert.equal(res.status, 200);
        assert.notEqual(cookie, before);                       // 새 토큰이 발급됐다
        assert.equal((await call('GET', '/api/tasks', undefined, { Cookie: before })).status, 401); // 옛 토큰은 죽었다
        assert.equal((await call('GET', '/api/tasks', undefined, asUser())).status, 200);
    });

    test('짧은 비밀번호는 거부한다', async () => {
        assert.equal((await call('POST', '/api/users', { name: 'weak', password: 'short' }, asUser())).status, 400);
    });

    test('로그아웃하면 쿠키가 지워진다', async () => {
        const res = await call('POST', '/api/auth/logout', undefined, asUser());
        assert.equal(res.status, 200);
        assert.equal(cookie, `${auth.COOKIE_NAME}=`);
        assert.equal((await call('GET', '/api/tasks', undefined, asUser())).status, 401);
    });
});
