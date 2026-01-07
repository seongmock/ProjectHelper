import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import './MilestoneEditPopover.css';
import ColorPicker from './ColorPicker';

function MilestoneEditPopover({ position, milestone, onClose, onUpdate, onDelete, onStartLinking }) {
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

                {/* 모양 및 색상 (한 줄 배치) */}
                <div className="popover-row" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label>모양</label>
                        <select
                            value={milestone.shape}
                            onChange={(e) => onUpdate(milestone.id, { shape: e.target.value })}
                            style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            {shapes.map(shape => (
                                <option key={shape.id} value={shape.id}>{shape.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label>색상</label>
                        <ColorPicker
                            color={milestone.color}
                            onChange={(color) => onUpdate(milestone.id, { color })}
                        />
                    </div>
                </div>

                {/* 레이블 위치 */}
                <div className="form-group">
                    <label>레이블 위치</label>
                    <select
                        value={milestone.labelPosition || 'bottom'}
                        onChange={(e) => onUpdate(milestone.id, { labelPosition: e.target.value })}
                        style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                    >
                        {positions.map(pos => (
                            <option key={pos.id} value={pos.id}>{pos.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="popover-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
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
                <button
                    className="action-btn link"
                    onClick={() => {
                        onStartLinking();
                        onClose();
                    }}
                    title="의존성 연결 시작"
                    style={{ backgroundColor: '#f0f0f0', color: '#333', border: '1px solid #ddd' }}
                >
                    🔗 연결
                </button>
            </div>
        </div>
    );
}

export default MilestoneEditPopover;
