// 스토리지 유틸리티 — localStorage 캐시 + 서버 동기화 하이브리드
//
// 저장 전략:
//   - 읽기: 서버 우선 → 실패 시 localStorage 폴백
//   - 쓰기: localStorage 즉시 + 서버 비동기 (App.jsx에서 debounce 적용)
//   - 오프라인/네트워크 오류 시 localStorage만으로 동작 유지

const STORAGE_KEY = 'project-timeline-data';
const SETTINGS_KEY = 'project-timeline-settings';
const SNAPSHOTS_KEY = 'project-timeline-snapshots';
const API_BASE = '/api';

// 서버 데이터 리비전 추적 — 외부(AI API 등) 변경 감지 및 충돌 검출용
let knownRevision = null;

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
    // 프로젝트 데이터 로드 (서버 우선 → localStorage 폴백)
    loadData: async () => {
        try {
            const res = await apiFetch('/data');
            if (res.revision !== undefined) knownRevision = res.revision;
            if (res.data) {
                localSet(STORAGE_KEY, res.data); // 캐시 갱신
                return res.data;
            }
        } catch {
            console.warn('서버 로드 실패, localStorage 폴백');
        }
        return localGet(STORAGE_KEY);
    },

    // 프로젝트 데이터 저장 (localStorage 즉시 + 서버 If-Match 저장)
    // 반환: { ok } | { ok:false, conflict:true } — 409면 외부(AI 등)에서 먼저 수정한 것
    saveData: async (data) => {
        localSet(STORAGE_KEY, data);
        try {
            const res = await apiFetch('/data', {
                method: 'POST',
                headers: knownRevision != null ? { 'If-Match': String(knownRevision) } : {},
                body: JSON.stringify(data),
            });
            if (res.revision !== undefined) knownRevision = res.revision;
            return { ok: true };
        } catch (e) {
            if (e.status === 409) return { ok: false, conflict: true };
            console.warn('서버 저장 실패 (로컬 유지):', e);
            return { ok: false };
        }
    },

    // 현재 서버 리비전 조회 (폴링용, 실패 시 null)
    fetchRevision: async () => {
        try {
            const res = await apiFetch('/revision');
            return res.revision ?? null;
        } catch {
            return null;
        }
    },

    // 마지막으로 알고 있는 리비전
    getKnownRevision: () => knownRevision,

    // 설정 로드 (서버 우선 → localStorage 폴백)
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

    // 설정 저장
    saveSettings: (settings) => {
        // 기존 설정과 병합
        const current = localGet(SETTINGS_KEY) || {};
        const merged = { ...current, ...settings };
        localSet(SETTINGS_KEY, merged);
        apiFetch('/settings', { method: 'POST', body: JSON.stringify(merged) })
            .catch(e => console.warn('설정 서버 저장 실패:', e));
    },

    // 데이터 내보내기 (파일 다운로드 — 서버 불필요)
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

    // 데이터 가져오기 (파일 읽기 — 서버 불필요)
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

    // 모든 데이터 삭제
    clearAll: () => {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem(SNAPSHOTS_KEY);
            return true;
        } catch { return false; }
    },

    // 스냅샷 목록 로드 (서버 우선 → localStorage 폴백)
    loadSnapshots: async () => {
        try {
            const res = await apiFetch('/snapshots');
            if (res.data) {
                localSet(SNAPSHOTS_KEY, res.data);
                return res.data;
            }
        } catch {
            console.warn('스냅샷 서버 로드 실패, localStorage 폴백');
        }
        return localGet(SNAPSHOTS_KEY) || [];
    },

    // 스냅샷 저장
    saveSnapshot: async (name, data) => {
        try {
            const res = await apiFetch('/snapshots', {
                method: 'POST',
                body: JSON.stringify({ name, data }),
            });
            // 서버 결과로 로컬 캐시 갱신
            const snapshots = localGet(SNAPSHOTS_KEY) || [];
            snapshots.unshift(res.snapshot);
            localSet(SNAPSHOTS_KEY, snapshots);
            return true;
        } catch (e) {
            console.error('스냅샷 저장 실패:', e);
            return false;
        }
    },

    // 스냅샷 업데이트
    updateSnapshot: async (id, data) => {
        try {
            await apiFetch(`/snapshots/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ data }),
            });
            // 로컬 캐시도 갱신
            const snapshots = localGet(SNAPSHOTS_KEY) || [];
            const index = snapshots.findIndex(s => s.id === id);
            if (index !== -1) {
                const updated = { ...snapshots[index], date: new Date().toISOString(), data };
                snapshots.splice(index, 1);
                snapshots.unshift(updated);
                localSet(SNAPSHOTS_KEY, snapshots);
            }
            return true;
        } catch (e) {
            console.error('스냅샷 업데이트 실패:', e);
            return false;
        }
    },

    // 스냅샷 삭제
    deleteSnapshot: async (id) => {
        try {
            await apiFetch(`/snapshots/${id}`, { method: 'DELETE' });
            const snapshots = localGet(SNAPSHOTS_KEY) || [];
            localSet(SNAPSHOTS_KEY, snapshots.filter(s => s.id !== id));
            return true;
        } catch (e) {
            console.error('스냅샷 삭제 실패:', e);
            return false;
        }
    },
};
