// 명령 팔레트(Ctrl+K)의 순수 부분 — 목록을 만들고 질의로 거른다.
//
// 실사 §5.4-13: 기능은 툴바·표시 옵션 메뉴·헤더에 흩어져 있고, 어떤 것은 아이콘뿐이라
// 이름으로 찾을 방법이 없다. 여기서 만드는 목록은 **새 기능이 아니라 기존 핸들러의 색인**이다
// — 팔레트에만 있는 동작을 만들지 마라(찾을 수 있는 곳이 하나 더 늘 뿐이다).
//
// 그리기는 CommandPalette.jsx 가 한다. 점수·포함 여부 판정은 전부 여기 있고 단위테스트가 붙는다.

// 질의 하나를 텍스트에 맞춰 본다. 반환 { score, indices } | null.
//   - 부분 문자열이면 높은 점수 (앞에서 걸릴수록 높다)
//   - 아니면 순서만 맞는 부분수열(subsequence) — "다크모드" 로 "다크 모드" 를 찾는다
//   - indices 는 화면에서 일치 글자를 강조하는 데 쓴다
export const matchQuery = (text, query) => {
    const t = String(text || '').toLowerCase();
    const q = String(query || '').toLowerCase();
    if (!q) return { score: 0, indices: [] };
    if (!t) return null;

    const at = t.indexOf(q);
    if (at !== -1) {
        const indices = Array.from({ length: q.length }, (_, i) => at + i);
        return { score: 1000 - at + (at === 0 ? 100 : 0), indices };
    }

    const indices = [];
    let from = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, from);
        if (found === -1) return null;
        indices.push(found);
        from = found + 1;
    }
    // 흩어져 있을수록 낮다 — "ㅅㅈ" 같은 우연한 부분수열이 위로 올라오지 않게
    const span = indices[indices.length - 1] - indices[0] + 1;
    return { score: 500 - Math.min(span - q.length, 400), indices };
};

// 보조 텍스트(hint·keywords)에서만 걸린 항목은 라벨에서 걸린 항목보다 항상 아래에 온다.
const SECONDARY_WEIGHT = 0.4;

// items → [{ item, indices }] (점수 내림차순, 동점이면 원래 순서).
// 질의가 비면 원래 순서 그대로 돌려준다.
export const filterItems = (items, query, limit = Infinity) => {
    const q = String(query || '').trim();
    const list = items || [];
    if (!q) return list.slice(0, limit).map(item => ({ item, indices: [] }));

    const scored = [];
    list.forEach((item, order) => {
        const primary = matchQuery(item.label, q);
        // 라벨에서 걸렸으면 보조는 보지 않는다 — 강조 위치가 라벨 기준이어야 한다
        const secondary = primary
            ? null
            : matchQuery([item.keywords, item.hint].filter(Boolean).join(' '), q);
        if (!primary && !secondary) return;
        scored.push({
            item,
            indices: primary ? primary.indices : [],
            score: primary ? primary.score : secondary.score * SECONDARY_WEIGHT,
            order,
        });
    });

    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.slice(0, limit).map(({ item, indices }) => ({ item, indices }));
};

// 트리를 "이동" 항목으로 편다. 접힌 가지도 포함한다 — 팔레트로 이동할 때 조상을 펼치므로
// (expandAncestors) 숨어 있다는 이유로 찾지 못하면 팔레트를 쓸 이유가 없다.
// hint 는 부모 경로다. 같은 이름의 작업이 여러 개일 때 이것만이 구분 근거다.
export const buildTaskItems = (tasks) => {
    const out = [];
    const walk = (items, path) => {
        (items || []).forEach(task => {
            out.push({
                id: `task:${task.id}`,
                group: '이동',
                label: task.name || '(이름 없음)',
                hint: path.join(' / '),
                taskId: task.id,
            });
            if (task.children && task.children.length > 0) walk(task.children, [...path, task.name]);
        });
    };
    walk(tasks, []);
    return out;
};

