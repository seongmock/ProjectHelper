// 데이터 구조 정의 및 초기 샘플 데이터

export const createNewTask = (name = '새 작업', parentId = null) => {
    return {
        id: generateId(),
        name,
        startDate: formatDate(new Date()),
        endDate: formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30일 후
        color: '#4A90E2',
        description: '',
        children: [],
        expanded: true,
        labels: [],
        parentId,
        milestones: [], // 마일스톤 배열: { id, date, label, color, shape: 'diamond'|'circle'|'triangle'|'square' }
        dependencies: [], // 선행 작업 ID 배열
        divider: { enabled: false, thickness: 2, style: 'solid', color: '#000000' }
    };
};

export const generateId = () => {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const formatDate = (date) => {
    if (typeof date === 'string') return date;
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// 재귀적으로 작업을 평탄화하는 함수 (level 포함)
export const flattenTasks = (items, level = 0) => {
    const result = [];
    items.forEach(item => {
        result.push({ ...item, level });
        // expanded 상태일 때만 자식 포함 (DnD를 위해서는 전체가 필요할 수 있으나, 보통 보이는 것만 드래그함)
        // 하지만 전체 리스트 재정렬을 위해서는 expanded 여부와 상관없이 모든 노드를 알아야 할 수도 있음.
        // 현재 UI에서는 expanded 된 것만 보이니까 expanded 체크.
        if (item.children && item.children.length > 0 && item.expanded) {
            result.push(...flattenTasks(item.children, level + 1));
        }
    });
    return result;
};

// 샘플 데이터
export const getSampleData = () => {
    return [
        {
            id: 'task-1',
            name: '프로젝트 기획',
            startDate: '2026-01-06',
            endDate: '2026-02-15',
            color: '#4A90E2',
            description: '프로젝트 전체 기획 및 요구사항 분석',
            expanded: true,
            labels: ['기획'],
            milestones: [
                { id: 'm1', date: '2026-01-20', label: '초안 완료', color: '#5CB85C', shape: 'circle' }
            ],
            children: [
                {
                    id: 'task-1-1',
                    name: '요구사항 분석',
                    startDate: '2026-01-06',
                    endDate: '2026-01-20',
                    color: '#5CB85C',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
                {
                    id: 'task-1-2',
                    name: '설계 문서 작성',
                    startDate: '2026-01-21',
                    endDate: '2026-02-15',
                    color: '#5CB85C',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
            ],
        },
        {
            id: 'task-2',
            name: '개발',
            startDate: '2026-02-10',
            endDate: '2026-04-30',
            color: '#7B68EE',
            description: '핵심 기능 개발',
            expanded: true,
            labels: ['개발'],
            milestones: [
                { id: 'm2', date: '2026-03-15', label: 'Alpha 릴리즈', color: '#F0AD4E', shape: 'triangle' }
            ],
            children: [
                {
                    id: 'task-2-1',
                    name: '프론트엔드 개발',
                    startDate: '2026-02-10',
                    endDate: '2026-03-31',
                    color: '#9B59B6',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
                {
                    id: 'task-2-2',
                    name: '백엔드 개발',
                    startDate: '2026-03-01',
                    endDate: '2026-04-30',
                    color: '#9B59B6',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
            ],
        },
        {
            id: 'task-3',
            name: '테스트 및 배포',
            startDate: '2026-04-15',
            endDate: '2026-05-30',
            color: '#F0AD4E',
            description: 'QA 테스트 및 최종 배포',
            expanded: true,
            labels: ['QA', '배포'],
            milestones: [
                { id: 'm3', date: '2026-05-30', label: '정식 출시', color: '#D9534F', shape: 'square' }
            ],
            children: [
                {
                    id: 'task-3-1',
                    name: 'QA 테스트',
                    startDate: '2026-04-15',
                    endDate: '2026-05-15',
                    color: '#E67E22',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
                {
                    id: 'task-3-2',
                    name: '프로덕션 배포',
                    startDate: '2026-05-20',
                    endDate: '2026-05-30',
                    color: '#E67E22',
                    description: '',
                    expanded: true,
                    labels: [],
                    milestones: [],
                    children: [],
                },
            ],
        },
    ];
};
