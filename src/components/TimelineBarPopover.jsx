import { useEffect, useRef } from 'react';
import './TimelineBarPopover.css';

function TimelineBarPopover({ position, task, onClose, onUpdate, onDelete, onAddMilestone }) {
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