// 실행 가능한 명령 목록. **지금 할 수 없는 명령은 넣지 않는다** — 비활성 항목을 회색으로
// 남기면 Enter 가 아무것도 하지 않는 경우가 생기고, 그 분기를 화면·키보드 양쪽이 알아야 한다.
// (표 뷰에는 타임라인 핸들이 없고, 되돌릴 것이 없으면 실행 취소도 없다)
export const buildCommands = ({
    viewMode,
    settings,
    canUndo,
    canRedo,
    projects = [],
    activeProjectId,
    handlers,
}) => {
    const h = handlers;
    const isTimeline = viewMode === 'timeline';
    const onOff = (flag) => (flag ? '켜짐' : '꺼짐');
    const cmds = [];

    // ── 작업 ─────────────────────────────────────────
    cmds.push({ id: 'task:add', group: '작업', label: '새 작업 추가', shortcut: 'Ctrl+N', run: h.addTask });
    if (canUndo) cmds.push({ id: 'task:undo', group: '작업', label: '실행 취소', shortcut: 'Ctrl+Z', run: h.undo });
    if (canRedo) cmds.push({ id: 'task:redo', group: '작업', label: '다시 실행', shortcut: 'Ctrl+Y', run: h.redo });

    // ── 보기 ─────────────────────────────────────────
    [
        ['table', '표 뷰', 'table'],
        ['timeline', '타임라인 뷰', 'timeline gantt'],
    ].forEach(([mode, label, keywords]) => {
        if (viewMode === mode) return;
        cmds.push({ id: `view:${mode}`, group: '보기', label, keywords, run: () => h.setViewMode(mode) });
    });

    cmds.push({
        id: 'view:inspector',
        group: '보기',
        label: '인스펙터 패널',
        state: onOff(settings.showInspector),
        keywords: 'inspector 상세 편집',
        run: () => h.toggleSetting('showInspector'),
    });
    cmds.push({
        id: 'view:dark',
        group: '보기',
        label: '다크 모드',
        state: onOff(settings.darkMode),
        keywords: 'dark theme 테마',
        run: () => h.toggleSetting('darkMode'),
    });

    if (isTimeline) {
        cmds.push({ id: 'view:zoom-in', group: '보기', label: '확대', keywords: 'zoom in', run: h.zoomIn });
        cmds.push({ id: 'view:zoom-out', group: '보기', label: '축소', keywords: 'zoom out', run: h.zoomOut });
        if (settings.timeScale !== 'monthly') {
            cmds.push({ id: 'view:monthly', group: '보기', label: '월별 보기', run: () => h.setSetting({ timeScale: 'monthly' }) });
        }
        if (settings.timeScale !== 'quarterly') {
            cmds.push({ id: 'view:quarterly', group: '보기', label: '분기별 보기', run: () => h.setSetting({ timeScale: 'quarterly' }) });
        }

        // ── 표시 (타임라인 전용 토글) ────────────────
        [
            ['showTaskNames', '작업명 표시'],
            ['showBarLabels', '바 라벨 표시'],
            ['showBarDates', '바 날짜 표시'],
            ['showToday', '오늘 표시'],
            ['isCompact', '컴팩트 보기'],
            ['snapEnabled', '드래그 스냅'],
        ].forEach(([key, label]) => {
            cmds.push({
                id: `display:${key}`,
                group: '표시',
                label,
                state: onOff(settings[key]),
                run: () => h.toggleSetting(key),
            });
        });

        const nextColorMode = settings.colorMode === 'status' ? 'task' : 'status';
        cmds.push({
            id: 'display:colorMode',
            group: '표시',
            label: nextColorMode === 'status' ? '바 색상: 상태 색상' : '바 색상: 작업 색상',
            keywords: 'color 범례 legend',
            run: () => h.setSetting({ colorMode: nextColorMode }),
        });

        cmds.push({ id: 'file:image', group: '파일', label: '이미지로 복사', keywords: 'png capture 캡처', run: h.copyImage });
    }

    // ── 파일 ─────────────────────────────────────────
    cmds.push({ id: 'file:export', group: '파일', label: '내보내기 (JSON)', shortcut: 'Ctrl+S', run: h.exportFile });
    cmds.push({ id: 'file:import', group: '파일', label: '가져오기', keywords: 'import json', run: h.importFile });
    cmds.push({ id: 'file:html', group: '파일', label: 'HTML 코드 복사', keywords: 'export 위키 embed', run: h.exportHtml });
    cmds.push({ id: 'file:snapshots', group: '파일', label: '스냅샷 저장/불러오기', keywords: 'snapshot 백업', run: h.openSnapshots });
    cmds.push({ id: 'file:guide', group: '파일', label: 'AI 프롬프트 가이드', keywords: 'ai prompt', run: h.openPromptGuide });

    // ── 프로젝트 ─────────────────────────────────────
    projects.forEach(project => {
        if (project.id === activeProjectId) return;
        cmds.push({
            id: `project:${project.id}`,
            group: '프로젝트',
            label: project.name,
            hint: '프로젝트 전환',
            run: () => h.switchProject(project.id),
        });
    });

    return cmds;
};
