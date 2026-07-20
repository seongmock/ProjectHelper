import { THEMES } from '../themes/index.js';
import './Toolbar.css';

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
    return (
        <div className="toolbar">
            <div className="toolbar-content">
                <div className="toolbar-left flex items-center gap-md">
                    {/* 뷰 전환 버튼 */}
                    <div className="view-toggle">
                        <button
                            className={viewMode === 'table' ? 'active' : ''}
                            onClick={() => onViewModeChange('table')}
                            title="표 뷰"
                        >
                            📋 표
                        </button>
                        <button
                            className={viewMode === 'split' ? 'active' : ''}
                            onClick={() => onViewModeChange('split')}
                            title="분할 뷰"
                        >
                            📊 분할
                        </button>
                        <button
                            className={viewMode === 'timeline' ? 'active' : ''}
                            onClick={() => onViewModeChange('timeline')}
                            title="타임라인 뷰"
                        >
                            📈 타임라인
                        </button>
                    </div>

                    {/* 타임스케일 및 컨트롤 (타임라인/분할 뷰일 때만 표시) */}
                    {(viewMode === 'timeline' || viewMode === 'split') && (
                        <>
                            <div className="divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--color-border)', margin: '0 8px' }}></div>

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

                            <div className="divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--color-border)', margin: '0 8px' }}></div>

                            {/* 타임라인 컨트롤 */}
                            <div className="timeline-controls-group">
                                <button
                                    className={`icon-btn ${showTaskNames ? 'active' : ''}`}
                                    onClick={onToggleTaskNames}
                                    title={showTaskNames ? '작업명 숨기기' : '작업명 표시'}
                                >
                                    📄 작업명
                                </button>

                                <button
                                    className={`icon-btn ${showBarLabels ? 'active' : ''}`}
                                    onClick={onToggleBarLabels}
                                    title={showBarLabels ? '바 이름 숨기기' : '바 이름 표시'}
                                >
                                    🏷️ 이름
                                </button>

                                <button
                                    className={`icon-btn ${showBarDates ? 'active' : ''}`}
                                    onClick={onToggleBarDates}
                                    title={showBarDates ? '바 날짜 숨기기' : '바 날짜 표시'}
                                >
                                    📅 날짜
                                </button>

                                <button
                                    className={`icon-btn ${showToday ? 'active' : ''}`}
                                    onClick={onToggleToday}
                                    title={showToday ? '오늘 날짜 숨기기' : '오늘 날짜 표시'}
                                >
                                    📅 오늘
                                </button>

                                <button
                                    className={`icon-btn ${isCompact ? 'active' : ''}`}
                                    onClick={onToggleCompact}
                                    title={isCompact ? '일반 모드로 전환' : '컴팩트 모드로 전환'}
                                >
                                    {isCompact ? '↕️ 넓게' : '↕️ 좁게'}
                                </button>

                                <div className="zoom-controls" style={{ display: 'flex', gap: '2px', alignItems: 'center', marginLeft: '4px' }}>
                                    <button
                                        className="icon-btn"
                                        onClick={onZoomOut}
                                        title="축소"
                                        style={{ width: '32px', padding: '0' }}
                                    >
                                        ➖
                                    </button>
                                    <button
                                        className="icon-btn"
                                        onClick={onZoomIn}
                                        title="확대"
                                        style={{ width: '32px', padding: '0' }}
                                    >
                                        ➕
                                    </button>
                                </div>

                                <button
                                    className={`icon-btn ${snapEnabled ? 'active' : ''}`}
                                    onClick={onToggleSnap}
                                    title={snapEnabled ? '스냅 끄기' : '스냅 켜기'}
                                >
                                    🧲
                                </button>
                                <button
                                    className="icon-btn"
                                    onClick={onCopyImage}
                                    title="이미지로 복사"
                                    style={{ marginLeft: '4px' }}
                                >
                                    📷
                                </button>
                                <button
                                    className="icon-btn"
                                    onClick={onHtmlExport}
                                    title="HTML 코드 복사하기 (클립보드)"
                                >
                                    🌐
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="toolbar-right flex items-center gap-md">
                    {/* 테마 선택 */}
                    <div className="theme-toggle" title="차트 스타일 선택">
                        {THEMES.map(t => (
                            <button
                                key={t.id}
                                className={chartTheme === t.id ? 'active' : ''}
                                onClick={() => onThemeChange(t.id)}
                                title={t.label}
                            >
                                {t.icon} {t.shortLabel}
                            </button>
                        ))}
                    </div>

                    <div className="divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--color-border)', margin: '0 8px' }}></div>

                    {/* 검색 */}
                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="🔍 작업 검색..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>

                    {/* 새 작업 추가 */}
                    <button
                        className="primary"
                        onClick={onAddTask}
                        title="새 작업 추가 (Ctrl+N)"
                    >
                        ➕ 새 작업
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Toolbar;
