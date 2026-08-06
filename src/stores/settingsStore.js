// 뷰 설정 스토어 (Zustand).
//
// 이전에는 App.jsx 가 설정 하나당 useState 를 하나씩 들고(11개), 그것들을 전부 의존성으로
// 갖는 useEffect 하나가 서버에 저장했다. 문제가 두 가지였다:
//   1) 서버 로드가 끝나기 전에 기본값이 저장 effect 를 트리거해 서버 설정을 덮어썼다
//      (isLoading 가드로 막고 있었지만, 가드를 잊으면 조용히 재발하는 구조였다)
//   2) 설정 하나를 추가할 때마다 useState·applyViewSettings·저장 effect·Toolbar props
//      네 곳을 동시에 고쳐야 했다
//
// 스토어로 옮기면서 "사용자 조작만 저장한다"를 구조로 강제한다:
//   - set/toggle  : 사용자 조작 → 상태 변경 + 서버 저장
//   - applyServer : 서버/가져오기에서 온 값 → 상태만 변경 (저장 안 함 → 에코 없음)
import { create } from 'zustand';
import { storage } from '../utils/storage';

const SETTINGS_CACHE_KEY = 'project-timeline-settings';

// 지속되는 설정과 기본값. 여기 키를 추가하면 저장·복원이 자동으로 따라온다.
export const SETTING_DEFAULTS = {
    timeScale: 'monthly',
    zoomLevel: 1.0,
    showToday: true,
    isCompact: false,
    showTaskNames: true,
    snapEnabled: true,
    showBarLabels: false,
    showBarDates: false,
    chartTheme: 'default',
    darkMode: null, // null = 미설정 → 시스템 설정을 따른다
};

const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

// 첫 페인트에 기본값이 번쩍이지 않도록 localStorage 캐시에서 동기 초기화한다.
// (서버 로드는 비동기라 늦게 도착한다)
const readCache = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const prefersDark = () => {
    try {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
        return false;
    }
};

// 알 수 없는 키가 서버 응답에 섞여도 스토어를 오염시키지 않는다
const pickKnown = (source) => {
    const out = {};
    if (!source) return out;
    for (const key of SETTING_KEYS) {
        if (source[key] !== undefined) out[key] = source[key];
    }
    return out;
};

const initialState = () => {
    const cached = pickKnown(readCache());
    const state = { ...SETTING_DEFAULTS, ...cached };
    if (state.darkMode === null || state.darkMode === undefined) state.darkMode = prefersDark();
    return state;
};

export const useSettingsStore = create((set, get) => ({
    ...initialState(),

    // 사용자 조작 — 상태를 바꾸고 서버/캐시에 저장한다
    setSetting: (patch) => {
        set(patch);
        storage.saveSettings(pickKnown(get()));
    },

    toggleSetting: (key) => get().setSetting({ [key]: !get()[key] }),

    // 서버 로드 / 가져오기 파일에서 온 값 — 저장하지 않는다.
    // 저장하면 방금 읽은 값을 그대로 되쓰는 에코가 되고, 프로젝트 전환/로드 중
    // 레이스에서 기본값이 서버 설정을 덮어쓸 수 있다.
    applyServerSettings: (settings) => {
        const known = pickKnown(settings);
        if (Object.keys(known).length > 0) set(known);
    },

    // 가져오기 파일의 뷰 설정 — 사용자의 명시적 선택이므로 적용하고 저장까지 한다
    importSettings: (settings) => {
        const known = pickKnown(settings);
        if (Object.keys(known).length === 0) return;
        set(known);
        storage.saveSettings(known);
    },

    // OS 테마가 바뀌었을 때 — 사용자가 다크모드를 명시적으로 정한 적이 없을 때만 따르고,
    // 저장하지 않는다 (저장하면 그 순간부터 "명시적 선택"이 되어 버린다).
    // 캐시를 읽는 이유: 서버 loadSettings 는 비동기라 이 시점에 늦을 수 있다.
    followSystemDarkMode: (matches) => {
        if (readCache()?.darkMode !== undefined) return;
        set({ darkMode: matches });
    },
}));

// 컴포넌트 밖(내보내기 등)에서 현재 설정 스냅샷이 필요할 때
export const getSettingsSnapshot = () => pickKnown(useSettingsStore.getState());
