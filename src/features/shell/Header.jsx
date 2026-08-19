import { Bot, FolderCog, Undo2, Redo2, Upload, Download, Sun, Moon } from 'lucide-react';
import SyncIndicator from '../projects/SyncIndicator';
import './Header.css';

// 헤더는 **컨텍스트 바**다 — "어느 프로젝트인가"는 좌측 레일이 말하고, 여기는 그
// 프로젝트의 이름과 저장 상태, 그리고 문서에 대한 동작(되돌리기·가져오기·내보내기)만
// 말한다. 앱 이름과 프로젝트 목록은 레일로 옮겼다(실사 §5.4-11).
function Header({
    darkMode, onToggleDarkMode, onExport, onImport, canUndo, canRedo, onUndo, onRedo,
    onOpenPromptGuide, onOpenProjectManager, projectName,
    syncState, onRetrySave,
}) {
    return (
        <header className="header">
            <div className="header-content">
                <div className="header-left">
                    {/* 화면의 주제는 앱이 아니라 이 프로젝트다 — h1 은 프로젝트 이름이 갖는다 */}
                    <h1 className="header-title" title={projectName || ''}>{projectName || '\u2026'}</h1>
                    {/* 저장 상태는 "어느 프로젝트의" 상태다 — 프로젝트 이름 옆이 읽는 순서에 맞다 */}
                    {syncState && <SyncIndicator state={syncState} onRetry={onRetrySave} />}
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
                            <Bot size={18} aria-hidden="true" />
                        </button>
                        <button
                            className="icon tooltip"
                            onClick={onOpenProjectManager}
                            data-tooltip="프로젝트·버전 관리"
                            title="프로젝트 관리"
                        >
                            <FolderCog size={18} aria-hidden="true" />
                        </button>

                        <div className="divider-vertical" style={{ width: '1px', height: '16px', background: 'var(--color-border)', margin: 'auto 4px' }}></div>
                        <button
                            className="icon tooltip"
                            onClick={onUndo}
                            disabled={!canUndo}
                            data-tooltip="실행 취소 (Ctrl+Z)"
                            title="실행 취소"
                        >
                            <Undo2 size={18} aria-hidden="true" />
                        </button>
                        <button
                            className="icon tooltip"
                            onClick={onRedo}
                            disabled={!canRedo}
                            data-tooltip="다시 실행 (Ctrl+Y)"
                            title="다시 실행"
                        >
                            <Redo2 size={18} aria-hidden="true" />
                        </button>
                    </div>

                    {/* 가져오기/내보내기 */}
                    <div className="import-export-buttons flex gap-sm">
                        <button
                            className="tooltip"
                            onClick={onImport}
                            data-tooltip="데이터 가져오기 (파일/JSON)"
                            title="가져오기"
                        >
                            <Upload size={15} aria-hidden="true" />
                            <span>가져오기</span>
                        </button>
                        <button
                            className="tooltip"
                            onClick={onExport}
                            data-tooltip="데이터 내보내기 (파일/JSON)"
                            title="내보내기"
                        >
                            <Download size={15} aria-hidden="true" />
                            <span>내보내기</span>
                        </button>
                    </div>



                    {/* 다크모드 토글 */}
                    <button
                        className="icon tooltip"
                        onClick={onToggleDarkMode}
                        data-tooltip={darkMode ? '라이트 모드' : '다크 모드'}
                        title="테마 변경"
                    >
                        {darkMode
                            ? <Sun size={18} aria-hidden="true" />
                            : <Moon size={18} aria-hidden="true" />}
                    </button>
                </div>
            </div>
        </header >
    );
}

export default Header;
