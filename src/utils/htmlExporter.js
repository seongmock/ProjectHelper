
/**
 * Export project data to a single self-contained HTML file.
 * @param {Array} tasks - List of tasks
 * @param {Object} settings - View settings (darkMode, etc. - mostly for initial state)
 * @returns {string} - The complete HTML string
 */
export const exportToHtml = (tasks, settings = {}) => {
    const tasksJson = JSON.stringify(tasks);
    const darkMode = settings.darkMode ? 'dark' : 'light';

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
            top: 50%;
            transform: translateY(-50%);
            height: 24px;
            border-radius: 4px;
/* ... */
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            font-size: 11px;
            color: white;
            display: flex;
            align-items: center;
            padding: 0 8px;
            overflow: hidden;
            white-space: nowrap;
            cursor: default;
            z-index: 2;
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
        #ph-gantt-${listId} .dependency-svg path {
            fill: none;
            stroke: var(--color-link);
            stroke-width: 1.5;
            marker-end: url(#arrowhead-${listId});
            opacity: 0.6;
            stroke-dasharray: 4 2; /* Default dashed style */
        }
        #ph-gantt-${listId} .dependency-line {
            stroke-dasharray: 4 2;
            opacity: 1.0 !important; /* Ensure visibility */
        }
    </style>

    <div class="gantt-body">
        <div class="task-list-column">
            <div class="header-cell">작업명</div>
            <div class="task-list-content qs-tasks-${listId}">
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

    <script>
    (function() {
        // Scoped Execution
        const root = document.getElementById('ph-gantt-${listId}');
        if (!root) return;

        const RAW_DATA = ${tasksJson};
        const ZOOM_LEVEL = ${zoomLevel};
        const TIME_SCALE = '${settings.timeScale || 'monthly'}';

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
             if (format === 'MM.DD') return \`\${m}.\${d}\`;
             return \`\${y}.\${m}.\${d}\`; 
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
            if (t.timeRanges) t.timeRanges.forEach(r => { allDates.push(parseDate(r.startDate)); allDates.push(parseDate(r.endDate)); });
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
        function renderTaskList() {
            elTaskList.innerHTML = DATA.map(task => {
                return \`<div class="task-item level-\${task.level}" title="\${task.name}">\${task.name}</div>\`;
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

            DATA.forEach(function(task, index) {
                var rowTop = index * ROW_HEIGHT; 
                var rowCenter = rowTop + (ROW_HEIGHT / 2);
                var ranges = task.timeRanges || (task.startDate ? [{id: task.id, startDate: task.startDate, endDate: task.endDate}] : []);
                
                // 1. Calculate Task Aggregates for Task ID (Legacy/Group Dependencies)
                // Finds the overall start and end of the task to ensure Task-level dependencies connect to the very end/start
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

                    var color = range.color || task.color || '#4a90e2';
                    var title = task.name + ' (' + formatDate(start) + ' ~ ' + formatDate(end) + ')';
                    var labelText = range.label || task.name;
                    if (${settings.showPeriodLabels}) {
                        // Always append date range if showPeriodLabels is true
                        labelText += ' (' + formatDate(start) + ' ~ ' + formatDate(end, 'MM.DD') + ')';
                    }

                    var labelHtml = '';
                    // Only show label if TaskNames or PeriodLabels are enabled, or if it's a specific range label (optional refinement)
                    if (${settings.showTaskNames} || ${settings.showPeriodLabels}) {
                        labelHtml = '<span class="bar-label">' + labelText + '</span>';
                    }

                    html += '<div class="timeline-bar" style="left: ' + leftPerc + '%; width: ' + widthPerc + '%; top: ' + rowCenter + 'px; background-color: ' + color + ';" title="' + title + '">' +
                        labelHtml +
                    '</div>';
                });

                if (task.milestones) {
                    var placedMilestones = []; 

                    // Sort milestones by X position to handle collisions correctly
                    var preparedMilestones = task.milestones.map(function(m) {
                        var date = parseDate(m.date);
                        var leftPerc = getPosPercent(date, startDate, totalDays);
                        // Approximate width: Char count * 14 + 10px
                        var widthPx = (m.label.length * 14) + 10;
                        var widthPerc = (widthPx / contentWidth) * 100;
                        return { m: m, leftPerc: leftPerc, widthPerc: widthPerc, date: date };
                    }).sort(function(a, b) { return a.leftPerc - b.leftPerc; });

                    preparedMilestones.forEach(function(item) {
                        var m = item.m;
                        var leftPerc = item.leftPerc;
                        var widthPerc = item.widthPerc;
                        var date = item.date;

                        coordMap.set(m.id, { x: leftPerc, y: rowCenter, right: leftPerc, left: leftPerc, type: 'milestone' });

                        if (date < startDate || date > maxDate) return;
                        
                        // Collision Detection
                        var checkCollision = function(start, end, type) {
                             return placedMilestones.some(function(p) {
                                 if (p.type !== type) return false;
                                 return (start < p.end && end > p.start);
                             });
                        };

                        var pos = 'top';
                        // Determine manual or auto position
                        if (m.labelPosition && m.labelPosition !== 'auto') {
                             pos = m.labelPosition;
                        } else {
                            // Auto: Top -> Bottom -> Right -> Top
                            var halfW = widthPerc / 2;
                            var topStart = leftPerc - halfW;
                            var topEnd = leftPerc + halfW;
                            
                            if (!checkCollision(topStart, topEnd, 'top')) {
                                pos = 'top';
                            } else {
                                var bottomStart = leftPerc - halfW;
                                var bottomEnd = leftPerc + halfW;
                                if (!checkCollision(bottomStart, bottomEnd, 'bottom')) {
                                     pos = 'bottom';
                                } else {
                                     var tenPxPerc = (10 / contentWidth) * 100;
                                     var rightStart = leftPerc + tenPxPerc;
                                     var rightEnd = rightStart + widthPerc;
                                     if (!checkCollision(rightStart, rightEnd, 'right')) {
                                          pos = 'right';
                                     } else {
                                          pos = 'top'; // Fallback
                                     }
                                }
                            }
                        }
                        // Register Occupied
                        var occupiedStart = 0, occupiedEnd = 0;
                        if (pos === 'right') {
                             var tenPxPerc = (10 / contentWidth) * 100;
                             occupiedStart = leftPerc + tenPxPerc;
                             occupiedEnd = occupiedStart + widthPerc;
                        } else if (pos === 'left') {
                             var tenPxPerc = (10 / contentWidth) * 100;
                             occupiedEnd = leftPerc - tenPxPerc;
                             occupiedStart = occupiedEnd - widthPerc;
                        } else {
                             occupiedStart = leftPerc - (widthPerc/2);
                             occupiedEnd = leftPerc + (widthPerc/2);
                        }
                        placedMilestones.push({ start: occupiedStart, end: occupiedEnd, type: pos });

                        var color = m.color || '#e67e22';
                        var shape = m.shape || 'diamond';
                        
                        var shapeHtml = '';
                        var svgStyle = 'filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));';
                        
                        // Use classes for shapes. .shape-div has border/shadow/sizing.
                        if (shape === 'circle') shapeHtml = '<div class="shape-icon shape-div" style="background-color: ' + color + '; border-radius: 50%;"></div>';
                        else if (shape === 'square') shapeHtml = '<div class="shape-icon shape-div" style="background-color: ' + color + '; border-radius: 2px;"></div>';
                        else if (shape === 'diamond') shapeHtml = '<div class="shape-icon shape-div" style="background-color: ' + color + ';"></div>'; // Rotation handled by parent class + CSS
                        else if (shape === 'triangle') shapeHtml = '<svg class="shape-icon" width="20" height="20" viewBox="0 0 24 24" style="' + svgStyle + '"><path d="M12 2L22 22H2L12 2Z" fill="' + color + '" stroke="white" stroke-width="2" stroke-linejoin="round" /></svg>';
                        else if (shape === 'star') shapeHtml = '<svg class="shape-icon" width="20" height="20" viewBox="0 0 24 24" style="' + svgStyle + '"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="' + color + '" stroke="white" stroke-width="2" stroke-linejoin="round" /></svg>';
                        else if (shape === 'flag') shapeHtml = '<svg class="shape-icon" width="20" height="20" viewBox="0 0 24 24" style="' + svgStyle + '"><path d="M14.4 6L14 4H5V21H7V14H12L12.4 16H22V6H14.4Z" fill="' + color + '" stroke="white" stroke-width="2" stroke-linejoin="round" /></svg>';
                        else shapeHtml = '<div class="shape-icon shape-div" style="background-color: ' + color + ';"></div>';

                        // Match Label Style from TimelineBar.jsx with override logic for 'top/bottom/left/right'
                        var labelStyle = '';
                        if (pos === 'top') labelStyle = 'bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 4px;';
                        else if (pos === 'left') labelStyle = 'right: 100%; top: 50%; transform: translateY(-50%); margin-right: 8px;';
                        else if (pos === 'right') labelStyle = 'left: 100%; top: 50%; transform: translateY(-50%); margin-left: 8px;';
                        else labelStyle = 'top: 100%; left: 50%; transform: translateX(-50%); margin-top: 4px;'; // bottom

                        // Shape wrapper classes
                        var shapeClasses = 'milestone-shape';
                        if (shape === 'diamond') shapeClasses += ' diamond';
                        
                        html += '<div class="milestone-marker" style="left: ' + leftPerc + '%; top: ' + rowCenter + 'px;" title="' + m.label + '">' +
                            '<div class="' + shapeClasses + '">' + shapeHtml + '</div>' +
                            '<div class="milestone-label" style="' + labelStyle + '">' + m.label + '</div>' +
                        '</div>';
                    });
                }
                
                html += '<div class="task-row" style="position: absolute; top: ' + rowTop + 'px; left: 0; width: 100%; pointer-events: none; border-bottom: 1px solid var(--color-grid);"></div>';
            });

            // Dependencies
            // Force visible color and higher Z-Index for lines
            let svgHtml = '<defs><marker id="arrowhead-${listId}" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="#999" /></marker></defs>';
            const connections = [];
            const collect = (src, tgt) => {
                 const s = coordMap.get(src); const t = coordMap.get(tgt);
                 if (s && t) connections.push({src: s, tgt: t});
            };
            DATA.forEach(t => {
                if (t.dependencies) t.dependencies.forEach(d => collect(d, t.id));
                if (t.timeRanges) t.timeRanges.forEach(r => { if(r.dependencies) r.dependencies.forEach(d => collect(d, r.id)); });
                if (t.milestones) t.milestones.forEach(m => { if(m.dependencies) m.dependencies.forEach(d => collect(d, m.id)); });
            });

            // Fix: Set explicit height because rows are absolute
            elTimelineContent.style.height = (DATA.length * ROW_HEIGHT) + 'px';

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
                console.log("ProjectHelper Debug: Exported Gantt Chart");
                console.log("Timeline Content Width:", width);
                console.log("Timeline Content Height:", elTimelineContent.offsetHeight); 
                console.log("Connections to draw:", connections.length);
                
                let pathHtml = '';
                connections.forEach(({src, tgt}) => {
                    const startX = (src.right / 100) * width;
                    let endX = (tgt.left / 100) * width;
                    const startY = src.y;
                    const endY = tgt.y;

                    // If target is milestone, stop at the icon edge (approx 10px left from center)
                    if (tgt.type === 'milestone') {
                        endX -= 12; // 10px + 2px buffer
                    }
                    
                     let path = '';
                    const midX = startX + 20;
                    
                    if (startX < endX - 40) {
                        path = \`M \${startX} \${startY} L \${midX} \${startY} L \${midX} \${endY} L \${endX} \${endY}\`;
                    } else if (Math.abs(startY - endY) < 1 && startX < endX) {
                        // Same row, forward direction -> Straight Line
                        path = \`M \${startX} \${startY} L \${endX} \${endY}\`;
                    } else {
                        const backX = startX + 10;
                        const forwardX = endX - 30;
                        const midY = (startY + endY) / 2;
                        path = \`M \${startX} \${startY} L \${backX} \${startY} L \${backX} \${midY} L \${forwardX} \${midY} L \${forwardX} \${endY} L \${endX} \${endY}\`;
                    }
                    // Match color with TimelineView (#999)
                    pathHtml += \`<path d="\${path}" class="dependency-line" marker-end="url(#arrowhead-${listId})" style="stroke: #999; stroke-width: 2px; stroke-dasharray: 4 2; opacity: 1.0; fill: none;" />\`;
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
