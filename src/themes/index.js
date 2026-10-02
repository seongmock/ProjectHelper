// 차트 테마 정의
// 새 테마 추가 시 이 배열에 항목만 추가하면 됩니다
//
// barShape: 'rect' | 'arrow'    — 바 모양 (직사각형 | 오른쪽 화살표)
// barFill:  'solid' | 'outline' — 바 채움 (단색 채움 | 테두리만)
// useTaskColor: boolean         — true = task.color 사용, false = 고정 색상
// showDuration: boolean         — 바 위에 기간(Xd) 표시 여부
// forceLight: boolean           — true = 다크모드 무관하게 항상 라이트 색상
//
// 아래는 SOW 테마가 처음 쓰는 필드다. 없으면 기존 동작 그대로다(default·lg 무변화).
// barFill 'tint'   — 옅은 바탕(28%) + 진행률 구간만 진한 막대, 그룹(레벨 0)은 회색 띠
// rowHeight        — 컴팩트가 아닐 때의 행 높이(px). 없으면 40
// singleAxis       — 머리글을 'YYYY.MM' 한 줄로(연도 행 없음) + 본문에 월 격자
// milestoneDateLabels — 이 테마를 고를 때 '마일스톤 날짜 라벨' 표시 옵션의 기본값
// statusPalette    — 상태 색상 모드의 테마별 색 (id 는 STATUS_STYLES 와 같다)
// colorMap         — 저장된 색(소문자 hex) → 이 테마에서 그릴 색. 데이터는 바꾸지 않는다

export const THEMES = [
    {
        id: 'default',
        label: '기본',
        shortLabel: '기본',
        icon: '🎨',
        description: '컬러풀한 기본 스타일',
        barShape: 'rect',
        barFill: 'solid',
        useTaskColor: true,
        showDuration: false,
        forceLight: false,
    },
    {
        id: 'lg',
        label: 'LG전자 스타일',
        shortLabel: 'LG',
        icon: '🏢',
        description: 'LG전자 공식 간트 차트 스타일 (흰색 기반, 화살표 바)',
        barShape: 'arrow',
        barFill: 'outline',
        useTaskColor: false,
        showDuration: true,
        forceLight: true,
    },
    {
        // Fujin SOW Tracker(gantt.js)의 간트를 옮긴 것. 그 트래커가 이 앱의 프로젝트에
        // 마일스톤을 밀어 넣으므로, 두 화면이 같은 그림이어야 한다(THEME_SOW_TRACKER.md).
        id: 'sow',
        label: 'SOW Tracker 스타일',
        shortLabel: 'SOW',
        icon: '📋',
        description: 'Fujin SOW Tracker와 같은 간트 (옅은 막대 + 진행률, 다이아몬드 + 날짜, 회색 그룹 띠)',
        barShape: 'rect',
        barFill: 'tint',
        useTaskColor: true,
        showDuration: false,
        forceLight: true,
        rowHeight: 28,
        singleAxis: true,
        milestoneDateLabels: true,
        statusPalette: { done: '#3a9a5b', active: '#f0b429', upcoming: '#6b8fd6', overdue: '#d64545' },
        // 트래커(ph.py)가 마일스톤 상태를 저장하는 hex → 트래커 화면의 토큰 색
        colorMap: { '#4a90e2': '#6b8fd6', '#fab219': '#f0b429', '#0ca30c': '#3a9a5b', '#d03b3b': '#d64545', '#9b9b97': '#9a988f' },
    },
];

export const getTheme = (id) => THEMES.find(t => t.id === id) ?? THEMES[0];

// 상태 색상 모드 팔레트.
//
// 기본(작업 색상) 모드에서 색은 사용자가 고른 그룹 구분일 뿐이라 "이 색이 무슨 뜻인가"에
// 답할 방법이 없다(실사 §5.2 "범례 없음"). 상태 색상 모드는 색을 일정 상태에 고정하고
// 범례를 함께 띄워 해석 가능하게 만든다.
//
// id 는 taskTree.getTaskStatus() 의 반환값과 1:1 이고, 배열 순서가 범례 표시 순서다.
// 'none'(날짜 없음)은 칠할 대상이 없어 여기 없다 — 색 조회가 undefined 로 떨어지면
// 호출부가 작업 색으로 폴백한다.
export const STATUS_STYLES = [
    { id: 'done', label: '완료', color: '#2e9e6b' },
    { id: 'active', label: '진행중', color: '#3b82f6' },
    { id: 'upcoming', label: '예정', color: '#98a2b3' },
    { id: 'overdue', label: '지연', color: '#d9534f' },
];

// 테마에 statusPalette 가 있으면 그 색을, 없으면 기본 팔레트를 쓴다. 범례도 같은 목록을
// 그려야 하므로(색이 범례와 다르면 범례가 거짓말이 된다) 목록 단위로 낸다.
export const getStatusStyles = (themeId) => {
    const palette = getTheme(themeId).statusPalette;
    return palette ? STATUS_STYLES.map(s => ({ ...s, color: palette[s.id] ?? s.color })) : STATUS_STYLES;
};

export const getStatusColor = (status, themeId) => getStatusStyles(themeId).find(s => s.id === status)?.color;

// 작업 색 모드에서 저장된 색을 테마 색으로 바꾼다(대소문자 무시). 매핑에 없는 색은 그대로.
export const themeColor = (color, themeId) => {
    const map = getTheme(themeId).colorMap;
    return (map && typeof color === 'string' && map[color.toLowerCase()]) || color;
};
