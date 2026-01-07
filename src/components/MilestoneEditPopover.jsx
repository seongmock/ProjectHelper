import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import './MilestoneEditPopover.css';

function MilestoneEditPopover({ position, milestone, onClose, onUpdate, onDelete }) {
    const popoverRef = useRef(null);
    const [labelText, setLabelText] = useState(milestone.label || '');
    const [adjustedPos, setAdjustedPos] = useState(position);

    useLayoutEffect(() => {
        if (popoverRef.current) {
            const rect = popoverRef.current.getBoundingClientRect();
            let { x, y } = position;

            // 화면 오른쪽을 벗어나는 경우
            if (x + rect.width > window.innerWidth) {
                x = window.innerWidth - rect.width - 20; // 20px 여유
            }

            // 화면 아래쪽을 벗어나는 경우
            if (y + rect.height > window.innerHeight) {
                y = window.innerHeight - rect.height - 20; // 20px 여유
            }

            // 화면 왼쪽을 벗어나는 경우
            if (x < 20) {
                x = 20;
            }

            // 화면 위쪽을 벗어나는 경우
            if (y < 20) {
                y = 20;
            }

            setAdjustedPos({ x, y });
        }
    }, [position]);

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

    const handleLabelChange = (e) => {
        setLabelText(e.target.value);
    };

    const handleLabelBlur = () => {
        if (labelText !== milestone.label) {
            onUpdate(milestone.id, { label: labelText });
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.target.blur();
        }
    };

    const shapes = [
        { id: 'diamond', label: '◆' },
        { id: 'circle', label: '●' },
        { id: 'square', label: '■' },
        { id: 'triangle', label: '▲' },
        { id: 'star', label: '★' },
        { id: 'flag', label: '⚑' },
    ];

    const colors = [
        '#4A90E2', // Blue
        '#5CB85C', // Green
        '#7B68EE', // Purple
        '#F0AD4E', // Orange/Yellow
        '#9B59B6', // Violet
        '#D9534F', // Red
        '#E67E22', // Dark Orange
        '#34495e', // Dark Blue
    ];

    const positions = [
        { id: 'bottom', label: '하단' },
        { id: 'top', label: '상단' },
        { id: 'right', label: '우측' },
    ];

    return (
        <div
            className="milestone-popover"
            style={{ top: adjustedPos.y, left: adjustedPos.x }}
            ref={popoverRef}
        >
            <div className="popover-header">
                <span className="popover-title">마일스톤 설정</span>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="popover-content">
                {/* 레이블 편집 */}
                <div className="form-group">
                    <label>레이블</label>
                    <input
                        type="text"
                        value={labelText}
                        onChange={handleLabelChange}
                        onBlur={handleLabelBlur}
                        onKeyDown={handleKeyDown}
                        placeholder="마일스톤 이름"
                        autoFocus
                    />
                </div>

                {/* 날짜 편집 */}
                <div className="form-group">
                    <label>날짜</label>
                    <input
                        type="date"
                        value={milestone.date}
                        onChange={(e) => onUpdate(milestone.id, { date: e.target.value })}
                    />
                </div>

                {/* 모양 선택 */}
                <div className="popover-section">
                    <div className="section-title">모양</div>
                    <div className="shape-grid">
                        {shapes.map(shape => (
                            <button
                                key={shape.id}
                                className={`shape-option ${milestone.shape === shape.id ? 'selected' : ''}`}
                                onClick={() => onUpdate(milestone.id, { shape: shape.id })}
                                title={shape.id}
                            >
                                {shape.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 색상 선택 */}
                <div className="popover-section">
                    <div className="section-title">색상</div>
                    <div className="color-grid">
                        {colors.map(color => (
                            <div
                                key={color}
                                className={`color-option ${milestone.color === color ? 'selected' : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => onUpdate(milestone.id, { color })}
                            />
                        ))}
                        <label className="color-option custom-color-picker" title="사용자 지정 색상">
                            <input
                                type="color"
                                value={milestone.color}
                                onChange={(e) => onUpdate(milestone.id, { color: e.target.value })}
                            />
                            <span className="plus-icon">+</span>
                        </label>
                    </div>
                </div>

                {/* 레이블 위치 */}
                <div className="popover-section">
                    <div className="section-title">레이블 위치</div>
                    <div className="position-grid">
                        {positions.map(pos => (
                            <button
                                key={pos.id}
                                className={`position-option ${milestone.labelPosition === pos.id ? 'selected' : ''}`}
                                onClick={() => onUpdate(milestone.id, { labelPosition: pos.id })}
                            >
                                {pos.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="popover-footer">
                <button
                    className="action-btn delete"
                    onClick={() => {
                        if (window.confirm('정말 이 마일스톤을 삭제하시겠습니까?')) {
                            onDelete(milestone.id);
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

export default MilestoneEditPopover;
