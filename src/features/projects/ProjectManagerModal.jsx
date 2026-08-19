import { useState, useEffect, useMemo } from 'react';
import { FolderCog, Folder, History, Plus, Pencil, Trash2, Download, Save, RotateCcw, Check } from 'lucide-react';
import { storage } from '../../utils/storage';
import Modal from '../../shared/ui/Modal';
import './ProjectManagerModal.css';

// 프로젝트와 버전(스냅샷)을 한 곳에서 관리한다.
//
// 왜 합쳤나: 예전 저장/불러오기 모달은 스냅샷을 **"프로젝트"** 라고 불렀다("'X' 프로젝트를
// 현재 상태로 덮어쓰시겠습니까?"). 그런데 헤더에는 진짜 프로젝트를 만드는 `+ 새 프로젝트`
// 가 따로 있어서, 화면에 같은 이름의 서로 다른 개념이 둘 있었다 — 하나는 **독립된 저장소**,
// 다른 하나는 **현재 프로젝트의 시점 사본**이다. 이름이 같으면 "불러오기"가 지금 트리를
// 갈아치우는 동작이라는 것도 읽히지 않는다.
//
// 그래서 한 모달의 두 탭으로 세우고, 위계를 문장으로 못박았다: 프로젝트 안에 버전이 있다.
// 버전 탭은 항상 **활성 프로젝트 이름을 제목에 달고**, 스냅샷은 그 프로젝트에만 속한다
// (저장 경로 자체가 프로젝트별이다).
//
// 확인 창은 `window.confirm` 대신 행 안에서 받는다. 브라우저 확인창은 모달의 포커스 가두기
// 밖에서 뜨고, 무엇을 지우는지 다시 보여 주지 않으며, 테스트에서는 dialog 핸들러를 달아야만
// 넘어간다 — 셋 다 "무엇을 지우는지 보이는 채로 한 번 더 묻는다"는 목적에 어긋난다.

const TABS = [
    { id: 'projects', label: '프로젝트', icon: Folder },
    { id: 'versions', label: '버전', icon: History },
];

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');
const countTasks = (list) => (Array.isArray(list) ? list.length : 0);

