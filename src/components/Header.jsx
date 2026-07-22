import ProjectSwitcher from './ProjectSwitcher';
import './Header.css';

function Header({
    darkMode, onToggleDarkMode, onExport, onImport, canUndo, canRedo, onUndo, onRedo,
    onOpenPromptGuide, onOpenSnapshots, snapEnabled, onToggleSnap,
    projects, activeProjectId, onSwitchProject, onCreateProject, onRenameProject, onDeleteProject, onOpenProjectList,
}) {
    return (
        <header className="header">
            <div className="header-content">
                <div className="header-left">
                    <h1 className="header-title">📊 프로젝트 타임라인 관리</h1>
                    <ProjectSwitcher
                        projects={projects || []}
                        activeProjectId={activeProjectId}
                        onSwitch={onSwitchProject}
                        onCreate={onCreateProject}
                        onRename={onRenameProject}
                        onDelete={onDeleteProject}
                        onOpen={onOpenProjectList}
                    />
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
                        <button
                            className="icon tooltip"
                            onClick={onOpenSnapshots}
                            data-tooltip="프로젝트 저장/불러오기 목록"
                            title="스냅샷 관리"
                        >
                            💾
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
                            onClick={onImport}
                            data-tooltip="데이터 가져오기 (파일/JSON)"
                            title="가져오기"
                        >
                            📥 가져오기
                        </button>
                        <button
                            className="tooltip"
                            onClick={onExport}
                            data-tooltip="데이터 내보내기 (파일/JSON)"
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
        </header >
    );
}

export default Header;
