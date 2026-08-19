import { ChartNoAxesGantt, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { projectColor, projectInitial } from './projectRail';
import './ProjectRail.css';

// 좌측 프로젝트 레일 — "지금 어느 프로젝트에 있고, 또 무엇이 있는가"를 상시로 보여 준다.
//
// 예전에는 프로젝트가 헤더의 드롭다운 **안에만** 있었다. 열기 전에는 목록이 몇 개인지도,
// 다른 것이 있다는 사실조차 보이지 않아서 화면에 계층이 없었다(실사 §5.4-11). 레일이
// 목록을 항상 들고 있으므로 전환은 클릭 하나가 되고, 헤더는 "이 프로젝트의 무엇"을
// 말하는 컨텍스트 바로 남는다.
//
// 목록 갱신은 여기 두지 않는다 — 드롭다운은 "열 때" 다시 읽으면 됐지만 상시로 떠 있는
// 레일에는 그 순간이 없다. useProjectSync 의 리비전 폴링이 목록도 함께 읽는다.
//
// 만들기·이름 변경·삭제는 여기 두지 않는다 — 프로젝트 관리 모달이 그 자리다. `+` 는
// 그 모달의 프로젝트 탭을 열 뿐이고, 입력란은 앱을 통틀어 하나다.
function ProjectRail({
    projects = [],
    activeProjectId,
    expanded,
    onToggleExpanded,
    onSwitch,
    onCreate,
}) {
    return (
        <nav
            className={`project-rail ${expanded ? 'is-expanded' : ''}`}
            data-testid="project-rail"
            aria-label="프로젝트"
        >
            <div className="rail-brand" title="프로젝트 타임라인 관리">
                <ChartNoAxesGantt size={20} aria-hidden="true" />
                <span className="rail-label">프로젝트 타임라인 관리</span>
            </div>

            <div className="rail-projects" data-testid="rail-project-list">
                {projects.map(project => (
                    <button
                        key={project.id}
                        type="button"
                        className={`rail-project ${project.id === activeProjectId ? 'is-active' : ''}`}
                        data-testid="rail-project"
                        data-project-id={project.id}
                        title={project.name}
                        aria-current={project.id === activeProjectId ? 'true' : undefined}
                        onClick={() => project.id !== activeProjectId && onSwitch(project.id)}
                    >
                        <span
                            className="rail-badge"
                            style={{ backgroundColor: projectColor(project.id) }}
                            aria-hidden="true"
                        >
                            {projectInitial(project.name)}
                        </span>
                        <span className="rail-label">{project.name}</span>
                    </button>
                ))}
            </div>

            <div className="rail-footer">
                <button
                    type="button"
                    className="rail-action"
                    data-testid="rail-new-project"
                    title="새 프로젝트"
                    onClick={onCreate}
                >
                    <Plus size={16} aria-hidden="true" />
                    <span className="rail-label">새 프로젝트</span>
                </button>
                <button
                    type="button"
                    className="rail-action"
                    data-testid="rail-toggle"
                    title={expanded ? '레일 접기' : '레일 펴기'}
                    aria-expanded={expanded}
                    onClick={onToggleExpanded}
                >
                    {expanded
                        ? <PanelLeftClose size={16} aria-hidden="true" />
                        : <PanelLeftOpen size={16} aria-hidden="true" />}
                    <span className="rail-label">접기</span>
                </button>
            </div>
        </nav>
    );
}

export default ProjectRail;
