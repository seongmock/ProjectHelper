// 신원과 권한. 지금까지 이 앱의 "사용자"는 Caddy basicauth 단일 계정이 보내는
// `X-Auth-User` 문자열 하나였고, 그 값은 **기록만 되고 아무것도 막지 않았다** — 팀이 함께
// 쓰면 감사 로그의 actor 가 전원 같은 값이 되어 "누가 지웠나"에 답할 수 없다(P3-3).
//
// 세 가지 판단이 이 파일의 뼈대다.
//
// ① **켜고 끄는 스위치를 두지 않는다 — 사용자 목록이 곧 스위치다.** 계정이 하나도 없으면
//    `open` 모드로 지금까지와 똑같이 동작하고(누구나 읽고 쓴다), 첫 관리자를 만드는 순간
//    `enforced` 로 바뀐다. 환경변수 스위치였다면 "켰는데 계정이 없어 아무도 못 들어가는"
//    상태와 "껐는데 계정이 있어 아무 의미 없는" 상태가 둘 다 만들어진다.
//
// ② **의존성을 늘리지 않는다.** bcrypt 는 네이티브 빌드라 Docker 이미지와 재현가능 빌드에
//    부담이 된다(P3-1 에서 better-sqlite3 를 미룬 것과 같은 이유). 표준 `crypto` 의 scrypt 는
//    같은 목적의 메모리-하드 KDF 이고 Node 에 이미 있다.
//
// ③ **세션 서버를 두지 않는다.** 토큰은 HMAC 으로 서명한 무상태 쿠키다. 서명 키에 그 사용자의
//    **비밀번호 해시를 섞기 때문에**, 비밀번호를 바꾸면 그 사용자의 기존 토큰이 전부 무효가
//    된다 — 서버에 세션 목록을 들고 있지 않아도 "비밀번호를 바꾸면 로그아웃된다"가 성립한다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const USERS_FILE = () => path.join(store.DATA_DIR, 'users.json');
const SECRET_FILE = () => path.join(store.DATA_DIR, 'session-secret');

const COOKIE_NAME = 'ph_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 — 사내 도구 기준 하루 업무시간

// 권한은 포함 관계다: admin ⊃ editor ⊃ viewer. 배열 순서가 그 서열이다.
const ROLES = ['viewer', 'editor', 'admin'];
const isRole = (r) => ROLES.includes(r);
const atLeast = (role, need) => ROLES.indexOf(role) >= ROLES.indexOf(need);

const NAME_RE = /^[A-Za-z0-9._@-]{2,64}$/;
const isValidName = (name) => typeof name === 'string' && NAME_RE.test(name);

// ── 비밀번호 ─────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const hashPassword = (password) => {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
};

// 형식이 깨진 해시는 "검증 실패"이지 예외가 아니다 — 손으로 고친 users.json 이
// 서버를 500 으로 세우면 안 된다.
const verifyPassword = (password, stored) => {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, keyB64] = parts;
    try {
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(keyB64, 'base64');
        const actual = crypto.scryptSync(password, salt, expected.length,
            { N: Number(N), r: Number(r), p: Number(p) });
        return crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
};

// ── 사용자 저장소 ────────────────────────────────────
const readUsers = () => {
    const raw = store.readJsonSafe(USERS_FILE());
    const users = Array.isArray(raw?.users) ? raw.users : [];
    return users.filter(u => u && isValidName(u.name) && isRole(u.role) && typeof u.hash === 'string');
};

const writeUsers = (users) => store.writeJsonAtomic(USERS_FILE(), { users });

const findUser = (name) => readUsers().find(u => u.name === name) || null;

// 계정이 하나라도 있으면 강제된다. 이 한 줄이 기능 전체의 스위치다.
const mode = () => (readUsers().length > 0 ? 'enforced' : 'open');

const publicUser = (u) => (u ? { name: u.name, role: u.role, createdAt: u.createdAt } : null);

const createUser = ({ name, password, role }) => {
    const users = readUsers();
    users.push({ name, role, hash: hashPassword(password), createdAt: new Date().toISOString() });
    writeUsers(users);
    return publicUser(users[users.length - 1]);
};

const updateUser = (name, { password, role }) => {
    const users = readUsers();
    const user = users.find(u => u.name === name);
    if (!user) return null;
    if (password) user.hash = hashPassword(password);
    if (role) user.role = role;
    writeUsers(users);
    return publicUser(user);
};

const deleteUser = (name) => {
    const users = readUsers();
    const next = users.filter(u => u.name !== name);
    if (next.length === users.length) return false;
    writeUsers(next);
    return true;
};

const adminCount = (users = readUsers()) => users.filter(u => u.role === 'admin').length;

