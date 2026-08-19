// 로그인/로그아웃/계정 관리. 쿠키를 만져야 해서 httpAdapter 의 `route()` 대신 res 를
// 직접 쓴다(그 어댑터는 본문만 반환하는 순수 핸들러용이다).
const express = require('express');
const auth = require('../lib/auth');
const { logger } = require('../lib/logger');

const router = express.Router();

const MIN_PASSWORD = 8;
// 상한은 정책이 아니라 방어선이다 — scrypt 에 임의 길이 입력을 넘기지 않기 위한 것.
// (예전 비밀번호 교체 도구에는 이유 없는 짧은 상한이 있었고 사용자가 문제 삼았다.)
const MAX_PASSWORD = 256;

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// ── 로그인 시도 제한 ─────────────────────────────────
// 계정 목록이 파일 하나뿐인 사내 도구라 정교한 방어는 과하지만, 아무 제한이 없으면
// 8자 비밀번호를 네트워크 너머에서 마음껏 두드릴 수 있다. 프로세스 메모리에만 둔다.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map(); // key -> { count, first }

const attemptKey = (req, name) => `${req.ip || 'unknown'}|${name}`;

const throttled = (key, now = Date.now()) => {
    const rec = attempts.get(key);
    if (!rec) return false;
    if (now - rec.first > ATTEMPT_WINDOW_MS) { attempts.delete(key); return false; }
    return rec.count >= MAX_ATTEMPTS;
};

const noteFailure = (key, now = Date.now()) => {
    const rec = attempts.get(key);
    if (!rec || now - rec.first > ATTEMPT_WINDOW_MS) attempts.set(key, { count: 1, first: now });
    else rec.count += 1;
};

const validCredentials = (body) => {
    const name = body?.name;
    const password = body?.password;
    if (!auth.isValidName(name)) return { error: 'invalid name' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        return { error: `password must be at least ${MIN_PASSWORD} characters` };
    }
    if (password.length > MAX_PASSWORD) return { error: 'password too long' };
    return { name, password };
};

// 토큰 서명에는 비밀번호 해시가 필요하다 — 공개 표현(publicUser)에는 그게 없으므로
// 여기서 이름으로 원본을 다시 읽는다.
const login = (res, name) => {
    const user = auth.findUser(name);
    res.setHeader('Set-Cookie', auth.sessionCookie(auth.issueToken(user)));
    return res.json({ ok: true, user: auth.publicUser(user) });
};

// ── 상태 ─────────────────────────────────────────────
// 화면이 로그인 창을 띄울지 말지를 이 응답 하나로 정한다. 계정이 없으면 mode:'open' 이고
// 앱은 지금까지와 똑같이 뜬다 — 이 기능은 계정을 만들기 전까지 잠들어 있다.
router.get('/auth/me', (req, res) => {
    res.json({ ok: true, mode: auth.mode(), user: req.authUser || null });
});

// ── 최초 관리자 ──────────────────────────────────────
// 계정이 하나도 없을 때만 열린다. 여기가 닫혀 있으면 강제 모드로 들어갈 방법이 없고,
// 열려 있으면 누구나 관리자가 되므로 **정확히 그 순간에만** 열려야 한다.
router.post('/auth/setup', (req, res) => {
    if (auth.mode() !== 'open') return fail(res, 409, 'already initialized');
    const cred = validCredentials(req.body);
    if (cred.error) return fail(res, 400, cred.error);
    const user = auth.createUser({ name: cred.name, password: cred.password, role: 'admin' });
    logger.info('auth setup', { actor: user.name });
    return login(res, user.name);
});

router.post('/auth/login', (req, res) => {
    const name = req.body?.name;
    const password = req.body?.password;
    if (!auth.isValidName(name) || typeof password !== 'string') {
        return fail(res, 400, 'invalid credentials');
    }
    const key = attemptKey(req, name);
    if (throttled(key)) return fail(res, 429, 'too many attempts — try again later');

    const user = auth.findUser(name);
    // 존재하지 않는 계정과 틀린 비밀번호를 구분해 주지 않는다.
    if (!user || !auth.verifyPassword(password, user.hash)) {
        noteFailure(key);
        logger.warn('login failed', { name });
        return fail(res, 401, 'invalid credentials');
    }
    attempts.delete(key);
    logger.info('login', { actor: user.name, role: user.role });
    return login(res, user.name);
});

