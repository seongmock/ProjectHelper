// 인증 API 얇은 래퍼. storage.js 와 같은 `/api` 베이스를 쓰지만 캐시가 없다 —
// 신원은 캐시해서 좋을 것이 하나도 없다(로컬 캐시가 "로그인된 것처럼" 보이면 최악이다).
const API = '/api';

const call = async (path, options = {}) => {
    const res = await fetch(API + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* 본문 없는 응답 */ }
    if (!res.ok) {
        const err = new Error(body?.error || `요청 실패 (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return body;
};

export const authApi = {
    // { mode: 'open'|'enforced', user: {name, role} | null }
    me: () => call('/auth/me'),
    login: (name, password) => call('/auth/login', { method: 'POST', body: JSON.stringify({ name, password }) }),
    logout: () => call('/auth/logout', { method: 'POST' }),
    // 계정이 하나도 없을 때만 열려 있다 — 이 호출이 성공하는 순간 강제 모드가 된다.
    setup: (name, password) => call('/auth/setup', { method: 'POST', body: JSON.stringify({ name, password }) }),

    listUsers: () => call('/users').then(r => r.users),
    createUser: (name, password, role) => call('/users', { method: 'POST', body: JSON.stringify({ name, password, role }) }),
    updateUser: (name, patch) => call(`/users/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteUser: (name) => call(`/users/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};
