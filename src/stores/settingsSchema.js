// 설정의 모양 — 기본값과 값 정규화. 순수 모듈이다(스토어·localStorage·네트워크를 모른다).
// 스토어(settingsStore)와 HTML 내보내기(htmlExporter)가 같은 규칙을 지나야 해서 따로 둔다 — 내보내기가
// 스토어를 끌어오면 모듈 로드만으로 localStorage 를 읽는 부작용까지 따라온다.
import { THEMES } from '../themes/index.js';
import { clampZoom } from '../features/timeline/zoomRange.js';

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
    showDependencies: true, // 타임라인·HTML 내보내기의 의존성 화살표
    showPhaseChain: true, // 접힌 가지의 하위 일정이 겹치지 않으면 단계 체인(쉐브론)으로 — 끄면 빗금 띠
    showMilestoneDates: false, // 마일스톤 라벨에 이름 대신 날짜(yy.mm.dd) — 테마를 고르면 그 테마의 기본값으로
    chartTheme: 'default',
    colorMode: 'task', // 'task' = 작업 색상 | 'status' = 일정 상태 색상 + 범례
    showInspector: false, // 오른쪽 인스펙터 패널 (선택된 작업 상세)
    railExpanded: false, // 좌측 프로젝트 레일 — 접힘(아이콘만)이 기본, 펴면 이름이 붙는다
    darkMode: null, // null = 미설정 → 시스템 설정을 따른다
};

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

// 값의 **타입**을 기본값에 맞춘다. 설정은 서버(병합만, 타입 검사 없음 — 설계)·에이전트·가져온 JSON 에서
// 오고, 그 값이 화면과 HTML 내보내기의 <script> 로 그대로 흘렀다. 그래서 문자열 "false" 가 '켜짐'으로
// 그려지는데 메뉴는 aria-checked="false" 라고 읽히고, chartTheme 에 따옴표를 넣으면 내보낸 문서에서
// 스크립트가 실행됐다(2026-10-13 레드팀 2차). 모르는 값은 기본값이다 — 에이전트가 짐작한 값에 화면이
// 깨지지 않아야 한다. 'sow' 는 미니멀 테마의 옛 id(2abc132 에서 이름을 바꿨다)다.
const ENUMS = {
    timeScale: ['monthly', 'quarterly'],
    colorMode: ['task', 'status'],
    chartTheme: THEMES.map(t => t.id),
};
const ALIASES = { chartTheme: { sow: 'minimal' } };

export const normalizeSetting = (key, value) => {
    const fallback = SETTING_DEFAULTS[key];
    const alias = ALIASES[key]?.[value];
    if (alias) return alias;
    if (ENUMS[key]) return ENUMS[key].includes(value) ? value : fallback;
    if (key === 'zoomLevel') {
        const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
        return Number.isFinite(n) ? clampZoom(n) : fallback;
    }
    // 불리언(darkMode 는 '아직 안 정함' null 도 허용) — 'true'/'false' 문자열까지는 받아 준다
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    return fallback;
};

// 알 수 없는 키를 버리고 값은 normalizeSetting 을 지난다 — 있는 키만 돌려준다(병합용)
export const pickKnown = (source) => {
    const out = {};
    if (!source) return out;
    for (const key of SETTING_KEYS) {
        if (source[key] !== undefined) out[key] = normalizeSetting(key, source[key]);
    }
    return out;
};

// 내보내기처럼 스토어 밖에서 설정을 받는 곳이 쓰는 형태 — 빠진 키는 기본값으로 채운다
export const normalizeSettings = (source) => ({ ...SETTING_DEFAULTS, ...pickKnown(source) });
