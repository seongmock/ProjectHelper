import { dateUtils } from '../../utils/dateUtils';
import { getTaskStatus, flattenAll, findDependencyIssues } from '../../utils/taskTree';
import { summarizeRowDependencies, describeRowDependencies } from '../table/dependencyBadges';
import { STATUS_STYLES, getStatusColor } from '../../themes/index.js';

// 라벨 배치는 **앱과 같은 코드**를 쓴다. 내보낸 HTML 은 정적 산출물이라, 배치 규칙을 여기에
// 다시 적으면 반드시 낡는다 — 실제로 낡아 있었다: 앱은 층(tier)을 늘려 겹침을 없애는데
// 내보내기는 top/bottom/right 세 칸만 시도하고 넷째부터 'top' 으로 되돌려 그냥 겹쳤다.
// 그래서 순수 모듈의 **소스를 그대로 심는다**. 컴포넌트는 심을 수 없지만(내보내기 결과는
// 자립형 <div> 하나여야 한다) 순수함수는 심을 수 있다.
import milestoneLabelsSource from '../timeline/milestoneLabels.js?raw';
import dependencyPathSource from '../timeline/dependencyPath.js?raw';
import dependencyStyleSource from '../timeline/dependencyStyle.js?raw';
import milestoneShapesSource from '../../shared/milestoneShapes.js?raw';

// ESM 소스를 <script> 안의 평범한 선언으로 바꾼다. export 키워드만 떼면 되고, 심는 값은
// 템플릿 리터럴의 **보간값**이라 백틱이나 치환 구문을 다시 이스케이프하면 오히려 깨진다.
const inlineModuleSource = (src) => src.replace(/^export /gm, '');

/**
 * Export project data to a single self-contained HTML file.
 * @param {Array} tasks - List of tasks
 * @param {Object} settings - View settings (darkMode, etc. - mostly for initial state)
 * @returns {string} - The complete HTML string
 */
// <script> 블록 안에 JSON을 안전하게 심는다.
// 작업명에 "</script>" 가 들어가면 스크립트 블록을 탈출해 임의 코드가 실행된다.
// < 형태의 이스케이프는 JSON 문법상 동일한 문자열이므로 데이터는 그대로 보존된다.
// U+2028/2029 는 JS 소스에서 줄바꿈으로 해석되어 구문 오류를 만든다.
const toSafeJson = (value) =>
    JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

// \uc791\uc5c5 id \u2192 \uc0c1\ud0dc \uc0c9\uc0c1. \uc0c1\ud0dc \uc0c9\uc0c1 \ubaa8\ub4dc\ub85c \ub0b4\ubcf4\ub0bc \ub54c\ub9cc \uc4f4\ub2e4.
//
// \ub0b4\ubcf4\ub0b8 HTML \uc740 \uc815\uc801 \uc0b0\ucd9c\ubb3c\uc774\ubbc0\ub85c \uc0c1\ud0dc\ub97c **\ub0b4\ubcf4\ub0b8 \uc2dc\uc810** \uae30\uc900\uc73c\ub85c \uad73\ud78c\ub2e4. \ud310\uc815 \uaddc\uce59
// (getTaskStatus)\uc744 \ub0b4\ubcf4\ub0b8 \ubb38\uc11c \uc548\uc5d0 \ub2e4\uc2dc \uad6c\ud604\ud558\uc9c0 \uc54a\uc73c\ub824\ub294 \uac83\uc774\uae30\ub3c4 \ud558\ub2e4 \u2014 \ub80c\ub354 \ub85c\uc9c1\uc774
// \uc774\ubbf8 2\uc911\ud654\ub3fc \uc788\ub294 \ud30c\uc77c\uc5d0 \ud310\uc815 \ub85c\uc9c1\uae4c\uc9c0 2\uc911\ud654\ud558\uba74 \uc5b4\uae0b\ub0a8\uc774 \ud558\ub098 \ub354 \ub298\uc5b4\ub09c\ub2e4.
const buildStatusColorMap = (tasks) => {
    const today = dateUtils.formatDate(new Date());
    const map = {};
    const walk = (list) => (list || []).forEach(task => {
        const color = getStatusColor(getTaskStatus(task, today));
        if (color) map[task.id] = color;
        walk(task.children);
    });
    walk(tasks);
    return map;
};

// \ubc94\ub840 \uc2a4\ud0c0\uc77c. \uc0c1\ud0dc \uc0c9\uc0c1 \ubaa8\ub4dc\uac00 \uc544\ub2c8\uba74 \uc544\uc608 \ub123\uc9c0 \uc54a\ub294\ub2e4 \u2014 \uc790\ub9bd\ud615 \uc0b0\ucd9c\ubb3c\uc5d0 \uc4f0\uc774\uc9c0 \uc54a\ub294
// \uaddc\uce59\uc744 \ub0a8\uae30\uc9c0 \uc54a\uae30 \uc704\ud574\uc11c\ub2e4. \uc140\ub809\ud130\ub294 \ucee8\ud14c\uc774\ub108 id \ub85c \uc2a4\ucf54\ud504\ud55c\ub2e4(\ubb38\uc11c \uc804\uc5ed \uc624\uc5fc \ubc29\uc9c0).
const legendCss = (listId) => `
        #ph-gantt-${listId} .ph-legend {
            display: flex;
            align-items: center;
            gap: 14px;
            flex: 0 0 auto;
            padding: 6px 12px;
            border-top: 1px solid var(--color-border);
            background-color: var(--color-bg-secondary);
            font-size: 12px;
            color: var(--color-text-secondary);
            overflow-x: auto;
            white-space: nowrap;
        }
        #ph-gantt-${listId} .ph-legend-title {
            font-weight: 600;
            color: var(--color-text-primary);
        }
        #ph-gantt-${listId} .ph-legend-item {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        #ph-gantt-${listId} .ph-legend-swatch {
            width: 14px;
            height: 10px;
            border-radius: 2px;
        }
        /* \uc0c9 \ub2e8\ub3c5 \uc778\ucf54\ub529\uc744 \ud53c\ud558\uae30 \uc704\ud55c \uc0c1\ud0dc\ubcc4 \ud328\ud134 \u2014 \uc571 \ubc94\ub840\uc640 \ub3d9\uc77c */
        #ph-gantt-${listId} .ph-legend-active {
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.65);
        }
        #ph-gantt-${listId} .ph-legend-upcoming { opacity: 0.55; }
        #ph-gantt-${listId} .ph-legend-overdue {
            background-image: repeating-linear-gradient(45deg,
                rgba(255,255,255,0.55) 0 2px, transparent 2px 4px);
        }`;

