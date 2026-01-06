import './Toolbar.css';

function Toolbar({
    viewMode,
    onViewModeChange,
    timeScale,
    onTimeScaleChange,
    searchQuery,
    onSearchChange,
    onAddTask
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

                    {/* 타임스케일 전환 */}
                    {(viewMode === 'timeline' || viewMode === 'split') && (
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
                    )}
                </div>

                <div className="toolbar-right flex items-center gap-md">
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
