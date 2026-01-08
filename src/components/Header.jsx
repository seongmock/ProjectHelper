import './Header.css';

function Header({ darkMode, onToggleDarkMode, onExport, onImport, canUndo, canRedo, onUndo, onRedo, onOpenPromptGuide }) {
    const handleImportClick = (isMerge = false) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                onImport(file, isMerge);
            }
        };
        input.click();
    };

    return (
        <header className="header">
            <div className="header-content">
                <div className="header-left">
                    <h1 className="header-title">📊 프로젝트 타임라인 관리</h1>
                </div>

                <div className="header-right flex items-center gap-sm">
                    {/* 실행 취소/다시 실행 및 프롬프트 가이드 */}
                    <div className="undo-redo-buttons flex gap-sm">
                        <button
                            className="icon tooltip"
                            onClick={onOpenPromptGuide}
                            data-tooltip="AI 프롬프트 가이드"
                            title="프롬프트 도우미"
                        >
                            🤖
                        </button>
                        <div className="divider-vertical" style={{ width: '1px', height: '16px', background: 'var(--color-border)', margin: 'auto 4px' }}></div>
                        <button
                            className="icon tooltip"
                            onClick={onUndo}
                            disabled={!canUndo}
                            data-tooltip="실행 취소 (Ctrl+Z)"
                            title="실행 취소"
                        >
                            ↶
                        </button>
                        <button
                            className="icon tooltip"
                            onClick={onRedo}
                            disabled={!canRedo}
                            data-tooltip="다시 실행 (Ctrl+Y)"
                            title="다시 실행"
                        >
                            ↷
                        </button>
                    </div>

                    {/* 가져오기/내보내기 */}
                    <div className="import-export-buttons flex gap-sm">
                        <button
                            className="tooltip"
                            onClick={() => handleImportClick(false)}
                            data-tooltip="JSON 파일 가져오기 (덮어쓰기)"
                            title="가져오기"
                        >
                            📥 가져오기
                        </button>
                        <button
                            className="tooltip"
                            onClick={() => handleImportClick(true)}
                            data-tooltip="JSON 파일 병합하기 (추가)"
                            title="병합"
                        >
                            📥 병합
                        </button>
                        <button
                            className="tooltip"
                            onClick={onExport}
                            data-tooltip="JSON 파일로 내보내기 (Ctrl+S)"
                            title="내보내기"
                        >
                            📤 내보내기
                        </button>
                    </div>

                    {/* 다크모드 토글 */}
                    <button
                        className="icon tooltip"
                        onClick={onToggleDarkMode}
                        data-tooltip={darkMode ? '라이트 모드' : '다크 모드'}
                        title="테마 변경"
                    >
                        {darkMode ? '☀️' : '🌙'}
                    </button>
                </div>
            </div>
        </header>
    );
}

export default Header;
