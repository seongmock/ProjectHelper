// 차트 테마 정의
// 새 테마 추가 시 이 배열에 항목만 추가하면 됩니다
//
// barShape: 'rect' | 'arrow'    — 바 모양 (직사각형 | 오른쪽 화살표)
// barFill:  'solid' | 'outline' — 바 채움 (단색 채움 | 테두리만)
// useTaskColor: boolean         — true = task.color 사용, false = 고정 색상
// showDuration: boolean         — 바 위에 기간(Xd) 표시 여부
// forceLight: boolean           — true = 다크모드 무관하게 항상 라이트 색상

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
];

export const getTheme = (id) => THEMES.find(t => t.id === id) ?? THEMES[0];