function ProjectManagerModal({
    isOpen, onClose, initialTab = 'projects',
    projects = [], activeProjectId,
    onSwitchProject, onCreateProject, onRenameProject, onDeleteProject, onRefreshProjects,
    currentData, onLoadSnapshot, onExportSnapshot, toast,
}) {
    const [tab, setTab] = useState(initialTab);
    const [snapshots, setSnapshots] = useState([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [saveName, setSaveName] = useState('');
    // 확인 대기 중인 파괴적 동작 하나 — `{ kind: 'project'|'snapshot'|'restore'|'overwrite', id }`
    const [pending, setPending] = useState(null);

    const activeProject = useMemo(
        () => projects.find(p => p.id === activeProjectId),
        [projects, activeProjectId]
    );

    useEffect(() => {
        if (!isOpen) return;
        setTab(initialTab);
        setPending(null);
        setEditingId(null);
        setNewProjectName('');
        setSaveName(`백업 ${new Date().toLocaleString()}`);
        onRefreshProjects?.();
        refreshSnapshots();
    }, [isOpen, initialTab]);

    const refreshSnapshots = async () => {
        setSnapshots((await storage.loadSnapshots()) || []);
    };

    // ── 프로젝트 ──────────────────────────────────────────
    const submitCreate = () => {
        const name = newProjectName.trim();
        if (!name) return;
        onCreateProject(name);
        setNewProjectName('');
    };

    const submitRename = (pid) => {
        const name = editName.trim();
        if (name) onRenameProject(pid, name);
        setEditingId(null);
    };

    const doDeleteProject = (pid) => {
        onDeleteProject(pid);
        setPending(null);
    };

    // ── 버전(스냅샷) ──────────────────────────────────────
    const handleSave = async () => {
        const name = saveName.trim();
        if (!name) {
            toast.warn('버전 이름을 입력해 주세요.');
            return;
        }
        const existing = snapshots.find(s => s.name === name);
        // 같은 이름이 있으면 새로 만들지 않고 그 버전을 덮어쓸지 묻는다 — 같은 이름의
        // 버전이 둘이면 어느 쪽이 최신인지 목록에서 읽을 수 없다.
        if (existing) {
            setPending({ kind: 'overwrite', id: existing.id });
            return;
        }
        const ok = await storage.saveSnapshot(name, currentData);
        if (!ok) {
            toast.error('버전 저장에 실패했습니다 (용량 부족 등).');
            return;
        }
        await refreshSnapshots();
        setSaveName(`백업 ${new Date().toLocaleString()}`);
        toast.success('현재 상태를 새 버전으로 저장했습니다.');
    };

    const doOverwrite = async (id) => {
        setPending(null);
        const ok = await storage.updateSnapshot(id, currentData);
        if (!ok) {
            toast.error('덮어쓰기에 실패했습니다.');
            return;
        }
        await refreshSnapshots();
        toast.success('버전을 현재 상태로 덮어썼습니다.');
    };

    const doDeleteSnapshot = async (id) => {
        setPending(null);
        await storage.deleteSnapshot(id);
        await refreshSnapshots();
    };

    const doRestore = (snap) => {
        setPending(null);
        onLoadSnapshot(snap.data);
        onClose();
    };

    const isPending = (kind, id) => pending?.kind === kind && pending?.id === id;

    // 확인 줄 — 무엇을 되돌릴 수 없는지 한 문장으로 말하고 그 자리에서 받는다
    const confirmRow = (message, confirmLabel, onConfirm, danger = true) => (
        <div className="pm-confirm" data-testid="pm-confirm">
            <span className="pm-confirm-text">{message}</span>
            <button
                className={danger ? 'danger-button' : 'primary-button'}
                data-testid="pm-confirm-yes"
                onClick={onConfirm}
            >{confirmLabel}</button>
            <button className="secondary-button" onClick={() => setPending(null)}>취소</button>
        </div>
    );

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><FolderCog size={17} aria-hidden="true" /> 프로젝트 관리</>}
            width="680px"
            footer={<button className="secondary-button" onClick={onClose}>닫기</button>}
        >
            <div className="pm-tabs" role="tablist">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        className={`pm-tab ${tab === id ? 'is-active' : ''}`}
                        data-testid={`pm-tab-${id}`}
                        onClick={() => { setTab(id); setPending(null); }}
                    >
                        <Icon size={15} aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'projects' && (
                <div className="pm-panel" data-testid="pm-panel-projects">
                    <p className="pm-hint">
                        프로젝트는 각각 독립된 일정 데이터를 갖는다. 전환하면 저장 중인 변경은 먼저 저장된다.
                    </p>

                    <div className="pm-list" data-testid="pm-project-list">
                        {projects.map(project => {
                            const isActive = project.id === activeProjectId;
                            return (
                                <div
                                    key={project.id}
                                    className={`pm-row ${isActive ? 'is-active' : ''}`}
                                    data-testid="pm-project-row"
                                >
                                    <div className="pm-row-main">
                                        {editingId === project.id ? (
                                            <input
                                                className="pm-input"
                                                data-testid="pm-project-rename-input"
                                                value={editName}
                                                autoFocus
                                                onChange={(e) => setEditName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') submitRename(project.id);
                                                    if (e.key === 'Escape') setEditingId(null);
                                                }}
                                                onBlur={() => submitRename(project.id)}
                                            />
                                        ) : (
                                            <>
                                                <span className="pm-row-name">
                                                    {isActive && <Check size={14} aria-hidden="true" className="pm-active-check" />}
                                                    {project.name}
                                                </span>
                                                <span className="pm-row-meta">
                                                    {isActive && <span className="pm-badge">현재</span>}
                                                    마지막 변경 {formatDate(project.updatedAt)}
                                                </span>
                                            </>
                                        )}
                                    </div>

                                    {isPending('project', project.id) ? confirmRow(
                                        `'${project.name}' 과 그 안의 모든 작업을 삭제한다. 되돌릴 수 없다.`,
                                        '삭제',
                                        () => doDeleteProject(project.id)
                                    ) : (
                                        <div className="pm-row-actions">
                                            <button
                                                className="secondary-button"
                                                disabled={isActive}
                                                title={isActive ? '이미 열려 있는 프로젝트' : '이 프로젝트 열기'}
                                                onClick={() => { onSwitchProject(project.id); onClose(); }}
                                            >열기</button>
                                            <button
                                                className="icon-button"
                                                title="이름 변경"
                                                onClick={() => { setEditingId(project.id); setEditName(project.name); }}
                                            ><Pencil size={14} aria-hidden="true" /></button>
                                            <button
                                                className="icon-button danger"
                                                title={projects.length === 1 ? '마지막 프로젝트는 삭제할 수 없다' : '삭제'}
                                                disabled={projects.length === 1}
                                                onClick={() => setPending({ kind: 'project', id: project.id })}
                                            ><Trash2 size={14} aria-hidden="true" /></button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="pm-create">
                        <input
                            className="pm-input"
                            data-testid="pm-new-project-input"
                            placeholder="새 프로젝트 이름"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                        />
                        <button className="primary-button" onClick={submitCreate} disabled={!newProjectName.trim()}>
                            <Plus size={14} aria-hidden="true" /> 만들기
                        </button>
                    </div>
                </div>
            )}

            {tab === 'versions' && (
                <div className="pm-panel" data-testid="pm-panel-versions">
                    <p className="pm-hint">
                        버전은 <strong>{activeProject?.name ?? '현재 프로젝트'}</strong> 의 시점 사본이다.
                        복원하면 지금 화면의 내용을 그 시점으로 되돌린다 — 다른 프로젝트는 건드리지 않는다.
                    </p>

                    <div className="pm-create">
                        <input
                            className="pm-input"
                            data-testid="pm-version-name-input"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            placeholder="버전 이름"
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                        <button className="primary-button" onClick={handleSave}>
                            <Save size={14} aria-hidden="true" /> 현재 상태 저장
                        </button>
                    </div>

                    <div className="pm-list" data-testid="pm-version-list">
                        {snapshots.length === 0 ? (
                            <div className="pm-empty">저장된 버전이 없습니다.</div>
                        ) : snapshots.map(snap => (
                            <div key={snap.id} className="pm-row" data-testid="pm-version-row">
                                <div className="pm-row-main">
                                    <span className="pm-row-name">{snap.name}</span>
                                    <span className="pm-row-meta">
                                        {formatDate(snap.date)} · 최상위 작업 {countTasks(snap.data)}개
                                    </span>
                                </div>

                                {isPending('restore', snap.id) ? confirmRow(
                                    `'${snap.name}' 시점으로 되돌린다. 저장하지 않은 지금 변경은 사라진다.`,
                                    '복원',
                                    () => doRestore(snap),
                                    false
                                ) : isPending('overwrite', snap.id) ? confirmRow(
                                    `'${snap.name}' 의 내용을 현재 상태로 덮어쓴다. 이전 내용은 사라진다.`,
                                    '덮어쓰기',
                                    () => doOverwrite(snap.id)
                                ) : isPending('snapshot', snap.id) ? confirmRow(
                                    `'${snap.name}' 버전을 삭제한다. 되돌릴 수 없다.`,
                                    '삭제',
                                    () => doDeleteSnapshot(snap.id)
                                ) : (
                                    <div className="pm-row-actions">
                                        <button
                                            className="secondary-button"
                                            onClick={() => setPending({ kind: 'restore', id: snap.id })}
                                        ><RotateCcw size={13} aria-hidden="true" /> 복원</button>
                                        <button
                                            className="icon-button"
                                            title="현재 상태로 덮어쓰기"
                                            onClick={() => setPending({ kind: 'overwrite', id: snap.id })}
                                        ><Save size={14} aria-hidden="true" /></button>
                                        <button
                                            className="icon-button"
                                            title="파일로 내보내기"
                                            onClick={() => onExportSnapshot(snap)}
                                        ><Download size={14} aria-hidden="true" /></button>
                                        <button
                                            className="icon-button danger"
                                            title="삭제"
                                            onClick={() => setPending({ kind: 'snapshot', id: snap.id })}
                                        ><Trash2 size={14} aria-hidden="true" /></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Modal>
    );
}

export default ProjectManagerModal;
