import {
    Table2, Columns2, ChartGantt, ZoomIn, ZoomOut, Camera, Code2, Search, Plus,
} from 'lucide-react';
import DisplayOptionsMenu from './DisplayOptionsMenu';
import './Toolbar.css';

// 툴바는 3그룹이다: [뷰 전환] | [시간축·줌] | [표시 옵션·내보내기].
// 예전에는 표시 토글 6종과 차트 테마까지 전부 상시 버튼이라 좁은 화면에서 넘쳤다.
function Toolbar({
    viewMode,
    onViewModeChange,
    timeScale,
    onTimeScaleChange,
    searchQuery,
    onSearchChange,
    onAddTask,
    // 타임라인 컨트롤 props
    zoomLevel,
    onZoomIn,
    onZoomOut,
    showToday,
    onToggleToday,
    isCompact,
    onToggleCompact,
    showTaskNames,
    onToggleTaskNames,
    onCopyImage,
    snapEnabled,
    onToggleSnap,

    onHtmlExport,

    showBarLabels,
    onToggleBarLabels,
    showBarDates,
    onToggleBarDates,

    chartTheme,
    onThemeChange,
}) {
    const isTimeline = viewMode === 'timeline' || viewMode === 'split';

    return (
        <div className="toolbar">
            <div className="toolbar-content">
                <div className="toolbar-left flex items-center gap-md">
                    {/* 그룹 1 — 뷰 전환 */}
                    <div className="view-toggle">
                        <button
                            className={viewMode === 'table' ? 'active' : ''}
                            onClick={() => onViewModeChange('table')}
                            title="표 뷰"
                        >
                            <Table2 size={15} aria-hidden="true" />
                            <span>표</span>
                        </button>
                        <button
                            className={viewMode === 'split' ? 'active' : ''}
                            onClick={() => onViewModeChange('split')}
                            title="분할 뷰"
                        >
                            <Columns2 size={15} aria-hidden="true" />
                            <span>분할</span>
                        </button>
                        <button
                            className={viewMode === 'timeline' ? 'active' : ''}
                            onClick={() => onViewModeChange('timeline')}
                            title="타임라인 뷰"
                        >
                            <ChartGantt size={15} aria-hidden="true" />
                            <span>타임라인</span>
                        </button>
                    </div>

                    {isTimeline && (
                        <>
                            <span className="toolbar-sep" />

                            {/* 그룹 2 — 시간축과 줌 */}
                            <div className="time-scale-toggle">
                                <button
                                    className={timeScale === 'monthly' ? 'active' : ''}
                                    onClick={() => onTimeScaleChange('monthly')}
                                    title="월별 보기"
                                >
                                    월별
                                </button>
                                <button
                                    className={timeScale === 'quarterly' ? 'active' : ''}
                                    onClick={() => onTimeScaleChange('quarterly')}
                                    title="분기별 보기"
                                >
                                    분기별
                                </button>
                            </div>

                            <div className="zoom-controls">
                                <button className="icon-btn icon-only" onClick={onZoomOut} title="축소">
                                    <ZoomOut size={15} aria-hidden="true" />
                                </button>
                                <span className="zoom-level" aria-label="확대 배율">
                                    {Math.round(zoomLevel * 100)}%
                                </span>
                                <button className="icon-btn icon-only" onClick={onZoomIn} title="확대">
                                    <ZoomIn size={15} aria-hidden="true" />
                                </button>
                            </div>

                            <span className="toolbar-sep" />

                            {/* 그룹 3 — 표시 옵션과 내보내기 */}
                            <DisplayOptionsMenu
                                showTaskNames={showTaskNames}
                                onToggleTaskNames={onToggleTaskNames}
                                showBarLabels={showBarLabels}
                                onToggleBarLabels={onToggleBarLabels}
                                showBarDates={showBarDates}
                                onToggleBarDates={onToggleBarDates}
                                showToday={showToday}
                                onToggleToday={onToggleToday}
                                isCompact={isCompact}
                                onToggleCompact={onToggleCompact}
                                snapEnabled={snapEnabled}
                                onToggleSnap={onToggleSnap}
                                chartTheme={chartTheme}
                                onThemeChange={onThemeChange}
                            />

                            <button className="icon-btn icon-only" onClick={onCopyImage} title="이미지로 복사">
                                <Camera size={15} aria-hidden="true" />
                            </button>
                            <button className="icon-btn icon-only" onClick={onHtmlExport} title="HTML 코드 복사하기 (클립보드)">
                                <Code2 size={15} aria-hidden="true" />
                            </button>
                        </>
                    )}
                </div>

                <div className="toolbar-right flex items-center gap-md">
                    <div className="search-box">
                        <Search className="search-box-icon" size={15} aria-hidden="true" />
                        <input
                            type="text"
                            placeholder="작업 검색..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>

                    <button className="primary" onClick={onAddTask} title="새 작업 추가 (Ctrl+N)">
                        <Plus size={15} aria-hidden="true" />
                        <span>새 작업</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Toolbar;
