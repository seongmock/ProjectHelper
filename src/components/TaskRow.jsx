import { useState } from 'react';
import ColorPicker from './ColorPicker';
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
