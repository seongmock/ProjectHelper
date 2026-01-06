import { useState } from 'react';
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
    onAddTask
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(task.name);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showMilestoneModal, setShowMilestoneModal] = useState(false);

    const isSelected = task.id === selectedTaskId;
    const hasChildren = task.children && task.children.length > 0;

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
        if (e.key === 'Enter') {
            handleNameBlur();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditedName(task.name);
        }
    };

    // 날짜 변경
    const handleDateChange = (field, value) => {
        onUpdateTask(task.id, { [field]: value });
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
            date: task.startDate,
            label: '새 마일스톤',
            color: '#5CB85C'
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
                        />
                    ) : (
                        <span
                            className="task-name"
                            onDoubleClick={handleNameDoubleClick}
                            title="더블클릭하여 편집"
                        >
                            {task.name}
                        </span>
                    )}
                </div>

                {/* 시작일 */}
                <div className="col-dates">
                    <input
                        type="date"
                        value={task.startDate}
                        onChange={(e) => handleDateChange('startDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>

                {/* 종료일 */}
                <div className="col-dates">
                    <input
                        type="date"
                        value={task.endDate}
                        onChange={(e) => handleDateChange('endDate', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
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
                        🏁 {task.milestones?.length || 0}
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
                                currentColor={task.color}
                                onColorChange={handleColorChange}
                                onClose={() => setShowColorPicker(false)}
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
                onClose={() => setShowMilestoneModal(false)}
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
                                    <input
                                        type="color"
                                        value={milestone.color}
                                        onChange={(e) => handleUpdateMilestone(milestone.id, 'color', e.target.value)}
                                        className="milestone-color-input"
                                    />
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
            {hasChildren && task.expanded && (
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
                        />
                    ))}
                </>
            )}
        </>
    );
}

export default TaskRow;
