// 스토리지 유틸리티 — localStorage 캐시 + 서버 동기화 하이브리드 (프로젝트 스코프)
//
// 저장 전략:
//   - 읽기: 서버 우선 → 실패 시 localStorage 폴백
//   - 쓰기: localStorage 즉시 + 서버 비동기 (App.jsx에서 debounce 적용)
//   - 오프라인/네트워크 오류 시 localStorage만으로 동작 유지
//
// 프로젝트 스코프:
//   - 모듈 레벨 currentProjectId가 모든 데이터/스냅샷 경로와 캐시 키를 결정
//   - knownRevision은 "현재 프로젝트의 리비전" — setProject 시 함께 리셋
//   - epoch 가드: 프로젝트 전환 후 도착한 이전 프로젝트의 늦은 응답이
//     리비전/캐시를 오염시키지 못하게 한다

const SETTINGS_KEY = 'project-timeline-settings'; // 설정은 전역 (사용자별 설정은 v2.0 과제)
const ACTIVE_PROJECT_KEY = 'project-timeline-active-project';
const API_BASE = '/api';

// ── 프로젝트 스코프 모듈 상태 ─────────────────────────────────────────────
let currentProjectId = 'default';
let knownRevision = null;
let epoch = 0; // setProject마다 증가 — 늦은 응답 무효화

const dataKey = (pid) => `project-timeline-data:${pid}`;
const snapshotsKey = (pid) => `project-timeline-snapshots:${pid}`;
const projectPath = (pid) => `/projects/${pid}`;

// 1회성 localStorage 키 마이그레이션: 구버전 무접미사 키 → :default
try {
    if (localStorage.getItem('project-timeline-data') && !localStorage.getItem(dataKey('default'))) {
        localStorage.setItem(dataKey('default'), localStorage.getItem('project-timeline-data'));
        localStorage.removeItem('project-timeline-data');
    }
    if (localStorage.getItem('project-timeline-snapshots') && !localStorage.getItem(snapshotsKey('default'))) {
        localStorage.setItem(snapshotsKey('default'), localStorage.getItem('project-timeline-snapshots'));
        localStorage.removeItem('project-timeline-snapshots');
    }
} catch { /* localStorage 불가 환경 무시 */ }

// ── 내부 헬퍼 ──────────────────────────────────────────────────────────────

const localGet = (key) => {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch { return null; }
};

const localSet = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error('localStorage write failed:', e);
    }
};

