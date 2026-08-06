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

export const getStatusColor = (status) => STATUS_STYLES.find(s => s.id === status)?.color;
