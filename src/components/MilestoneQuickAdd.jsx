import { useState, useEffect, useRef } from 'react';
import { dateUtils } from '../utils/dateUtils';
import './MilestoneQuickAdd.css';
import ColorPicker from './ColorPicker';

function MilestoneQuickAdd({ task, date, onClose, onAdd }) {
    const [label, setLabel] = useState('새 마일스톤');
    const [milestoneDate, setMilestoneDate] = useState(dateUtils.formatDate(date));
    const [color, setColor] = useState('#FF0000');
    const [shape, setShape] = useState('diamond');
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        onAdd(task.id, {
            date: milestoneDate,
            label,
            color,
            shape
        });
        onClose();
    };

    return (
        <div className="milestone-quick-add-overlay" onClick={onClose}>
            <div className="milestone-quick-add-dialog" onClick={e => e.stopPropagation()}>
                <div className="popover-header">
                    <span className="popover-title">마일스톤 추가</span>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>날짜</label>
                        <input
                            type="date"
                            value={milestoneDate}
                            onChange={(e) => setMilestoneDate(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>이름</label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            placeholder="마일스톤 이름"
                            required
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>모양</label>
                            <select
                                value={shape}
                                onChange={(e) => setShape(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                onKeyUp={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                <option value="diamond">◆</option>
                                <option value="circle">●</option>
                                <option value="triangle">▲</option>
                                <option value="square">■</option>
                                <option value="star">★</option>
                                <option value="flag">⚑</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>색상</label>
                            <div className="color-picker-wrapper">
                                <ColorPicker
                                    color={color}
                                    onChange={setColor}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="popover-actions" style={{ justifyContent: 'flex-end', marginTop: '16px' }}>
                        <button type="button" className="action-btn" onClick={onClose} style={{ backgroundColor: '#f5f5f5', color: '#333' }}>취소</button>
                        <button type="submit" className="action-btn primary">추가</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default MilestoneQuickAdd;