// ── 세션 토큰 ────────────────────────────────────────
// 키는 재시작에도 살아 있어야 한다 — 그렇지 않으면 컨테이너를 다시 띄울 때마다 전원이
// 로그아웃된다. 환경변수가 없으면 데이터 디렉토리에 만들어 두고 재사용한다(0600).
let cachedSecret = null;
const secret = () => {
    if (process.env.PH_SESSION_SECRET) return process.env.PH_SESSION_SECRET;
    if (cachedSecret) return cachedSecret;
    const file = SECRET_FILE();
    try {
        cachedSecret = fs.readFileSync(file, 'utf-8').trim();
        if (cachedSecret) return cachedSecret;
    } catch { /* 없으면 만든다 */ }
    cachedSecret = crypto.randomBytes(32).toString('base64');
    try {
        fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
    } catch { /* 쓰지 못해도 이번 프로세스 동안은 동작한다 */ }
    return cachedSecret;
};

// 서명 키에 사용자의 비밀번호 해시를 섞는다 → 비밀번호 변경이 곧 토큰 무효화다.
const signingKey = (user) => crypto.createHmac('sha256', secret()).update(user.hash).digest();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const issueToken = (user, now = Date.now()) => {
    const payload = b64url(JSON.stringify({ n: user.name, exp: now + SESSION_TTL_MS }));
    const sig = b64url(crypto.createHmac('sha256', signingKey(user)).update(payload).digest());
    return `${payload}.${sig}`;
};

// 반환: 유효하면 사용자(공개 필드), 아니면 null. 서명·만료·사용자 존재 중 하나라도
// 어긋나면 같은 null 이다 — 어디서 틀렸는지는 공격자에게 알려 줄 정보가 아니다.
const verifyToken = (token, now = Date.now()) => {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    let data;
    try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    } catch {
        return null;
    }
    const user = findUser(data?.n);
    if (!user) return null;
    const expected = crypto.createHmac('sha256', signingKey(user)).update(payload).digest();
    const given = Buffer.from(sig || '', 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    if (!Number.isFinite(data.exp) || data.exp < now) return null;
    return publicUser(user);
};

// ── 쿠키 ─────────────────────────────────────────────
const parseCookies = (header) => {
    const out = {};
    String(header || '').split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i < 0) return;
        const k = part.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
};

// Secure 는 **브라우저가 보는 URL** 로 판정된다(Caddy 뒤의 API 는 평문 http 로 받는다).
// 그래서 서버가 자기 프로토콜로 정할 수 없고, 배포 여부로 정한다.
const cookieSecure = () => (process.env.PH_COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? '1' : '0')) === '1';

const sessionCookie = (token) => {
    const attrs = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
    if (cookieSecure()) attrs.push('Secure');
    return attrs.join('; ');
};

const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ── 서비스 토큰 (AI·MCP 용) ──────────────────────────
// 사람이 아닌 호출자는 쿠키를 들고 다닐 수 없다. `PH_API_TOKENS` 에 `이름:역할:토큰` 을
// 쉼표로 나열한다. 공유 계정이 아니라 **서비스 신원**이므로 감사 로그의 actor 도 그 이름이
// 되고, 사람 계정과 섞이지 않는다.
const serviceTokens = () => String(process.env.PH_API_TOKENS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
        const [name, role, token] = entry.split(':');
        return { name, role: isRole(role) ? role : 'editor', token };
    })
    .filter(t => t.name && t.token);

const bearerUser = (header) => {
    const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
    if (!m) return null;
    const given = Buffer.from(m[1]);
    const hit = serviceTokens().find(t => {
        const expected = Buffer.from(t.token);
        return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
    return hit ? { name: hit.name, role: hit.role, service: true } : null;
};

// ── 요청 → 신원 ──────────────────────────────────────
// 순서: 세션 쿠키 → 서비스 토큰 → 신뢰하는 프록시 헤더.
//
// 프록시 헤더는 **명시적으로 신뢰를 켰을 때만** 신원이 된다. 켜지 않았는데 받아들이면
// 클라이언트가 `X-Auth-User: admin` 을 직접 붙여 아무나 관리자가 된다(CLAUDE.md 가 감사
// 로그 위조 위험으로 이미 지적한 그 헤더다). basicauth·SSO 를 앞단에 다시 붙일 때
// `PH_TRUST_PROXY_AUTH=1` 로 켠다.
const identify = (req) => {
    const cookies = parseCookies(req.headers?.cookie);
    const fromCookie = verifyToken(cookies[COOKIE_NAME]);
    if (fromCookie) return { ...fromCookie, via: 'session' };

    const fromToken = bearerUser(req.headers?.authorization);
    if (fromToken) return { ...fromToken, via: 'token' };

    if (process.env.PH_TRUST_PROXY_AUTH === '1') {
        const name = req.headers?.['x-auth-user'];
        if (name && isValidName(name)) {
            const known = findUser(name);
            const role = known?.role || (isRole(process.env.PH_PROXY_ROLE) ? process.env.PH_PROXY_ROLE : 'editor');
            return { name, role, via: 'proxy' };
        }
    }
    return null;
};

module.exports = {
    COOKIE_NAME, ROLES, SESSION_TTL_MS,
    isRole, atLeast, isValidName,
    hashPassword, verifyPassword,
    readUsers, findUser, createUser, updateUser, deleteUser, adminCount, publicUser,
    mode, issueToken, verifyToken, identify,
    sessionCookie, clearCookie, parseCookies,
};
