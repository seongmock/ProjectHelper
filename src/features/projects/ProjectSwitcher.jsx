import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Folder, ChevronDown, Check, Plus, Settings2 } from 'lucide-react';
import { useAnchoredMenu } from '../../shared/ui/useAnchoredMenu';
import './ProjectSwitcher.css';

const MENU_FALLBACK = { width: 260, height: 280 };

// 프로젝트 전환 드롭다운 — Header 좌측에 배치
// 목록 갱신은 열 때마다 onOpen(refetch) — AI가 REST로 만든 프로젝트도 열면 보인다
//
// **여기는 전환하는 곳이지 관리하는 곳이 아니다.** 이름 변경과 삭제는 프로젝트 관리
// 모달로 옮겼다. 되돌릴 수 없는 삭제가 hover 로만 드러나는 아이콘 뒤에 있었고, 확인은
// 브라우저 confirm 이라 "무엇을 지우는지"가 화면에서 사라진 채로 물었다. 자주 하는 일
// (전환·생성)만 남기고, 나머지는 `프로젝트 관리…` 한 줄로 넘긴다.
function ProjectSwitcher({
    projects,
    activeProjectId,
    onSwitch,
    onCreate,
    onOpen,
    onManage,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    // 이 메뉴는 **body 로 포털한다.** `.header` 는 position: sticky + z-index: 100 이라
    // 쌓임 문맥을 만들고, 그 안에서는 자식의 z-index 를 500 으로 올려도 100 으로만
    // 비교된다 — 그래서 뒤에 오는 타임라인 요소(마일스톤 z 200 등) 위에 그려지려면
    // 문맥 자체를 벗어나야 한다. 좌표·뒤집기·최대 높이는 공용 훅이 계산한다.
    const anchor = useAnchoredMenu(isOpen, triggerRef, menuRef, MENU_FALLBACK);

    const activeProject = projects.find(p => p.id === activeProjectId);

    // 바깥 클릭 / Escape로 닫기 (인라인 편집 중 Escape는 편집만 취소)
    useEffect(() => {
        if (!isOpen) return;
        const handleMouseDown = (e) => {
            const inRoot = rootRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);
            if (!inRoot && !inMenu) {
                setIsOpen(false);
                setCreating(false);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key !== 'Escape') return;
            if (creating) setCreating(false);
            else setIsOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, creating]);

    const toggleOpen = () => {
        const next = !isOpen;
        setIsOpen(next);
        if (next) onOpen?.(); // 열 때 목록 갱신
    };

    const submitCreate = () => {
        const name = newName.trim();
        if (!name) return;
        onCreate(name);
        setNewName('');
        setCreating(false);
        setIsOpen(false);
    };

    return (
        <div className="project-switcher" ref={rootRef}>
            <button
                ref={triggerRef}
                className="project-switcher-trigger"
                data-testid="project-switcher"
                onClick={toggleOpen}
                title="프로젝트 전환"
            >
                <Folder size={15} aria-hidden="true" />
                <span className="project-switcher-name">{activeProject?.name ?? '...'}</span>
                <ChevronDown size={14} aria-hidden="true" />
            </button>

            {isOpen && createPortal(
                <div
                    className="project-switcher-menu"
                    role="menu"
                    ref={menuRef}
                    style={{
                        top: anchor?.top ?? 0,
                        left: anchor?.left ?? 0,
                        maxHeight: anchor?.maxHeight,
                        visibility: anchor ? 'visible' : 'hidden',
                    }}
                >
                    {projects.map(project => (
                        <div
                            key={project.id}
                            className={`project-switcher-item ${project.id === activeProjectId ? 'active' : ''}`}
                        >
                            <span
                                className="project-switcher-item-name"
                                onClick={() => {
                                    setIsOpen(false);
                                    onSwitch(project.id);
                                }}
                            >
                                <span className="project-switcher-check">
                                    {project.id === activeProjectId && <Check size={14} aria-hidden="true" />}
                                </span>
                                {project.name}
                            </span>
                        </div>
                    ))}

                    <div className="project-switcher-footer">
                        {creating ? (
                            <input
                                className="project-switcher-input"
                                placeholder="프로젝트 이름"
                                value={newName}
                                autoFocus
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                            />
                        ) : (
                            <button className="project-switcher-add" onClick={() => setCreating(true)}>
                                <Plus size={14} aria-hidden="true" />
                                <span>새 프로젝트</span>
                            </button>
                        )}
                        <button
                            className="project-switcher-manage"
                            data-testid="project-switcher-manage"
                            onClick={() => {
                                setIsOpen(false);
                                onManage?.();
                            }}
                        >
                            <Settings2 size={14} aria-hidden="true" />
                            <span>프로젝트 관리…</span>
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default ProjectSwitcher;