router.post('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearCookie());
    res.json({ ok: true });
});

// ── 계정 관리 (관리자) ───────────────────────────────
const requireAdmin = (req, res, next) => {
    if (!req.authUser) return fail(res, 401, 'authentication required');
    if (req.authUser.role !== 'admin') return fail(res, 403, 'admin role required');
    next();
};

router.get('/users', requireAdmin, (req, res) => {
    res.json({ ok: true, users: auth.readUsers().map(auth.publicUser) });
});

router.post('/users', requireAdmin, (req, res) => {
    const cred = validCredentials(req.body);
    if (cred.error) return fail(res, 400, cred.error);
    const role = req.body?.role || 'editor';
    if (!auth.isRole(role)) return fail(res, 400, 'invalid role');
    if (auth.findUser(cred.name)) return fail(res, 409, 'user already exists');
    const user = auth.createUser({ name: cred.name, password: cred.password, role });
    logger.info('user created', { actor: req.authUser.name, target: user.name, role });
    res.status(201).json({ ok: true, user });
});

// 자기 비밀번호는 스스로 바꾼다 — 관리자에게 부탁해야 한다면 아무도 바꾸지 않는다.
// 역할은 관리자만 바꾼다(스스로 승급하면 권한 구분이 없는 것과 같다).
router.patch('/users/:name', (req, res) => {
    const target = req.params.name;
    const me = req.authUser;
    if (!me) return fail(res, 401, 'authentication required');
    const isSelf = me.name === target;
    if (!isSelf && me.role !== 'admin') return fail(res, 403, 'admin role required');
    if (!auth.findUser(target)) return fail(res, 404, 'user not found');

    const { password, role } = req.body || {};
    if (role !== undefined) {
        if (me.role !== 'admin') return fail(res, 403, 'admin role required');
        if (!auth.isRole(role)) return fail(res, 400, 'invalid role');
        // 마지막 관리자가 스스로 강등하면 계정 관리가 영영 불가능해진다.
        if (role !== 'admin' && auth.findUser(target).role === 'admin' && auth.adminCount() <= 1) {
            return fail(res, 409, 'the last admin cannot be demoted');
        }
    }
    if (password !== undefined) {
        const cred = validCredentials({ name: target, password });
        if (cred.error) return fail(res, 400, cred.error);
    }
    if (password === undefined && role === undefined) return fail(res, 400, 'nothing to update');

    const updated = auth.updateUser(target, { password, role });
    logger.info('user updated', { actor: me.name, target, role: role || updated.role });
    // 비밀번호가 바뀌면 그 사용자의 토큰이 전부 무효가 된다(서명 키에 해시가 섞여 있다).
    // 자기 비밀번호를 바꾼 경우에는 새 토큰을 바로 발급해 주지 않으면 방금 자기 자신이
    // 로그아웃된다.
    if (isSelf && password !== undefined) {
        return login(res, target);
    }
    res.json({ ok: true, user: updated });
});

router.delete('/users/:name', requireAdmin, (req, res) => {
    const target = auth.findUser(req.params.name);
    if (!target) return fail(res, 404, 'user not found');
    // 마지막 관리자를 지우면 계정을 만들 수도 지울 수도 없는 상태가 된다.
    // (계정이 0 이 되면 open 모드로 돌아가지만, 그건 **전체가 열리는** 것이라 더 나쁘다.)
    if (target.role === 'admin' && auth.adminCount() <= 1) {
        return fail(res, 409, 'the last admin cannot be deleted');
    }
    auth.deleteUser(target.name);
    logger.info('user deleted', { actor: req.authUser.name, target: target.name });
    res.json({ ok: true });
});

module.exports = router;
