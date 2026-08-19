// `settingsStore` — "사용자 조작만 저장한다"를 **구조로** 강제하는 것이 이 스토어의 존재
// 이유다. 예전에는 서버 로드가 끝나기 전에 기본값이 저장 effect 를 깨워 서버 설정을
// 덮어썼고, 그것을 가드 하나로 막고 있었다(잊으면 조용히 재발한다).
//
// 그래서 여기서 보는 것은 값이 아니라 **누가 저장을 부르는가**다:
//   setSetting/toggleSetting/importSettings → 저장한다
//   applyServerSettings/followSystemDarkMode → 저장하지 않는다 (에코 금지)
import { describe, it, expect, beforeEach, vi } from 'vitest';

const saveSettings = vi.fn();

vi.mock('../../src/utils/storage', () => ({
    storage: { saveSettings: (...args) => saveSettings(...args) },
}));

const CACHE_KEY = 'project-timeline-settings';

const freshStore = async ({ cache = null, systemDark = false } = {}) => {
    vi.resetModules();
    saveSettings.mockClear();
    const map = new Map(cache ? [[CACHE_KEY, JSON.stringify(cache)]] : []);
    vi.stubGlobal('localStorage', {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: systemDark }) });
    return import('../../src/stores/settingsStore.js');
};

beforeEach(() => { vi.unstubAllGlobals(); });

describe('초기값', () => {
    it('캐시가 없으면 기본값이다', async () => {
        const { useSettingsStore, SETTING_DEFAULTS } = await freshStore();
        const state = useSettingsStore.getState();
        expect(state.timeScale).toBe(SETTING_DEFAULTS.timeScale);
        expect(state.zoomLevel).toBe(SETTING_DEFAULTS.zoomLevel);
    });

    it('캐시가 있으면 그것으로 동기 초기화한다 (첫 페인트에 기본값이 번쩍이지 않게)', async () => {
        const { useSettingsStore } = await freshStore({ cache: { zoomLevel: 2.5, isCompact: true } });
        expect(useSettingsStore.getState()).toMatchObject({ zoomLevel: 2.5, isCompact: true });
    });

    it('캐시가 깨져 있어도 기본값으로 뜬다 (설정 하나 때문에 앱이 안 뜨면 안 된다)', async () => {
        vi.resetModules();
        vi.stubGlobal('localStorage', { getItem: () => '{{{망가진 JSON' });
        vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
        const { useSettingsStore, SETTING_DEFAULTS } = await import('../../src/stores/settingsStore.js');
        expect(useSettingsStore.getState().timeScale).toBe(SETTING_DEFAULTS.timeScale);
    });

    it('darkMode 미설정이면 시스템 설정을 따른다', async () => {
        expect((await freshStore({ systemDark: true })).useSettingsStore.getState().darkMode).toBe(true);
        expect((await freshStore({ systemDark: false })).useSettingsStore.getState().darkMode).toBe(false);
    });

    it('명시적으로 정해 둔 darkMode 는 시스템을 이긴다', async () => {
        const { useSettingsStore } = await freshStore({ cache: { darkMode: false }, systemDark: true });
        expect(useSettingsStore.getState().darkMode).toBe(false);
    });

    it('알 수 없는 키는 스토어에 들어오지 않는다', async () => {
        const { useSettingsStore } = await freshStore({ cache: { 낯선키: 1, zoomLevel: 3 } });
        expect(useSettingsStore.getState().낯선키).toBeUndefined();
        expect(useSettingsStore.getState().zoomLevel).toBe(3);
    });
});

describe('사용자 조작은 저장한다', () => {
    it('setSetting 은 상태를 바꾸고 저장한다', async () => {
        const { useSettingsStore } = await freshStore();
        useSettingsStore.getState().setSetting({ timeScale: 'weekly' });
        expect(useSettingsStore.getState().timeScale).toBe('weekly');
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(saveSettings.mock.calls[0][0]).toMatchObject({ timeScale: 'weekly' });
    });

    it('저장 payload 에는 알려진 키만 실린다 (액션 함수가 서버로 새어 나가면 안 된다)', async () => {
        const { useSettingsStore, SETTING_DEFAULTS } = await freshStore();
        useSettingsStore.getState().setSetting({ zoomLevel: 2 });
        expect(Object.keys(saveSettings.mock.calls[0][0]).sort())
            .toEqual(Object.keys(SETTING_DEFAULTS).sort());
    });

    it('toggleSetting 은 뒤집고 저장한다', async () => {
        const { useSettingsStore } = await freshStore({ cache: { showToday: true } });
        useSettingsStore.getState().toggleSetting('showToday');
        expect(useSettingsStore.getState().showToday).toBe(false);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('가져온 설정은 사용자의 명시적 선택이므로 적용하고 저장한다', async () => {
        const { useSettingsStore } = await freshStore();
        useSettingsStore.getState().importSettings({ chartTheme: 'ocean', 낯선키: 1 });
        expect(useSettingsStore.getState().chartTheme).toBe('ocean');
        expect(saveSettings).toHaveBeenCalledWith({ chartTheme: 'ocean' });
    });

    it('가져온 설정에 알려진 키가 하나도 없으면 아무 일도 하지 않는다', async () => {
        const { useSettingsStore } = await freshStore();
        useSettingsStore.getState().importSettings({ 낯선키: 1 });
        expect(saveSettings).not.toHaveBeenCalled();
    });
});

describe('서버/시스템에서 온 값은 저장하지 않는다 — 에코 금지', () => {
    it('applyServerSettings 는 상태만 바꾼다', async () => {
        const { useSettingsStore } = await freshStore();
        useSettingsStore.getState().applyServerSettings({ timeScale: 'quarterly', zoomLevel: 1.5 });
        expect(useSettingsStore.getState()).toMatchObject({ timeScale: 'quarterly', zoomLevel: 1.5 });
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('빈 응답으로는 아무것도 덮지 않는다 (로드 실패가 설정을 초기화하면 안 된다)', async () => {
        const { useSettingsStore } = await freshStore({ cache: { zoomLevel: 3 } });
        useSettingsStore.getState().applyServerSettings(null);
        useSettingsStore.getState().applyServerSettings({});
        useSettingsStore.getState().applyServerSettings({ 낯선키: 1 });
        expect(useSettingsStore.getState().zoomLevel).toBe(3);
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('OS 테마 변경은 사용자가 정한 적 없을 때만 따르고 저장하지 않는다', async () => {
        const { useSettingsStore } = await freshStore();
        useSettingsStore.getState().followSystemDarkMode(true);
        expect(useSettingsStore.getState().darkMode).toBe(true);
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('사용자가 정해 둔 적이 있으면 OS 테마를 따르지 않는다', async () => {
        const { useSettingsStore } = await freshStore({ cache: { darkMode: false } });
        useSettingsStore.getState().followSystemDarkMode(true);
        expect(useSettingsStore.getState().darkMode).toBe(false);
    });
});

describe('getSettingsSnapshot — 컴포넌트 밖에서 쓰는 현재 값', () => {
    it('알려진 키만, 액션 없이 돌려준다', async () => {
        const { getSettingsSnapshot, SETTING_DEFAULTS } = await freshStore({ cache: { zoomLevel: 2 } });
        const snap = getSettingsSnapshot();
        expect(Object.keys(snap).sort()).toEqual(Object.keys(SETTING_DEFAULTS).sort());
        expect(snap.zoomLevel).toBe(2);
        expect(typeof snap.setSetting).toBe('undefined');
    });
});
