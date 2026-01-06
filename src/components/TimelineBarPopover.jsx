import { useEffect, useRef } from 'react';
import './TimelineBarPopover.css';

function TimelineBarPopover({ position, task, onClose, onUpdate, onDelete }) {
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

    const colors = [
        '#3498db', // Blue
        '#e74c3c', // Red
        '#2ecc71', // Green
        '#f1c40f', // Yellow
        '#9b59b6', // Purple
        '#e67e22', // Orange
        '#95a5a6', // Gray
        '#34495e'  // Dark Blue
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
                </div>
            </div>

            <div className="popover-section">
                <div className="section-title">진행률: {task.progress}%</div>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={task.progress}
                    onChange={(e) => onUpdate(task.id, { progress: parseInt(e.target.value) })}
                    className="progress-slider"
                />
            </div>

            <div className="popover-actions">
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
