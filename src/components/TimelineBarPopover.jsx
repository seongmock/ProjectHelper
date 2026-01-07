import { useEffect, useRef } from 'react';
import './TimelineBarPopover.css';

function TimelineBarPopover({ position, task, successors = [], predecessors = [], onClose, onUpdate, onDelete, onAddMilestone, onStartLinking }) {
    const popoverRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // 샘플 데이터에서 사용된 색상 팔레트
    const colors = [
        '#4A90E2', // Blue
        '#5CB85C', // Green
        '#7B68EE', // Purple
        '#F0AD4E', // Orange/Yellow
        '#9B59B6', // Violet
        '#D9534F', // Red
        '#E67E22', // Dark Orange
        '#34495e', // Dark Blue (Additional)
    ];

    return (
        <div
            className="timeline-popover"
            style={{ top: position.y, left: position.x }}
            ref={popoverRef}
        >
            <div className="popover-header">
                <span className="popover-title">작업 설정</span>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="popover-section">
                <div className="section-title">색상</div>
                <div className="color-grid">
                    {colors.map(color => (
                        <div
                            key={color}
                            className={`color-option ${task.color === color ? 'selected' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => onUpdate(task.id, { color })}
                        />
                    ))}
                    {/* 커스텀 색상 선택기 */}
                    <label className="color-option custom-color-picker" title="사용자 지정 색상">
                        <input
                            type="color"
                            value={task.color}
                            onChange={(e) => onUpdate(task.id, { color: e.target.value })}
                        />
                        <span className="plus-icon">+</span>
                    </label>
                </div>
            </div>

            {/* 의존성 관리 */}
            <div className="popover-section">
                <div className="section-title">연결 (Dependencies)</div>
                <button
                    className="action-btn secondary full-width"
                    onClick={onStartLinking}
                    style={{ marginBottom: '8px', width: '100%', textAlign: 'center', padding: '4px 8px', fontSize: '12px' }}
                >
                    + 연결 추가 (Link Task)
                </button>

                {/* 선행 작업 (Predecessors) */}
                {predecessors && predecessors.length > 0 && (
                    <div className="dependency-list">
                        <div className="dependency-subtitle" style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>선행 (Predecessors)</div>
                        {predecessors.map(predTask => (
                            <div key={predTask.id} className="dependency-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                                    ← {predTask.name}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F' }}
                                    onClick={() => {
                                        const newDeps = task.dependencies.filter(id => id !== predTask.id);
                                        onUpdate(task.id, { dependencies: newDeps });
                                    }}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 후행 작업 (Successors) */}
                {successors && successors.length > 0 && (
                    <div className="dependency-list" style={{ marginTop: '8px' }}>
                        <div className="dependency-subtitle" style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>후행 (Successors)</div>
                        {successors.map(succTask => (
                            <div key={succTask.id} className="dependency-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                                    → {succTask.name}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F' }}
                                    onClick={() => {
                                        // 후행 작업의 dependencies에서 현재 작업 ID 제거
                                        const newDeps = succTask.dependencies.filter(id => id !== task.id);
                                        onUpdate(succTask.id, { dependencies: newDeps });
                                    }}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="popover-actions" style={{ justifyContent: 'space-between' }}>
                <button
                    className="action-btn primary"
                    onClick={onAddMilestone}
                >
                    마일스톤 추가
                </button>
                <button
                    className="action-btn delete"
                    onClick={() => {
                        if (window.confirm('정말 이 작업을 삭제하시겠습니까?')) {
                            onDelete(task.id);
                            onClose();
                        }
                    }}
                >
                    삭제
                </button>
            </div>
        </div>
    );
}

export default TimelineBarPopover;