const apiFetch = async (path, options = {}) => {
    const res = await fetch(API_BASE + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) {
        const err = new Error(`API ${path} failed: ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
};

// ── 공개 API ──────────────────────────────────────────────────────────────

export const storage = {
    // ── 프로젝트 스코프 제어 ──────────────────────────
    setProject: (pid) => {
        currentProjectId = pid;
        knownRevision = null;
        epoch++;
    },
    getProject: () => currentProjectId,

    listProjects: async () => (await apiFetch('/projects')).projects,
    createProject: async (name) => (await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) })).project,
    renameProject: async (pid, name) => (await apiFetch(`/projects/${pid}`, { method: 'PATCH', body: JSON.stringify({ name }) })).project,
    deleteProject: async (pid) => {
        await apiFetch(`/projects/${pid}`, { method: 'DELETE' });
        try {
            localStorage.removeItem(dataKey(pid));
            localStorage.removeItem(snapshotsKey(pid));
        } catch { /* 무시 */ }
        return true;
    },

    // ── 프로젝트 데이터 (현재 프로젝트 스코프) ────────
    // 로드: 서버 우선 → localStorage 폴백
    loadData: async () => {
        const pid = currentProjectId;
        const myEpoch = epoch;
        try {
            const res = await apiFetch(`${projectPath(pid)}/data`);
            if (res.revision !== undefined && myEpoch === epoch) knownRevision = res.revision;
            if (res.data) {
                localSet(dataKey(pid), res.data); // 캐시 갱신 (캡처한 pid 기준)
                return res.data;
            }
        } catch {
            console.warn('서버 로드 실패, localStorage 폴백');
        }
        return localGet(dataKey(pid));
    },

    // 저장 (localStorage 즉시 + 서버 If-Match)
    // 반환: { ok } | { ok:false, conflict:true } — 409면 외부(AI 등)에서 먼저 수정한 것
    saveData: async (data) => {
        const pid = currentProjectId;
        const myEpoch = epoch;
        localSet(dataKey(pid), data);
        try {
            const res = await apiFetch(`${projectPath(pid)}/data`, {
                method: 'POST',
                headers: knownRevision != null ? { 'If-Match': String(knownRevision) } : {},
                body: JSON.stringify(data),
            });
            if (res.revision !== undefined && myEpoch === epoch) knownRevision = res.revision;
            return { ok: true };
        } catch (e) {
            if (e.status === 409) return { ok: false, conflict: true };
            console.warn('서버 저장 실패 (로컬 유지):', e);
            return { ok: false };
        }
    },

    // 현재 프로젝트의 서버 리비전 조회 (폴링용, 실패 시 null)
    fetchRevision: async () => {
        try {
            const res = await apiFetch(`${projectPath(currentProjectId)}/revision`);
            return res.revision ?? null;
        } catch {
            return null;
        }
    },

    // 마지막으로 알고 있는 리비전
    getKnownRevision: () => knownRevision,

    // ── 설정 (전역) ───────────────────────────────────
    loadSettings: async () => {
        try {
            const res = await apiFetch('/settings');
            if (res.data) {
                localSet(SETTINGS_KEY, res.data);
                return res.data;
            }
        } catch {
            console.warn('설정 서버 로드 실패, localStorage 폴백');
        }
        return localGet(SETTINGS_KEY);
    },

    saveSettings: (settings) => {
        // 기존 설정과 병합
        const current = localGet(SETTINGS_KEY) || {};
        const merged = { ...current, ...settings };
        localSet(SETTINGS_KEY, merged);
        apiFetch('/settings', { method: 'POST', body: JSON.stringify(merged) })
            .catch(e => console.warn('설정 서버 저장 실패:', e));
    },

    // ── 파일 내보내기/가져오기 (서버 불필요) ──────────
    exportData: (data, filename = 'project-timeline.json') => {
        try {
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
            return true;
        } catch (error) {
            console.error('Failed to export data:', error);
            return false;
        }
    },

    importData: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    // 허용 형식: 배열(bare tasks) 또는 { data: [...] } (내보내기 형식)
                    const isValid = Array.isArray(parsed) ||
                        (parsed && Array.isArray(parsed.data));
                    if (!isValid) {
                        reject(new Error('Invalid format: expected an array or { data: [...] }'));
                        return;
                    }
                    resolve(parsed);
                }
                catch (error) {
                    console.error('Import parse error:', error);
                    reject(error);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    },

    // 현재 프로젝트의 로컬 데이터 삭제
    clearAll: () => {
        try {
            localStorage.removeItem(dataKey(currentProjectId));
            localStorage.removeItem(snapshotsKey(currentProjectId));
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem(ACTIVE_PROJECT_KEY);
            return true;
        } catch { return false; }
    },

    // ── 스냅샷 (현재 프로젝트 스코프) ─────────────────
    loadSnapshots: async () => {
        const pid = currentProjectId;
        try {
            const res = await apiFetch(`${projectPath(pid)}/snapshots`);
            if (res.data) {
                localSet(snapshotsKey(pid), res.data);
                return res.data;
            }
        } catch {
            console.warn('스냅샷 서버 로드 실패, localStorage 폴백');
        }
        return localGet(snapshotsKey(pid)) || [];
    },

    saveSnapshot: async (name, data) => {
        const pid = currentProjectId;
        try {
            const res = await apiFetch(`${projectPath(pid)}/snapshots`, {
                method: 'POST',
                body: JSON.stringify({ name, data }),
            });
            const snapshots = localGet(snapshotsKey(pid)) || [];
            snapshots.unshift(res.snapshot);
            localSet(snapshotsKey(pid), snapshots);
            return true;
        } catch (e) {
            console.error('스냅샷 저장 실패:', e);
            return false;
        }
    },

    updateSnapshot: async (id, data) => {
        const pid = currentProjectId;
        try {
            await apiFetch(`${projectPath(pid)}/snapshots/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ data }),
            });
            const snapshots = localGet(snapshotsKey(pid)) || [];
            const index = snapshots.findIndex(s => s.id === id);
            if (index !== -1) {
                const updated = { ...snapshots[index], date: new Date().toISOString(), data };
                snapshots.splice(index, 1);
                snapshots.unshift(updated);
                localSet(snapshotsKey(pid), snapshots);
            }
            return true;
        } catch (e) {
            console.error('스냅샷 업데이트 실패:', e);
            return false;
        }
    },

    deleteSnapshot: async (id) => {
        const pid = currentProjectId;
        try {
            await apiFetch(`${projectPath(pid)}/snapshots/${id}`, { method: 'DELETE' });
            const snapshots = localGet(snapshotsKey(pid)) || [];
            localSet(snapshotsKey(pid), snapshots.filter(s => s.id !== id));
            return true;
        } catch (e) {
            console.error('스냅샷 삭제 실패:', e);
            return false;
        }
    },
};
