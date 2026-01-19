
/**
 * Export project data to a single self-contained HTML file.
 * @param {Array} tasks - List of tasks
 * @param {Object} settings - View settings (darkMode, etc. - mostly for initial state)
 * @returns {string} - The complete HTML string
 */
export const exportToHtml = (tasks, settings = {}) => {
    const tasksJson = JSON.stringify(tasks);
    const darkMode = settings.darkMode ? 'dark' : 'light';

    return `<!DOCTYPE html>
<html lang="ko" data-theme="${darkMode}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>프로젝트 타임라인 (Interactive View)</title>
    <style>
        :root {
            /* Colors matching the React app */
            --color-bg-primary: #ffffff;
            --color-bg-secondary: #f8f9fa;
            --color-text-primary: #2c3e50;
            --color-text-secondary: #6c757d;
            --color-border: #e9ecef;
            --color-grid: #f1f3f5;
            --color-primary: #4a90e2;
            --color-danger: #e74c3c;
            
            --row-height: 48px;
            --header-height: 50px;
            --day-width: 40px; /* Dynamic via Zoom */
            
            --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        [data-theme="dark"] {
            --color-bg-primary: #1e1e1e;
            --color-bg-secondary: #252526;
            --color-text-primary: #e0e0e0;
            --color-text-secondary: #a0a0a0;
            --color-border: #3e3e42;
            --color-grid: #2d2d30;
        }

        body {
            font-family: var(--font-family);
            margin: 0;
            padding: 0;
            background-color: var(--color-bg-primary);
            color: var(--color-text-primary);
            overflow: hidden; /* App container handles scroll */
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* Toolbar */
        .toolbar {
            height: 40px;
            background-color: var(--color-bg-secondary);
            border-bottom: 1px solid var(--color-border);
            display: flex;
            align-items: center;
            padding: 0 16px;
            gap: 16px;
            font-size: 13px;
            flex-shrink: 0;
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Layout */
        #app-container {
            display: flex;
            flex: 1;
            overflow: hidden;
            position: relative;
        }

        /* Task List Column */
        #task-list-column {
            width: 240px;
            border-right: 1px solid var(--color-border);
            background-color: var(--color-bg-primary);
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .header-cell {
            height: var(--header-height);
            background-color: var(--color-bg-secondary);
            border-bottom: 1px solid var(--color-border);
            display: flex;
            align-items: center;
            padding: 0 16px;
            font-weight: 600;
            font-size: 13px;
        }

        .task-list-content {
            flex: 1;
            overflow: hidden; /* Synced scroll */
        }

        .task-item {
            height: var(--row-height);
            border-bottom: 1px solid var(--color-grid);
            display: flex;
            align-items: center;
            padding: 0 16px;
            box-sizing: border-box;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 13px;
        }

        .task-item.level-0 { font-weight: 600; }
        .task-item.level-1 { padding-left: 32px; font-size: 12px; }
        .task-item.level-2 { padding-left: 48px; font-size: 12px; color: var(--color-text-secondary); }

        /* Timeline Column */
        #timeline-column {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        #timeline-header-scroll {
            overflow: hidden;
            flex-shrink: 0;
        }

        #timeline-header {
            height: var(--header-height);
            background-color: var(--color-bg-secondary);
            border-bottom: 1px solid var(--color-border);
            position: relative;
        }

        .header-months {
            height: 24px;
            position: relative;
            border-bottom: 1px solid var(--color-border);
        }
        
        .header-days {
            height: 26px;
            position: relative;
        }

        .month-label {
            position: absolute;
            font-size: 11px;
            padding-left: 4px;
            border-left: 1px solid var(--color-border);
            height: 100%;
            display: flex;
            align-items: center;
        }

        .day-label {
            position: absolute;
            font-size: 10px;
            text-align: center;
            border-left: 1px solid var(--color-grid);
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #timeline-scroll-area {
            flex: 1;
            overflow: auto;
            position: relative;
        }

        #timeline-content {
            position: relative;
        }

        .grid-line {
            position: absolute;
            top: 0;
            bottom: 0;
            border-left: 1px solid var(--color-grid);
            pointer-events: none;
        }

        .task-row {
            height: var(--row-height);
            border-bottom: 1px solid var(--color-grid);
            position: relative;
        }

        .timeline-bar {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            height: 24px;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            font-size: 11px;
            color: white;
            display: flex;
            align-items: center;
            padding: 0 8px;
            overflow: hidden;
            white-space: nowrap;
            box-sizing: border-box;
            cursor: default;
        }

        .timeline-bar:hover {
            opacity: 0.9;
            z-index: 10;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }
        
        /* Bar Label inside */
        .bar-label {
            text-overflow: ellipsis;
            overflow: hidden;
        }

        /* Milestone */
        .milestone-marker {
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 16px;
            height: 16px;
            z-index: 5;
            display: flex;
            justify-content: center;
        }

        .milestone-shape {
            width: 14px;
            height: 14px;
            background-color: #e67e22; /* Default */
            border: 2px solid white;
            transform: rotate(45deg); /* Diamond default */
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }

        .milestone-label {
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 10px;
            white-space: nowrap;
        }

        /* Today Marker */
        #today-marker {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 2px;
            background-color: var(--color-danger);
            opacity: 0.5;
            z-index: 20;
            pointer-events: none;
            display: none; /* Toggled by JS */
        }

        #today-marker.visible {
            display: block;
        }
        
        #today-label {
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--color-danger);
            color: white;
            font-size: 10px;
            padding: 1px 4px;
            border-radius: 0 0 4px 4px;
        }

    </style>
</head>
<body>

<div class="toolbar">
    <div class="control-group">
        <label for="zoom">Zoom</label>
        <input type="range" id="zoom" min="20" max="100" value="40" step="5">
    </div>
    <div class="control-group">
        <input type="checkbox" id="showToday" checked>
        <label for="showToday">오늘 표시</label>
    </div>
    <div style="flex: 1 text-align: right; color: var(--color-text-secondary);">
        Roll Wheel to scroll vertical, Shift+Wheel to scroll horizontal
    </div>
</div>

<div id="app-container">
    <div id="task-list-column">
        <div class="header-cell">작업명</div>
        <div id="task-list-content" class="task-list-content">
            <!-- Tasks injected here -->
        </div>
    </div>

    <div id="timeline-column">
        <div id="timeline-header-scroll">
            <div id="timeline-header">
                <div id="header-months" class="header-months"></div>
                <div id="header-days" class="header-days"></div>
            </div>
        </div>
        <div id="timeline-scroll-area">
            <div id="timeline-content">
                <div id="today-marker">
                    <div id="today-label">Today</div>
                </div>
                <!-- Bars injected here -->
            </div>
        </div>
    </div>
</div>

<script>
    const DATA = ${tasksJson};
    
    // Minimal Date Utils
    const ONE_DAY = 24 * 60 * 60 * 1000;
    
    function parseDate(str) { return new Date(str); }
    function formatDate(date) { 
        return \`\${date.getFullYear()}.\${String(date.getMonth()+1).padStart(2,'0')}.\${String(date.getDate()).padStart(2,'0')}\`; 
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

    // Determine Date Range
    let minDate = new Date();
    let maxDate = new Date();
    
    if (DATA.length > 0) {
        let starts = [];
        let ends = [];
        DATA.forEach(t => {
            // Check timeRanges
            if (t.timeRanges && t.timeRanges.length > 0) {
                t.timeRanges.forEach(r => {
                    starts.push(parseDate(r.startDate));
                    ends.push(parseDate(r.endDate));
                });
            } else if (t.startDate) {
                starts.push(parseDate(t.startDate));
                ends.push(parseDate(t.endDate));
            }
            // Check milestones
            if (t.milestones) {
                t.milestones.forEach(m => {
                    starts.push(parseDate(m.date));
                    ends.push(parseDate(m.date));
                });
            }
        });
        
        if (starts.length > 0) {
            minDate = new Date(Math.min(...starts));
            maxDate = new Date(Math.max(...ends));
        }
    }

    // Add padding
    minDate = addDays(minDate, -7);
    maxDate = addDays(maxDate, 14);
    
    const startDate = minDate;
    const totalDays = getDaysBetween(startDate, maxDate) + 1;

    // DOM Elements
    const elTaskList = document.getElementById('task-list-content');
    const elHeaderMonths = document.getElementById('header-months');
    const elHeaderDays = document.getElementById('header-days');
    const elTimelineContent = document.getElementById('timeline-content');
    const elTimelineScroll = document.getElementById('timeline-scroll-area');
    const elHeaderScroll = document.getElementById('timeline-header-scroll');
    const elTodayMarker = document.getElementById('today-marker');

    // Controls
    const zoomInput = document.getElementById('zoom');
    const todayToggle = document.getElementById('showToday');

    // State
    let dayWidth = 40;

    function renderTaskList() {
        // Flatten simple
        const html = DATA.map(task => {
            const level = task.level || 0;
            return \`<div class="task-item level-\${level}" title="\${task.name}">\${task.name}</div>\`;
        }).join('');
        elTaskList.innerHTML = html;
    }

    function renderHeader() {
        let current = new Date(startDate);
        let monthsHtml = '';
        let daysHtml = '';

        for (let i = 0; i < totalDays; i++) {
            const isFirstDay = current.getDate() === 1;
            const isFirstLoop = i === 0;
            
            // Month Label
            if (isFirstDay || isFirstLoop) {
                const label = \`\${current.getFullYear()}.\${current.getMonth() + 1}\`;
                monthsHtml += \`<div class="month-label" style="left: \${i * dayWidth}px;">\${label}</div>\`;
            }

            // Day Label
            // Show every day if zoomed in, otherwise sparse? For now every day but simplified
            if (dayWidth >= 20) {
                daysHtml += \`<div class="day-label" style="left: \${i * dayWidth}px; width: \${dayWidth}px;">\${current.getDate()}</div>\`;
            }
            
            // Next day
            current.setDate(current.getDate() + 1);
        }
        
        elHeaderMonths.innerHTML = monthsHtml;
        elHeaderDays.innerHTML = daysHtml;
        
        // Widths
        const totalWidth = totalDays * dayWidth;
        elHeaderMonths.style.width = totalWidth + 'px';
        elHeaderDays.style.width = totalWidth + 'px';
        elTimelineContent.style.width = totalWidth + 'px';
    }

    function renderTimeline() {
        let html = '';
        let gridHtml = '';

        // Grid Lines (Monthly? Weekly?)
        // Let's draw vertical lines for every day
        if (dayWidth > 10) {
             // Too heavy to draw div for every day? Use Repeating linear gradient in CSS maybe
             // For simplicity, let's just make the row bottom border visible. 
             // We can draw major lines (Mondays or 1st of month)
        }

        DATA.forEach((task, index) => {
            const rowTop = index * 48; // row-height
            
            // TimeRanges
            const ranges = task.timeRanges || (task.startDate ? [{startDate: task.startDate, endDate: task.endDate}] : []);
            
            ranges.forEach(range => {
                const start = parseDate(range.startDate);
                const end = parseDate(range.endDate);
                if (start > maxDate || end < startDate) return;

                const offsetDays = getDaysBetween(startDate, start);
                const durationDays = getDaysBetween(start, end);
                
                const left = offsetDays * dayWidth;
                const width = durationDays * dayWidth;
                const color = range.color || task.color || '#4a90e2';
                
                const title = \`\${task.name} (\${formatDate(start)} ~ \${formatDate(end)})\`;

                html += \`<div class="timeline-bar" style="left: \${left}px; width: \${width}px; top: \${rowTop + 24}px; background-color: \${color};" title="\${title}">
                    <span class="bar-label">\${task.name}</span>
                </div>\`;
            });

            // Milestones
            if (task.milestones) {
                task.milestones.forEach(m => {
                    const date = parseDate(m.date);
                    if (date < startDate || date > maxDate) return;
                    
                    const offset = getDaysBetween(startDate, date);
                    const left = offset * dayWidth;
                    const color = m.color || '#e67e22';
                    const shape = m.shape || 'diamond';
                    
                    // Simple shape mapping
                    let borderRadius = '0';
                    let transform = 'rotate(45deg)';
                    if (shape === 'circle') { borderRadius = '50%'; transform = 'none'; }
                    if (shape === 'square') { transform = 'none'; }
                    
                    html += \`<div class="milestone-marker" style="left: \${left}px; top: \${rowTop + 24}px;" title="\${m.label} (\${formatDate(date)})">
                        <div class="milestone-shape" style="background-color: \${color}; border-radius: \${borderRadius}; transform: \${transform};"></div>
                        <div class="milestone-label">\${m.label}</div>
                    </div>\`;
                });
            }
            
            // Grid row line (visualized by css .task-row but we need absolute positioning for bars)
            html += \`<div class="task-row" style="position: absolute; top: \${rowTop}px; left: 0; width: 100%; pointer-events: none; border-bottom: 1px solid var(--color-grid);"></div>\`;
        });

        // Today Marker
        const today = new Date();
        if (today >= startDate && today <= maxDate) {
            const offset = getDaysBetween(startDate, today);
            const left = offset * dayWidth;
            elTodayMarker.style.left = left + 'px';
        }
        
        // Append bars/rows AFTER marker so marker is on top (z-index handles it but DOM order helps)
        // Wait, marker is already in DOM. We append bars to content.
        // We need to clear previous bars first.
        // Let's allow today marker to stay and just append string
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Clear old bars (keep marker)
        Array.from(elTimelineContent.children).forEach(child => {
            if (child.id !== 'today-marker') child.remove();
        });
        
        while (temp.firstChild) {
            elTimelineContent.appendChild(temp.firstChild);
        }
    }

    function updateTodayVisibility() {
        if (todayToggle.checked) {
            elTodayMarker.classList.add('visible');
        } else {
            elTodayMarker.classList.remove('visible');
        }
    }

    // Event Listeners
    zoomInput.addEventListener('input', (e) => {
        dayWidth = parseInt(e.target.value, 10);
        document.documentElement.style.setProperty('--day-width', dayWidth + 'px');
        renderHeader();
        renderTimeline(); // Re-calc positions based on new width
    });

    todayToggle.addEventListener('change', updateTodayVisibility);

    // Synced Scroll
    elTimelineScroll.addEventListener('scroll', () => {
        elHeaderScroll.scrollLeft = elTimelineScroll.scrollLeft;
        elTaskList.scrollTop = elTimelineScroll.scrollTop;
    });

    // Init
    renderTaskList();
    renderHeader();
    renderTimeline();
    updateTodayVisibility();
    
    // Scroll to today initial
    const today = new Date();
    if (today >= startDate && today <= maxDate) {
        const offset = getDaysBetween(startDate, today);
        elTimelineScroll.scrollLeft = (offset * dayWidth) - 300;
    }

</script>
</body>
</html>`;
};
