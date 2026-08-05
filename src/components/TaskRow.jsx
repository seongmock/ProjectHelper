import { useState } from 'react';
import { generateId, formatDate } from '../utils/dataModel';
import { recalcTaskBoundsSafe, isTaskOverdue } from '../utils/taskTree';
import ColorPicker from './ColorPicker';
import Modal from './Modal';
import './TaskRow.css';

function TaskRow({
    task,
    level = 0,
    selectedTaskId,
    onSelectTask,
    onUpdateTask,
    onDeleteTask,
    onAddTask,
    onIndentTask,
    onOutdentTask,
    renderChildren = true
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(task.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showMilestoneModal, setShowMilestoneModal] = useState(false);
    const [editingMilestoneColor, setEditingMilestoneColor] = useState(null);

    const isSelected = task.id === selectedTaskId;
    const hasChildren = task.children && task.children.length > 0;

    // 날짜의 원본은 timeRanges — 표에서는 시간순 첫 번째 기간을 편집한다
    const firstRange = (task.timeRanges && task.timeRanges.length > 0)
        ? [...task.timeRanges].sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0]
        : null;
    const extraRangeCount = (task.timeRanges?.length || 0) - 1;
    const overdue = isTaskOverdue(task, formatDate(new Date()));

    // 펼치기/접기
    const handleToggleExpand = (e) => {
        e.stopPropagation();
        onUpdateTask(task.id, { expanded: !task.expanded });
    };

    // 작업명 편집
    const handleNameDoubleClick = () => {
        setIsEditing(true);
        setEditedName(task.name);
    };

    const handleNameChange = (e) => {
        setEditedName(e.target.value);
    };

    const handleNameBlur = () => {
        if (editedName.trim()) {
            onUpdateTask(task.id, { name: editedName.trim() });
        }
        setIsEditing(false);
    };

    const handleNameKeyDown = (e) => {
        // DnD 라이브러리가 스페이스바 등을 가로채지 않도록 이벤트 전파 중단
        e.stopPropagation();

        if (e.key === 'Enter') {
            handleNameBlur();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditedName(task.name);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                onOutdentTask(task.id);
            } else {
                onIndentTask(task.id);
            }
        }
    };

    // 날짜 변경 — 첫 timeRange를 수정하고 전체 시작/종료 캐시 재계산 (타임라인과 동기화)
    const handleDateChange = (field, value) => {
        if (!value) return; // 입력이 비워진 경우 무시
        let ranges;
        if (!firstRange) {
            // 기간이 없는 작업: 선택한 날짜로 1일짜리 기간 생성
            ranges = [{ id: generateId(), startDate: value, endDate: value, dependencies: [], color: null, label: '' }];
        } else {
            ranges = task.timeRanges.map(r =>
                r.id === firstRange.id ? { ...r, [field]: value } : r
            );
        }
        onUpdateTask(task.id, { timeRanges: ranges, ...recalcTaskBoundsSafe(ranges) });
    };

    // 색상 변경
    const handleColorChange = (color) => {
        onUpdateTask(task.id, { color });
        setShowColorPicker(false);
    };

    // 삭제
    const handleDelete = () => {
        if (confirm(`"${task.name}" 작업을 삭제하시겠습니까?`)) {
            onDeleteTask(task.id);
        }
    };

    // 하위 작업 추가
    const handleAddChild = () => {
        onAddTask(task.id);
    };

    // 마일스톤 추가
    const handleAddMilestone = () => {
        const milestones = task.milestones || [];
        const newMilestone = {
            id: `m-${Date.now()}`,
            date: firstRange?.startDate || formatDate(new Date()),
            label: '새 마일스톤',
            color: '#5CB85C',
            shape: 'diamond'
        };
        onUpdateTask(task.id, { milestones: [...milestones, newMilestone] });
    };

    // 마일스톤 삭제
    const handleDeleteMilestone = (milestoneId) => {
        const milestones = task.milestones.filter(m => m.id !== milestoneId);
        onUpdateTask(task.id, { milestones });
    };

    // 마일스톤 수정
    const handleUpdateMilestone = (milestoneId, field, value) => {
        const milestones = task.milestones.map(m =>
            m.id === milestoneId ? { ...m, [field]: value } : m
        );
        onUpdateTask(task.id, { milestones });
    };

    // 마일스톤 색상 변경 (ColorPicker 사용)
    const handleMilestoneColorChange = (milestoneId, color) => {
        handleUpdateMilestone(milestoneId, 'color', color);
        setEditingMilestoneColor(null);
    };

    // 마일스톤 모양 아이콘 렌더링
    const renderMilestoneShape = (shape, color, size = 16) => {
        const shapeStyle = {
            width: `${size}px`,
            height: `${size}px`,
            backgroundColor: color,
            display: 'inline-block',
            marginRight: '4px',
        };

        switch (shape) {
            case 'circle':
                return <span style={{ ...shapeStyle, borderRadius: '50%' }} />;
            case 'triangle':
                return (
                    <span style={{
                        width: 0,
                        height: 0,
                        borderLeft: `${size / 2}px solid transparent`,
                        borderRight: `${size / 2}px solid transparent`,
                        borderBottom: `${size}px solid ${color}`,
                        display: 'inline-block',
                        marginRight: '4px',
                    }} />
                );
            case 'square':
                return <span style={{ ...shapeStyle, borderRadius: '2px' }} />;
            case 'star':
                return <span style={{ color, fontSize: `${size}px`, marginRight: '4px', lineHeight: 1 }}>★</span>;
            case 'flag':
                return <span style={{ color, fontSize: `${size}px`, marginRight: '4px', lineHeight: 1 }}>⚑</span>;
            case 'diamond':
            default:
                return (
                    <span style={{
                        ...shapeStyle,
                        transform: 'rotate(45deg)',
                        marginRight: '8px',
                    }} />
                );
        }
    };

    return (
        <>
            <div
                className={`task-row ${isSelected ? 'selected' : ''} level-${level}`}
                onClick={() => onSelectTask(task.id)}
            >
                {/* 작업명 */}
                <div className="col-name" style={{ paddingLeft: `${level * 24 + 12}px` }}>
                    {hasChildren && (
                        <button
                            className="expand-toggle icon"
                            onClick={handleToggleExpand}
                        >
                            {task.expanded ? '▼' : '▶'}
                        </button>
                    )}
                    {!hasChildren && <span className="expand-spacer"></span>}

                    {isEditing ? (
                        <input
                            type="text"
                            value={editedName}
                            onChange={handleNameChange}
                            onBlur={handleNameBlur}
                            onKeyDown={handleNameKeyDown}
                            autoFocus
                            className="name-input"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span
                            className="task-name"
                            onDoubleClick={handleNameDoubleClick}
                            // 컬럼 폭이 고정이라 긴 작업명은 잘린다. 전체 이름을 툴팁으로 노출한다.
                            title={`${task.name}\n(더블클릭하여 편집)`}
                        >
                            {task.name}
                        </span>
                    )}
                    {overdue && (
                        // 지연을 색으로만 표시하면 색약 사용자가 판별할 수 없다 — 아이콘을 함께 쓴다
                        <span className="overdue-flag" title="지연: 종료일이 지났으나 완료되지 않았습니다" aria-label="지연">
                            ⚠
                        </span>
                    )}
                    {(task.progress ?? 0) > 0 && (
                        <span className="progress-badge" title={`진행률 ${task.progress}%`}>{task.progress}%</span>
                    )}
                </div>

                {/* 시작일 (첫 번째 기간 기준) */}
                <div className="col-dates">
                    <input
                        type="date"
                        value={firstRange?.startDate || ''}
                        onChange={(e) => handleDateChange('startDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>

                {/* 종료일 (첫 번째 기간 기준) — 지연 시 경고색 */}
                <div className={`col-dates ${overdue ? 'overdue' : ''}`}>
                    <input
                        type="date"
                        value={firstRange?.endDate || ''}
                        onChange={(e) => handleDateChange('endDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                    {extraRangeCount > 0 && (
                        <span
                            className="range-count-badge"
                            title={`기간 ${extraRangeCount + 1}개 — 나머지는 타임라인에서 편집`}
                        >
                            +{extraRangeCount}
                        </span>
                    )}
                </div>

                {/* 마일스톤 */}
                <div className="col-milestones">
                    <button
                        className="milestone-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMilestoneModal(true);
                        }}
                        title="마일스톤 관리"
                    >
                        {task.milestones && task.milestones.length > 0 ? (
                            <div className="milestone-preview">
                                {task.milestones.slice(0, 3).map((m) => (
                                    <span key={m.id} className="milestone-shape-preview">
                                        {renderMilestoneShape(m.shape || 'diamond', m.color, 12)}
                                    </span>
                                ))}
                                {task.milestones.length > 3 && <span className="milestone-more">+{task.milestones.length - 3}</span>}
                            </div>
                        ) : (
                            <>🏁 0</>
                        )}
                    </button>
                </div>

                {/* 색상 */}
                <div className="col-color">
                    <div className="color-picker-wrapper">
                        <button
                            className="color-button"
                            style={{ backgroundColor: task.color }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowColorPicker(!showColorPicker);
                            }}
                            title="색상 선택"
                        />
                        {showColorPicker && (
                            <ColorPicker
                                color={task.color}
                                onChange={handleColorChange}
                            />
                        )}
                    </div>
                </div>

                {/* 작업 버튼 */}
                <div className="col-actions">
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOutdentTask(task.id);
                        }}
                        title="내어쓰기 (Shift+Tab)"
                    >
                        ⬅️
                    </button>
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            onIndentTask(task.id);
                        }}
                        title="들여쓰기 (Tab)"
                    >
                        ➡️
                    </button>
                    <button
                        className="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleAddChild();
                        }}
                        title="하위 작업 추가"
                    >
                        ➕
                    </button>
                    <button
                        className="icon danger"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDelete();
                        }}
                        title="삭제 (Delete)"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {/* 마일스톤 모달 */}
            <Modal
                isOpen={showMilestoneModal}
                onClose={() => {
                    setShowMilestoneModal(false);
                    setEditingMilestoneColor(null);
                }}
                title={`마일스톤 관리: ${task.name}`}
            >
                <div className="milestone-manager">
                    {task.milestones && task.milestones.length > 0 ? (
                        <div className="milestone-list">
                            {task.milestones.map((milestone) => (
                                <div key={milestone.id} className="milestone-item">
                                    <input
                                        type="text"
                                        value={milestone.label}
                                        onChange={(e) => handleUpdateMilestone(milestone.id, 'label', e.target.value)}
                                        placeholder="레이블"
                                        className="milestone-label-input"
                                    />
                                    <input
                                        type="date"
                                        value={milestone.date}
                                        onChange={(e) => handleUpdateMilestone(milestone.id, 'date', e.target.value)}
                                        className="milestone-date-input"
                                    />

                                    {/* 색상 선택 (ColorPicker 사용) */}
                                    <div className="milestone-color-wrapper">
                                        <button
                                            className="milestone-color-button"
                                            style={{ backgroundColor: milestone.color }}
                                            onClick={() => setEditingMilestoneColor(
                                                editingMilestoneColor === milestone.id ? null : milestone.id
                                            )}
                                            title="색상 선택"
                                        />
                                        {editingMilestoneColor === milestone.id && (
                                            <div style={{ position: 'absolute', zIndex: 100 }}>
                                                <ColorPicker
                                                    color={milestone.color}
                                                    onChange={(color) => handleMilestoneColorChange(milestone.id, color)}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* 모양 선택 */}
                                    <select
                                        value={milestone.shape || 'diamond'}
                                        onChange={(e) => handleUpdateMilestone(milestone.id, 'shape', e.target.value)}
                                        className="milestone-shape-select"
                                    >
                                        <option value="diamond">◆ 다이아몬드</option>
                                        <option value="circle">● 원형</option>
                                        <option value="triangle">▲ 삼각형</option>
                                        <option value="square">■ 정사각형</option>
                                        <option value="star">★ 별표</option>
                                        <option value="flag">⚑ 깃발</option>
                                    </select>

                                    <button
                                        className="icon danger"
                                        onClick={() => handleDeleteMilestone(milestone.id)}
                                        title="삭제"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="no-milestones">마일스톤이 없습니다.</p>
                    )}
                    <button className="primary" onClick={handleAddMilestone} style={{ marginTop: '12px' }}>
                        ➕ 마일스톤 추가
                    </button>
                </div>
            </Modal>

            {/* 하위 작업들 */}
            {renderChildren && hasChildren && task.expanded && (
                <>
                    {task.children.map((child) => (
                        <TaskRow
                            key={child.id}
                            task={child}
                            level={level + 1}
                            selectedTaskId={selectedTaskId}
                            onSelectTask={onSelectTask}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            onAddTask={onAddTask}
                            onIndentTask={onIndentTask}
                            onOutdentTask={onOutdentTask}
                        />
                    ))}
                </>
            )}
        </>
    );
}

export default TaskRow;