// \ubc94\ub840 \ub9c8\ud06c\uc5c5 \u2014 \uc571\uc758 TimelineLegend \uc640 \uac19\uc740 \uc21c\uc11c\u00b7\ub77c\ubca8\u00b7\uc0c9\uc744 \uc4f4\ub2e4(STATUS_STYLES \uac00 \ub2e8\uc77c \ucd9c\ucc98).
const legendHtml = () => `
    <div class="ph-legend" role="list" aria-label="\uc0c1\ud0dc \uc0c9\uc0c1 \ubc94\ub840">
        <span class="ph-legend-title">\uc0c1\ud0dc</span>
        ${STATUS_STYLES.map(s => `<span class="ph-legend-item" role="listitem">`
        + `<span class="ph-legend-swatch ph-legend-${s.id}" style="background-color:${s.color}"></span>`
        + `${s.label}</span>`).join('')}
    </div>`;

export const exportToHtml = (tasks, settings = {}) => {
    const tasksJson = toSafeJson(tasks);
    const darkMode = settings.darkMode ? 'dark' : 'light';
    // \uc0c1\ud0dc \uc0c9\uc0c1 \ubaa8\ub4dc\uac00 \uc544\ub2c8\uba74 \ube48 \ub9f5 \u2192 \uc544\ub798 \ud3f4\ubc31\uc774 \uae30\uc874 \ub3d9\uc791(\uc791\uc5c5 \uc0c9\uc0c1)\uc744 \uadf8\ub300\ub85c \uc720\uc9c0\ud55c\ub2e4
    const statusMode = settings.colorMode === 'status';
    const statusColorJson = toSafeJson(statusMode ? buildStatusColorMap(tasks) : {});

    // 의존성 판정은 **내보내는 시점에** 한 번 하고 결과를 심는다. 판정 로직(findDependencyIssues)
    // 자체를 심으려면 그것이 의존하는 트리 유틸까지 따라와야 하고, 내보낸 문서는 어차피
    // 그 시점의 스냅샷이라 다시 계산할 이유가 없다. 반대로 **표현**(색·선 모양)은 소스를
    // 심어 공유한다 — 그래야 앱에서 색을 바꿔도 내보내기가 따라온다.
    const dependencyIssues = findDependencyIssues(tasks);
    const edgeIssuesJson = toSafeJson(dependencyIssues.edgeIssues);
    // 내보낸 차트는 트리를 전부 펼쳐 그리므로 모든 작업에 자기 행이 있다(= 끌어올림 없음).
    const badges = summarizeRowDependencies(
        tasks,
        new Set(flattenAll(tasks).map(t => t.id)),
        dependencyIssues,
    );
    const badgeJson = toSafeJson(Object.fromEntries([...badges].map(([id, entry]) => [id, {
        pre: entry.predecessors.length,
        suc: entry.successors.length,
        broken: entry.broken,
        issue: entry.issue,
        // 앱과 같은 문구를 쓰되 "클릭하면 인스펙터에서 본다"는 뺀다 — 정적 문서에는 인스펙터가 없다.
        title: describeRowDependencies(entry, { actionHint: null }),
    }])));

    // Generate unique ID for scope isolation
    const listId = 'chk_' + Math.random().toString(36).substr(2, 9);
    const zoomLevel = settings.zoomLevel || 1.0;
    const isCompact = settings.isCompact || false;

    return `<!-- ProjectHelper Gantt Export -->
<div id="ph-gantt-${listId}" class="ph-gantt-container ${isCompact ? 'compact-mode' : ''}" style="display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background-color: var(--color-bg-primary); color: var(--color-text-primary); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <style>
        #ph-gantt-${listId} {
            --color-bg-primary: ${darkMode === 'dark' ? '#1e1e1e' : '#ffffff'};
            --color-bg-secondary: ${darkMode === 'dark' ? '#252526' : '#f8f9fa'};
            --color-text-primary: ${darkMode === 'dark' ? '#e0e0e0' : '#2c3e50'};
            --color-text-secondary: ${darkMode === 'dark' ? '#a0a0a0' : '#6c757d'};
            --color-border: ${darkMode === 'dark' ? '#3e3e42' : '#e9ecef'};
            --color-grid: ${darkMode === 'dark' ? '#2d2d30' : '#f1f3f5'};
            --color-primary: #4a90e2;
            --color-danger: #e74c3c;
            --color-link: ${darkMode === 'dark' ? '#ffa726' : '#f59f00'};
            
            /* Standard Mode Dimensions */
            --row-height: 40px;
            --header-height: 70px;
            --bar-height: 32px;
            
            /* Dynamic variables set by JS: --total-days */
        }
        
        /* Compact Mode Override */
        #ph-gantt-${listId}.compact-mode {
            --row-height: 28px;
            --header-height: 50px;
            --bar-height: 20px;
        }
        #ph-gantt-${listId}.compact-mode .milestone-shape {
            width: 12px;
            height: 12px;
        }

        #ph-gantt-${listId} * { box-sizing: border-box; }

        /* Layout */
        #ph-gantt-${listId} .gantt-body {
            display: flex;
            flex: 1;
            overflow: hidden;
            position: relative;
            border: 1px solid var(--color-border);
        }

        /* Task List Column */
        #ph-gantt-${listId} .task-list-column {
            width: 240px;
            border-right: 1px solid var(--color-border);
            background-color: var(--color-bg-primary);
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        #ph-gantt-${listId} .header-cell {
            height: var(--header-height);
            background-color: var(--color-bg-secondary);
            border-bottom: 1px solid var(--color-border);
            display: flex;
            align-items: center;
            padding: 0 16px;
            font-weight: 600;
            font-size: 13px;
        }

        #ph-gantt-${listId} .task-list-content {
            flex: 1;
            overflow: hidden; /* Synced scroll */
            background-color: var(--color-bg-primary);
        }

        #ph-gantt-${listId} .task-item {
            height: var(--row-height);
            border-bottom: 1px solid var(--color-grid);
            display: flex;
            align-items: center;
            padding: 0 16px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 13px;
            color: var(--color-text-primary);
        }
        #ph-gantt-${listId} .ph-task-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* 배지는 줄이지 않는다 — 이름이 길다고 '선행 2' 가 잘리면 없는 것과 같다. */
        #ph-gantt-${listId} .ph-dep-badge {
            flex: 0 0 auto;
            margin-left: 6px;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            color: var(--color-text-secondary);
            border: 1px solid var(--color-border);
            border-radius: 3px;
            padding: 0 4px;
            line-height: 16px;
        }
        #ph-gantt-${listId} .ph-dep-cycle { color: #dc2626; border-color: #dc2626; }
        #ph-gantt-${listId} .ph-dep-overlap { color: #f59e0b; border-color: #f59e0b; }
        #ph-gantt-${listId} .ph-dep-broken { color: #6b7280; border-color: #6b7280; }
        #ph-gantt-${listId} .task-item.level-0 { font-weight: 600; }
        #ph-gantt-${listId} .task-item.level-1 { padding-left: 32px; font-size: 12px; }
        #ph-gantt-${listId} .task-item.level-2 { padding-left: 48px; font-size: 12px; color: var(--color-text-secondary); }
        #ph-gantt-${listId} .task-item.level-3 { padding-left: 64px; font-size: 12px; color: var(--color-text-secondary); }

        /* Timeline Column */
        #ph-gantt-${listId} .timeline-column {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            background-color: var(--color-bg-primary);
        }

        #ph-gantt-${listId} .timeline-header-scroll {
            overflow: hidden;
            flex-shrink: 0;
            background-color: var(--color-bg-secondary);
        }

        #ph-gantt-${listId} .timeline-header {
            height: var(--header-height);
            background-color: var(--color-bg-secondary);
            border-bottom: 1px solid var(--color-border);
            position: relative;
        }

        #ph-gantt-${listId} .header-months {
            height: 24px;
            position: relative;
            border-bottom: 1px solid var(--color-border);
        }
        
        #ph-gantt-${listId} .header-days {
            height: 26px;
            position: relative;
        }

        #ph-gantt-${listId} .month-label {
            position: absolute;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-left: 1px solid var(--color-border);
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center; /* Center alignment matching App */
            color: var(--color-text-primary);
        }

        #ph-gantt-${listId} .day-label {
            position: absolute;
            font-size: 11px;
            font-weight: 600;
            text-align: center;
            border-left: 1px solid var(--color-grid);
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--color-text-secondary); /* Use secondary color */
            overflow: hidden;
        }

        #ph-gantt-${listId} .timeline-scroll-area {
            flex: 1;
            overflow: auto;
            position: relative;
            background-color: var(--color-bg-primary);
        }

        #ph-gantt-${listId} .timeline-content {
            position: relative;
            /* Removed daily grid background to match app style */
        }

        #ph-gantt-${listId} .task-row {
            height: var(--row-height);
            border-bottom: 1px solid var(--color-grid);
            position: relative;
            z-index: 1;
        }

        #ph-gantt-${listId} .timeline-bar {
            position: absolute;
            /* top/transform은 JS inline style로 지정 */
            height: 24px; /* level-0 default; overridden by inline style per level/range */
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            font-size: 11px;
            font-weight: 600;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: white;
            display: flex;
            align-items: center;
            padding: 0 8px;
            overflow: hidden;
            white-space: nowrap;
            cursor: default;
            z-index: 2;
            transform: translateY(-50%);
        }
        #ph-gantt-${listId} .timeline-bar:hover {
            opacity: 0.9;
            z-index: 10;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }
        #ph-gantt-${listId} .bar-label {
            text-overflow: ellipsis;
            overflow: hidden;
        }

        /* 기간 레이블 (초록 레이블) - 배경 없이 녹색 텍스트만 */
        #ph-gantt-${listId} .duration-label {
            position: absolute;
            color: #2d8c00;
            font-size: 11px;
            font-weight: 700;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            white-space: nowrap;
            pointer-events: none;
            z-index: 9999;
            line-height: 1;
        }

        /* LG 테마 화살표 바 */
        #ph-gantt-${listId} .timeline-bar.lg-bar {
            background-color: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
            overflow: hidden;
            padding: 0;
            position: absolute;
        }

        /* Divider */
        #ph-gantt-${listId} .task-divider {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 0;
            pointer-events: none;
        }

        /* Global Reset for this component */
        #ph-gantt-${listId} * {
            box-sizing: border-box;
        }

        /* Milestones */
        #ph-gantt-${listId} .milestone-marker {
            position: absolute;
            transform: translate(-50%, -50%); /* Centers on coordinate */
            z-index: 20;
            display: flex;
            flex-direction: column;
            align-items: center;
            pointer-events: none;
        }
        #ph-gantt-${listId} .milestone-shape {
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            width: 20px;
            height: 20px;
            flex-shrink: 0;
            line-height: 0; 
        }
        #ph-gantt-${listId} .milestone-shape .shape-icon {
             transition: transform 0.2s ease;
             /* Standardize size to 16px total */
             width: 16px;
             height: 16px;
             /* Border Box ensures 16px includes the border */
             box-sizing: border-box; 
             margin: 0; padding: 0;
             flex-shrink: 0;
        }
        #ph-gantt-${listId} .milestone-shape .shape-div {
             border: 2px solid white;
             box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        /* Specific Shape Transforms */
        #ph-gantt-${listId} .milestone-shape.diamond .shape-div {
             transform: rotate(45deg);
        }
        /* SVGs don't need border/shadow (handled internally or via filter) */
        #ph-gantt-${listId} .milestone-shape svg.shape-icon {
             display: block;
             /* Ensure SVGs match the 16px target size */
             width: 20px; /* App uses 20px viewbox but maybe visual size is smaller? Let's stick to 20px for SVGs if App does. */
             height: 20px;
             /* Actually, if Div is 16px, SVG 20px is inconsistent. But App does fit them. 
                Let's use 20px for container and allow SVG to fill it? 
                The Div is 16px. 
                Let's force SVG to 20px to match App source viewbox. 
             */
             width: 20px;
             height: 20px;
             box-sizing: content-box; /* SVGs are different */
        }
        
        #ph-gantt-${listId} .milestone-marker:hover .milestone-shape .shape-icon {
             /* We need to preserve rotation for diamond! */
             /* Scale only? No, must accommodate existing transform */
        }
        #ph-gantt-${listId} .milestone-marker:hover .milestone-shape.diamond .shape-icon {
             transform: rotate(45deg) scale(1.15);
        }
        #ph-gantt-${listId} .milestone-marker:hover .milestone-shape:not(.diamond) .shape-icon {
             transform: scale(1.15);
        }

        /* Compact Mode Milestone Scaling */
        #ph-gantt-${listId}.compact-mode .milestone-marker {
             transform: translate(-50%, -50%) scale(0.8);
        }

        /* Exact match for Milestone Label from TimelineBar.css */
        #ph-gantt-${listId} .milestone-label {
            position: absolute;
            white-space: nowrap;
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px; /* Fallback for var(--font-size-xs) */
            font-weight: 600;
            pointer-events: auto;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            z-index: 21;
        }
        #ph-gantt-${listId} .milestone-marker:hover .milestone-label {
             background-color: rgba(0, 0, 0, 0.95);
             transform: translateX(-50%) scale(1.05); /* Note: transform override logic in JS might conflict, check later */
             z-index: 22;
        }

        /* Scrollbars */
        #ph-gantt-${listId} ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        #ph-gantt-${listId} ::-webkit-scrollbar-track {
            background: var(--color-bg-secondary);
        }
        #ph-gantt-${listId} ::-webkit-scrollbar-thumb {
            background: #bdc3c7;
            border-radius: 5px;
        }
        #ph-gantt-${listId} ::-webkit-scrollbar-thumb:hover {
            background: #95a5a6;
        }



        /* Today Marker (Vertical Line) */
        #ph-gantt-${listId} .today-marker {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 2px;
            background-color: #ff5f57;
            opacity: 0.5;
            z-index: 20;
            pointer-events: none;
            display: none; /* Controlled by JS */
        }
        
        /* Today Label (In Header) */
        #ph-gantt-${listId} .today-header-marker {
            position: absolute;
            top: 0;
            width: 0; 
            height: 100%;
            z-index: 30;
            display: none; /* Controlled by JS */
        }

        #ph-gantt-${listId} .today-label {
            position: absolute;
            bottom: 2px; /* Position at the bottom (Month/Quarter row) */
            left: 50%;
            transform: translateX(-50%);
            background-color: #ff5f57;
            color: white;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            white-space: nowrap;
            line-height: 1.2;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }

        /* SVG Graph */
        #ph-gantt-${listId} .dependency-svg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }
        /* 색·굵기·점선·화살촉은 **인라인 스타일**이 정한다(dependencyStyle.js 를 심어서 쓴다).
           여기에 기본값을 남겨 두면 순환처럼 '실선이어야 하는' 간선까지 점선으로 그려진다. */
        #ph-gantt-${listId} .dependency-svg path {
            fill: none;
            opacity: 1.0;
        }

${statusMode ? legendCss(listId) : ''}
    </style>

    <div class="gantt-body">
        <div class="task-list-column">
            <div class="header-cell">작업명</div>
            <div class="task-list-content qs-tasks-${listId}" style="padding-top: 52px;">
                <!-- Tasks injected here -->
            </div>
        </div>

        <div class="timeline-column">
            <div class="timeline-header-scroll qs-header-${listId}">
                <div class="timeline-header">
                    <div class="header-months qs-months-${listId}"></div>
                    <div class="header-days qs-days-${listId}"></div>
                    <!-- Today Label In Header -->
                    <div class="today-header-marker qs-today-header-${listId}">
                        <div class="today-label">Today</div>
                    </div>
                </div>
            </div>
            <div class="timeline-scroll-area qs-scroll-${listId}">
                <div class="timeline-content qs-content-${listId}">
                    <svg class="dependency-svg qs-svg-${listId}"></svg>
                    <div class="today-marker qs-today-${listId}">
                        <!-- Label moved to header -->
                    </div>
                </div>
            </div>
        </div>
    </div>
${statusMode ? legendHtml() : ''}
    <script>
    (function() {
        // Scoped Execution
        const root = document.getElementById('ph-gantt-${listId}');
        if (!root) return;

        const RAW_DATA = ${tasksJson};

        // 사용자 입력(작업명·라벨)은 innerHTML 로 들어가므로 반드시 이스케이프한다.
        // 이 파일이 만드는 HTML은 Confluence 등 사내 위키에 임베드되는 것이 주 용도라,
        // 미이스케이프 시 self-XSS 가 아니라 열어보는 모든 사람에게 실행되는 저장형 XSS 가 된다.
        function esc(v) {
            return String(v == null ? '' : v)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // ---8<--- milestoneLabels.js (앱과 같은 소스, export 만 제거) ---8<---
${inlineModuleSource(milestoneLabelsSource)}
        // ---8<--- /milestoneLabels.js ---8<---

        // ---8<--- dependencyPath.js (앱과 같은 소스, export 만 제거) ---8<---
${inlineModuleSource(dependencyPathSource)}
        // ---8<--- /dependencyPath.js ---8<---

        // ---8<--- dependencyStyle.js (앱과 같은 소스, export 만 제거) ---8<---
${inlineModuleSource(dependencyStyleSource)}
        // ---8<--- /dependencyStyle.js ---8<---

        // ---8<--- milestoneShapes.js (앱과 같은 소스, export 만 제거) ---8<---
${inlineModuleSource(milestoneShapesSource)}
        // ---8<--- /milestoneShapes.js ---8<---

        // 배치 결과(React 스타일 객체)를 인라인 CSS 로 바꾼다. undefined 는 "지정 안 함"이므로
        // 건너뛴다 — 'max-width: undefined' 는 선언 하나를 통째로 무효로 만든다.
        function styleToCss(style) {
            return Object.keys(style || {})
                .filter(function(key) { return style[key] !== undefined && style[key] !== null; })
                .map(function(key) {
                    var prop = key.replace(/[A-Z]/g, function(c) { return '-' + c.toLowerCase(); });
                    return prop + ': ' + style[key] + ';';
                })
                .join(' ');
        }

        const ZOOM_LEVEL = ${zoomLevel};
        const TIME_SCALE = '${settings.timeScale || 'monthly'}';
        const CHART_THEME = '${settings.chartTheme || 'default'}';
        // 작업 id → 상태 색상. 작업 색상 모드로 내보내면 빈 객체다.
        const STATUS_COLOR = ${statusColorJson};
        // 간선 키('선행id>후행id') → 'cycle' | 'overlap'. 내보낼 때 앱이 판정한 것이다.
        const EDGE_ISSUES = ${edgeIssuesJson};
        // 작업 id → 선행/후행 개수와 문제. 작업명 열의 배지가 쓴다.
        const DEP_BADGES = ${badgeJson};

        // Flatten Data
        const FLATTENED_TASKS = [];
        function flatten(items, level = 0) {
            items.forEach(item => {
                FLATTENED_TASKS.push({ ...item, level });
                if (item.children && item.children.length > 0) {
                    flatten(item.children, level + 1);
                }
            });
        }
        flatten(RAW_DATA);
        const DATA = FLATTENED_TASKS;

        // Set Dynamic Dimensions
        // Removed IS_COMPACT logic and dynamic dimension calculations

        // Elements
        const elTaskList = root.querySelector('.qs-tasks-${listId}');
        const elHeaderMonths = root.querySelector('.qs-months-${listId}');
        const elHeaderDays = root.querySelector('.qs-days-${listId}');
        const elTimelineContent = root.querySelector('.qs-content-${listId}');
        const elTimelineScroll = root.querySelector('.qs-scroll-${listId}');
        const elHeaderScroll = root.querySelector('.qs-header-${listId}');

        const elTodayMarker = root.querySelector('.qs-today-${listId}');
        const elTodayHeader = root.querySelector('.qs-today-header-${listId}');
        const elSvg = root.querySelector('.qs-svg-${listId}');

        // Helpers
        const ONE_DAY = 24 * 60 * 60 * 1000;
        function parseDate(str) { return new Date(str); }
        function formatDate(date, format) { 
             const y = date.getFullYear();
             const m = String(date.getMonth()+1).padStart(2,'0');
             const d = String(date.getDate()).padStart(2,'0');
             return \`\${y}-\${m}-\${d}\`; 
        }
        function getDaysBetween(d1, d2) {
            const start = new Date(d1); start.setHours(0,0,0,0);
            const end = new Date(d2); end.setHours(0,0,0,0);
            return Math.round((end - start) / ONE_DAY);
        }
        function addDays(d, days) {
            const res = new Date(d);
            res.setDate(res.getDate() + days);
            return res;
        }
        function getQuarter(d) {
            return Math.floor(d.getMonth() / 3) + 1;
        }
        function getPosPercent(date, start, total) {
             const offset = getDaysBetween(start, date);
             return (offset / total) * 100;
        }
        function getWidthPercent(days, total) {
             return (days / total) * 100;
        }

        // Date Bounds
        let minDate = new Date();
        let maxDate = new Date();
        let hasData = false;
        
        const allDates = [];
        DATA.forEach(t => {
            if (t.timeRanges && t.timeRanges.length > 0) t.timeRanges.forEach(r => { allDates.push(parseDate(r.startDate)); allDates.push(parseDate(r.endDate)); });
            else if (t.startDate) { allDates.push(parseDate(t.startDate)); allDates.push(parseDate(t.endDate)); }
            if (t.milestones) t.milestones.forEach(m => allDates.push(parseDate(m.date)));
        });
        if (allDates.length > 0) {
             minDate = new Date(Math.min(...allDates));
             maxDate = new Date(Math.max(...allDates));
             hasData = true;
        }

        minDate = addDays(minDate, -14);
        maxDate = addDays(maxDate, 21);
        const startDate = minDate;
        const totalDays = getDaysBetween(startDate, maxDate) + 1;
        
        // Set CSS Variable for Grid
        root.style.setProperty('--total-days', totalDays);
        
        // Width Logic (Responsive)
        // Zoom Level dictates Total Width relative to Container
        // 1.0 = 100% of container. 2.0 = 200%.
        // This ensures "Look and Feel" matches.
        const contentWidthStr = (ZOOM_LEVEL * 100) + '%';
        elHeaderMonths.style.width = contentWidthStr;
        elHeaderDays.style.width = contentWidthStr;
        elTimelineContent.style.width = contentWidthStr;
        elSvg.style.width = '100%'; 

        // Render Functions
        // 배지 마크업. 앱의 표(TaskRow)와 같은 것을 말한다: 선행 n / 후행 n 과 가장 나쁜 문제
        // 하나. 연결이 없는 행에는 아무것도 붙이지 않는다 — 정적 문서에서 '—' 는 잡음이다.
        function badgeHtml(taskId) {
            const b = DEP_BADGES[taskId];
            if (!b) return '';
            const marks = [];
            if (b.pre > 0) marks.push('&#8592;' + b.pre);
            if (b.suc > 0) marks.push('&#8594;' + b.suc);
            if (b.issue) marks.push(ISSUE_MARK[b.issue] || '');
            if (marks.length === 0) return '';
            const cls = 'ph-dep-badge' + (b.issue ? ' ph-dep-' + b.issue : '');
            return '<span class="' + cls + '" title="' + esc(b.title) + '">' + marks.join(' ') + '</span>';
        }
        // 색만으로 구분하지 않는다 — 글리프가 문제의 종류를 함께 말한다.
        const ISSUE_MARK = { cycle: '&#8635;', overlap: '&#9888;', broken: '&#10006;' };

        function renderTaskList() {
            elTaskList.innerHTML = DATA.map(task => {
                return \`<div class="task-item level-\${task.level}" title="\${esc(task.name)}"><span class="ph-task-name">\${esc(task.name)}</span>\${badgeHtml(task.id)}</div>\`;
            }).join('');
        }

        function renderHeader() {
            let topRowHtml = '';
            let bottomRowHtml = '';
            let current = new Date(startDate);
            
            // Helper to get end of month/year
            const getNextDate = (d, type) => {
                 let next = new Date(d);
                 if (type === 'year') {
                     next.setFullYear(next.getFullYear() + 1, 0, 1);
                 } else if (type === 'month') {
                     next.setDate(1); // Force 1st to avoid overflow issues
                     next.setMonth(next.getMonth() + 1);
                 } else if (type === 'quarter') {
                      next.setDate(1);
                      next.setMonth(next.getMonth() + 3 - (next.getMonth() % 3));
                 }
                 return next;
            };

            for (let i = 0; i < totalDays; i++) {
                const year = current.getFullYear();
                const month = current.getMonth() + 1;
                const matchesDate = current.getDate();
                const quarter = getQuarter(current);
                
                const posPerc = getWidthPercent(i, totalDays);
                
                // Monthly View
                if (TIME_SCALE === 'monthly') {
                   const prevDate = addDays(current, -1);
                   const prevYear = prevDate.getFullYear();
                   const prevMonth = prevDate.getMonth() + 1;
                   
                   // Top Row: Year (Only when year changes, or first day)
                   if (i === 0 || year !== prevYear) {
                        let endOfYear = getNextDate(current, 'year');
                        let daysInUnit = getDaysBetween(current, endOfYear);
                        // If end of year is beyond maxDate, clamp it? 
                        // Actually maxDate is our render limit. getDaysBetween calculates purely on date diff.
                        // We should probably clamp to totalDays - i if we want it to fit inside the scroll area perfectly, 
                        // but posPerc is based on index i.
                        // Let's use getWidthPercent for width.
                        
                        let widthPerc = getWidthPercent(daysInUnit, totalDays);
                        
                        topRowHtml += '<div class="month-label" style="left: ' + posPerc + '%; width: ' + widthPerc + '%; border-left: 1px solid var(--color-border); justify-content: center; font-weight: bold;">' + year + '</div>';
                   }
                   
                   // Bottom Row: Month
                   if (i === 0 || month !== prevMonth || (month === prevMonth && year !== prevYear)) {
                        let endOfMonth = getNextDate(current, 'month');
                        let daysInUnit = getDaysBetween(current, endOfMonth);
                        let widthPerc = getWidthPercent(daysInUnit, totalDays);

                        bottomRowHtml += '<div class="day-label" style="left: ' + posPerc + '%; width: ' + widthPerc + '%; justify-content: center; border-left: 1px solid var(--color-grid); font-size: 12px;">' + month + '월</div>';
                   }
                } 
                // Quarterly View
                else {
                    const prevDate = addDays(current, -1);
                    const prevQuarter = getQuarter(prevDate);
                    const prevYear = prevDate.getFullYear();
                    
                    // Top Row: Year
                    if (i === 0 || year !== prevYear) {
                        let endOfYear = getNextDate(current, 'year');
                        let daysInUnit = getDaysBetween(current, endOfYear);
                        let widthPerc = getWidthPercent(daysInUnit, totalDays);

                         topRowHtml += '<div class="month-label" style="left: ' + posPerc + '%; width: ' + widthPerc + '%; border-left: 1px solid var(--color-border); justify-content: center; font-weight: bold;">' + year + '</div>';
                    }
                    
                    // Bottom Row: Quarter
                    if (i === 0 || quarter !== prevQuarter || (quarter === prevQuarter && year !== prevYear)) {
                         let endOfQuarter = getNextDate(current, 'quarter');
                         let daysInUnit = getDaysBetween(current, endOfQuarter);
                         let widthPerc = getWidthPercent(daysInUnit, totalDays);

                         bottomRowHtml += '<div class="day-label" style="left: ' + posPerc + '%; width: ' + widthPerc + '%; justify-content: center; border-left: 1px solid var(--color-grid); font-size: 12px;">Q' + quarter + '</div>';
                    }
                }
                current.setDate(current.getDate() + 1);
            }
            elHeaderMonths.innerHTML = topRowHtml;
            elHeaderDays.innerHTML = bottomRowHtml;
        }

        function renderTimeline() {
            let html = '';
            const coordMap = new Map();
            const labelWidthPx = 80; // Estimated label width for collision detection
            const contentWidth = elTimelineContent.offsetWidth || 1200; // Estimate if not ready
            const labelWidthPerc = (labelWidthPx / contentWidth) * 100;
            
            // Read Row Height from CSS to ensure sync
            const rowHeightCss = getComputedStyle(root).getPropertyValue('--row-height').trim();
            const ROW_HEIGHT = parseInt(rowHeightCss, 10) || 40;
            // 첫 행 위로도 라벨이 층을 쌓는다 — 여백이 없으면 컨테이너 위로 잘려 나간다.
            // 몇 층까지 쌓이는지는 데이터가 정하므로(같은 지점에 다섯 개면 2층) 상수 52px 은
            // **바닥값**이고, 그 위로 필요한 만큼은 앱과 **같은 규칙**이 정한다(labelHeadroom).
            // 작업명 열도 같은 값만큼 내려야 이름과 막대가 같은 높이에 온다.
            var firstRowItems = [];
            if (DATA[0] && DATA[0].milestones) {
                DATA[0].milestones.forEach(function(m) {
                    var d = parseDate(m.date);
                    if (d < startDate || d > maxDate) return;
                    firstRowItems.push({
                        id: m.id, label: m.label, labelPosition: m.labelPosition,
                        x: (getPosPercent(d, startDate, totalDays) / 100) * contentWidth,
                    });
                });
            }
            var PADDING_TOP = 52 + Math.max(0,
                labelHeadroom(placeMilestoneLabels(firstRowItems, contentWidth)) - HEADROOM_FLOOR);
            elTaskList.style.paddingTop = PADDING_TOP + 'px';

            DATA.forEach(function(task, index) {
                var rowTop = (index * ROW_HEIGHT) + PADDING_TOP; 
                var rowCenter = rowTop + (ROW_HEIGHT / 2);
                var ranges = (task.timeRanges && task.timeRanges.length > 0) ? task.timeRanges : (task.startDate ? [{id: task.id, startDate: task.startDate, endDate: task.endDate}] : []);
                
                // 레벨별 기본 바 높이 (모든 테마 공통 24/20/16px)
                var LEVEL_BAR_H = task.level === 0 ? 24 : task.level === 1 ? 20 : 16;
                var isLg = CHART_THEME === 'lg';
                var LG_STROKE = 2;
                
                // 1. Calculate Task Aggregates for Task ID (Legacy/Group Dependencies)
                let taskMinDate = null;
                let taskMaxDate = null;

                ranges.forEach(function(r) {
                    var s = parseDate(r.startDate);
                    var e = parseDate(r.endDate);
                    if (!taskMinDate || s < taskMinDate) taskMinDate = s;
                    if (!taskMaxDate || e > taskMaxDate) taskMaxDate = e;
                });

                if (taskMinDate && taskMaxDate) {
                    var tLeft = getPosPercent(taskMinDate, startDate, totalDays);
                    var tWidth = getWidthPercent(getDaysBetween(taskMinDate, taskMaxDate), totalDays);
                    // Register Task ID with type 'task'
                    coordMap.set(task.id, { x: tLeft + tWidth/2, y: rowCenter, right: tLeft + tWidth, left: tLeft, type: 'task' });
                }

                // 2. Register Individual Ranges
                ranges.forEach(function(range) {
                    var start = parseDate(range.startDate);
                    var end = parseDate(range.endDate);
                    
                    var leftPerc = getPosPercent(start, startDate, totalDays);
                    var widthPerc = getWidthPercent(getDaysBetween(start, end), totalDays);
                    
                    var entry = { x: leftPerc + widthPerc/2, y: rowCenter, right: leftPerc + widthPerc, left: leftPerc, type: 'range' };
                    if (range.id) coordMap.set(range.id, entry);

                    if (start > maxDate || end < startDate) return;

                    var color = STATUS_COLOR[task.id] || range.color || task.color || '#4a90e2';
                    // title 은 아래에서 속성값으로 삽입된다 (line ~757, ~767)
                    var title = esc(task.name) + ' (' + formatDate(start) + ' ~ ' + formatDate(end) + ')';
                    
                    // 바 높이: range.barHeight 오버라이드 → 레벨별 기본값
                    var barH = (range.barHeight != null) ? range.barHeight : LEVEL_BAR_H;
                    // 바 중앙 x (퍼센트)
                    var barCenterPerc = leftPerc + widthPerc / 2;
                    
                    var labelText = '';
                    
                    if (!${settings.showTaskNames} || ${settings.showBarLabels}) {
                         labelText += esc(range.label || task.name);
                    }
                    if (${settings.showBarDates}) {
                         if (labelText) labelText += ' ';
                         labelText += '(' + formatDate(start) + ' ~ ' + formatDate(end, 'MM.DD') + ')';
                    }

                    var labelHtml = '';
                    if (labelText) {
                        labelHtml = '<span class="bar-label">' + labelText + '</span>';
                    }

                    // LG 테마: SVG 화살표 바 (실제 px 기반)
                    if (isLg) {
                        // 실제 바 너비(px) 계산 — contentWidth 기준
                        var barWidthPx = Math.max(1, Math.round((widthPerc / 100) * contentWidth));
                        var S2 = LG_STROKE / 2;
                        var H = barH;
                        // 화살표 깊이: barH/2 (px 고정, 45°)
                        var D = H / 2;
                        // viewBox = 실제px × barH → preserveAspectRatio="none"이어도 x좌표 불변
                        var pts = [
                            S2 + ',' + S2,
                            (barWidthPx - D) + ',' + S2,
                            (barWidthPx - S2) + ',' + (H / 2),
                            (barWidthPx - D) + ',' + (H - S2),
                            S2 + ',' + (H - S2)
                        ].join(' ');
                        // LG 테마는 흰 채움 + 테두리라, 상태 색은 테두리에 실린다 (앱과 동일)
                        var lgStroke = STATUS_COLOR[task.id] || '#9e9e9e';
                        var svgInner =
                            '<polygon points="' + pts + '" fill="white" stroke="' + lgStroke + '" stroke-width="' + LG_STROKE + '" stroke-linejoin="miter"/>';

                        // 바 안 레이블 (showBarLabels) — 앱과 동일하게 왼쪽 정렬
                        // 주의: 여기서 생성되는 코드는 export된 HTML의 JS 문자열 안에 들어가므로
                        // font-family에 따옴표 필요한 이름(Segoe UI 등) 사용 불가 → 제거
                        var lgLabelHtml = labelText
                            ? '<span style="position:absolute;top:50%;left:8px;transform:translateY(-50%);font-size:11px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;color:#333;white-space:nowrap;pointer-events:none;overflow:hidden;max-width:calc(100% - 24px);text-overflow:ellipsis;">' + labelText + '</span>'
                            : '';

                        html += '<div class="timeline-bar lg-bar" style="left:' + leftPerc + '%;width:' + widthPerc + '%;top:' + rowCenter + 'px;height:' + barH + 'px;transform:translateY(-50%);overflow:hidden;" title="' + title + '">' +
                            '<svg viewBox="0 0 ' + barWidthPx + ' ' + H + '" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%;">' +
                            svgInner + '</svg>' +
                            lgLabelHtml +
                        '</div>';
                    } else {
                        // 진행률 채움 오버레이 (앱과 동일한 표현)
                        var progHtml = (task.progress > 0)
                            ? '<div style="position:absolute;left:0;top:0;height:100%;width:' + Math.min(100, task.progress) + '%;background:rgba(0,0,0,0.22);border-radius:4px 0 0 4px;pointer-events:none;"></div>'
                            : '';
                        html += '<div class="timeline-bar" style="left:' + leftPerc + '%;width:' + widthPerc + '%;top:' + rowCenter + 'px;height:' + barH + 'px;background-color:' + color + ';overflow:hidden;" title="' + title + '">' +
                            progHtml +
                            labelHtml +
                        '</div>';
                    }

                    // 기간 레이블 (showDurationLabel)
                    // LG 테마에서만 표시 (앱 동작과 일치)
                    var showDurLabel = isLg && (range.showDurationLabel !== false);
                    if (showDurLabel) {
                        var durDays = Math.max(1, getDaysBetween(range.startDate, range.endDate));
                        var durText = durDays + 'd';
                        var durPos = range.durationLabelPosition || 'above';
                        var durStyle = '';
                        if (durPos === 'above') {
                            // 바 상단 바로 위 (2px 간격), 가로는 바 가운데 정렬
                            durStyle = 'left:' + barCenterPerc + '%;top:' + (rowCenter - barH/2 - 2) + 'px;transform:translate(-50%,-100%);';
                        } else if (durPos === 'below') {
                            durStyle = 'left:' + barCenterPerc + '%;top:' + (rowCenter + barH/2 + 2) + 'px;transform:translateX(-50%);';
                        } else {
                            // inside: 바 중앙
                            durStyle = 'left:' + barCenterPerc + '%;top:' + rowCenter + 'px;transform:translate(-50%,-50%);';
                        }
                        html += '<div class="duration-label" style="' + durStyle + '">' + durText + '</div>';
                    }
                });

                // Divider
                if (task.divider && task.divider.enabled) {
                    var divH = task.divider.thickness || 1;
                    var divColor = task.divider.color || '#ccc';
                    var divStyle = task.divider.style || 'solid';
                    html += '<div class="task-divider" style="top:' + (rowTop + ROW_HEIGHT - divH) + 'px;height:' + divH + 'px;background:' + divColor + ';border-top:' + divH + 'px ' + divStyle + ' ' + divColor + ';"></div>';
                }

                if (task.milestones) {
                    // 배치는 앱과 **같은 순수함수**가 한다(placeMilestoneLabels). 그 좌표계는 컨테이너
                    // px 이고 이 렌더는 퍼센트로 그리므로, contentWidth 로 환산해서 넘긴다.
                    var shownMilestones = [];
                    task.milestones.forEach(function(m) {
                        var date = parseDate(m.date);
                        var leftPerc = getPosPercent(date, startDate, totalDays);
                        // 축 밖의 마일스톤도 의존성 화살표의 끝점이 될 수 있다 — 좌표는 항상 남긴다.
                        coordMap.set(m.id, { x: leftPerc, y: rowCenter, right: leftPerc, left: leftPerc, type: 'milestone' });
                        if (date < startDate || date > maxDate) return;
                        shownMilestones.push({
                            id: m.id, m: m, date: date, leftPerc: leftPerc,
                            x: (leftPerc / 100) * contentWidth,
                            label: m.label, labelPosition: m.labelPosition
                        });
                    });

                    var placements = placeMilestoneLabels(shownMilestones, contentWidth);

                    shownMilestones.forEach(function(item) {
                        var m = item.m;
                        var date = item.date;
                        var leftPerc = item.leftPerc;

                        var color = m.color || '#e67e22';
                        // 도형의 서술은 심어 둔 milestoneShapes.js 에서 온다 — 앱과 같은
                        // 소스이므로 모양이 앱과 어긋날 수 없다. 여기서 정하는 것은 표현뿐:
                        // 상자형은 .shape-div 클래스(테두리·그림자·크기)에 얹고, 회전은
                        // 부모의 .diamond 클래스가 CSS 로 준다.
                        var spec = milestoneShape(m.shape);
                        var svgStyle = 'filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));';
                        var shapeHtml;
                        if (spec.kind === 'box') {
                            shapeHtml = '<div class="shape-icon shape-div" style="background-color: ' + color + ';' +
                                (spec.borderRadius ? ' border-radius: ' + spec.borderRadius + ';' : '') + '"></div>';
                        } else {
                            shapeHtml = '<svg class="shape-icon" width="20" height="20" viewBox="' + spec.viewBox + '" style="' + svgStyle + '">' +
                                '<path d="' + spec.path + '" fill="' + color + '" stroke="white" stroke-width="2" stroke-linejoin="round" /></svg>';
                        }

                        var labelStyle = styleToCss(milestoneLabelStyle(placements.get(m.id)));

                        // Shape wrapper classes
                        var shapeClasses = 'milestone-shape' + (spec.rotate ? ' diamond' : '');

                        html += '<div class="milestone-marker" style="left: ' + leftPerc + '%; top: ' + rowCenter + 'px;" title="' + esc(m.label) + ' (' + formatDate(date) + ')">' +
                            '<div class="' + shapeClasses + '">' + shapeHtml + '</div>' +
                            '<div class="milestone-label" style="' + labelStyle + '">' + esc(m.label) + '</div>' +
                        '</div>';
                    });
                }
                
                html += '<div class="task-row" style="position: absolute; top: ' + rowTop + 'px; left: 0; width: 100%; pointer-events: none; border-bottom: 1px solid var(--color-grid);"></div>';
            });

            // Dependencies
            // Force visible color and higher Z-Index for lines
            // 화살촉은 marker 라 stroke 를 물려받지 못한다 — 앱과 같은 색 목록으로 하나씩
            // 정의한다. id 에 listId 를 섞는 것은 한 페이지에 여러 개를 심을 때를 위한 것이다.
            let svgHtml = '<defs>' + dependencyStrokes().map(function(stroke) {
                return '<marker id="' + dependencyMarkerId(stroke, '${listId}') + '" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">'
                     + '<polygon points="0 0, 6 2, 0 4" fill="' + stroke + '" /></marker>';
            }).join('') + '</defs>';
            const connections = [];
            const collect = (src, tgt) => {
                 const s = coordMap.get(src); const t = coordMap.get(tgt);
                 // 간선의 **id** 도 들고 간다 — 색은 판정 결과(EDGE_ISSUES)로 고르고,
                 // 판정은 id 로만 찾을 수 있다.
                 if (s && t) connections.push({src: s, tgt: t, srcId: src, tgtId: tgt});
            };
            DATA.forEach(t => {
                if (t.dependencies) t.dependencies.forEach(d => collect(d, t.id));
                if (t.timeRanges) t.timeRanges.forEach(r => { if(r.dependencies) r.dependencies.forEach(d => collect(d, r.id)); });
                if (t.milestones) t.milestones.forEach(m => { if(m.dependencies) m.dependencies.forEach(d => collect(d, m.id)); });
            });

            // Fix: Set explicit height because rows are absolute
            elTimelineContent.style.height = (DATA.length * ROW_HEIGHT + PADDING_TOP + 20) + 'px';

            const temp = document.createElement('div');
            temp.innerHTML = html;
            Array.from(elTimelineContent.children).forEach(child => {
                if (!child.classList.contains('today-marker') && !child.classList.contains('dependency-svg')) child.remove();
            });
            while (temp.firstChild) {
                elTimelineContent.appendChild(temp.firstChild);
            }
            

            // Draw SVG Lines 
            setTimeout(() => {
                const width = elTimelineContent.offsetWidth || 1000;

                let pathHtml = '';
                connections.forEach(({src, tgt, srcId, tgtId}) => {
                    const startX = (src.right / 100) * width;
                    let endX = (tgt.left / 100) * width;
                    const startY = src.y;
                    const endY = tgt.y;

                    // If target is milestone, stop at the icon edge (approx 10px left from center)
                    if (tgt.type === 'milestone') {
                        endX -= 12; // 10px + 2px buffer
                    }
                    
                    // 경로는 앱과 같은 순수함수가 그린다(dependencyPath) — 여기서 다시 적으면 어긋난다.
                    const path = dependencyPath(startX, startY, endX, endY);
                    // 색·선 모양도 앱과 같은 모듈이 고른다(dependencyStyle). 전부 회색 점선으로
                    // 그리면 문제가 있던 연결과 없던 연결이 문서에서 똑같아 보인다.
                    const issue = EDGE_ISSUES[srcId + '>' + tgtId] || null;
                    const st = dependencyStyleFor(issue, false);
                    const dash = 'stroke-dasharray: ' + (st.dash || 'none') + ';';
                    const titleEl = st.title ? '<title>' + esc(st.title) + '</title>' : '';
                    pathHtml += \`<path d="\${path}" class="dependency-line" data-issue="\${issue || ''}" marker-end="url(#\${dependencyMarkerId(st.stroke, '${listId}')})" style="stroke: \${st.stroke}; stroke-width: \${st.width}px; \${dash} opacity: 1.0; fill: none;">\${titleEl}</path>\`;
                });
                elSvg.innerHTML = svgHtml + pathHtml;
                // Force Z-Index update
                elSvg.style.zIndex = '5';
                
                const today = new Date();
                if (${settings.showToday} && today >= startDate && today <= maxDate) {
                    const offset = getDaysBetween(startDate, today);
                    const leftPerc = ((offset / totalDays) * 100) + '%';
                    
                    // Line
                    elTodayMarker.style.left = leftPerc;
                    elTodayMarker.style.display = 'block';
                    
                    // Header Label
                    if (elTodayHeader) {
                        elTodayHeader.style.left = leftPerc;
                        elTodayHeader.style.display = 'block';
                    }
                } else {
                    elTodayMarker.style.display = 'none';
                    if (elTodayHeader) elTodayHeader.style.display = 'none';
                }
            }, 100); // Increased timeout slightly
        }

        elTimelineScroll.addEventListener('scroll', () => {
            elHeaderScroll.scrollLeft = elTimelineScroll.scrollLeft;
            elTaskList.scrollTop = elTimelineScroll.scrollTop;
        });

        renderTaskList();
        renderHeader();
        renderTimeline();
        
        setTimeout(() => {
             const today = new Date();
             if (today >= startDate && today <= maxDate) {
                 const offset = getDaysBetween(startDate, today);
                 const perc = offset / totalDays;
                 const w = elTimelineContent.offsetWidth;
                 elTimelineScroll.scrollLeft = (w * perc) - 300;
             }
        }, 50);

    })();
    </script>
</div>`.trim();
};
