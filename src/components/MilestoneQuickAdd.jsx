import { useState, useEffect, useRef } from 'react';
import { dateUtils } from '../utils/dateUtils';
import './MilestoneQuickAdd.css';

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
                <div className="dialog-header">
                    <h3>마일스톤 추가</h3>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>날짜</label>
                        <input
                            type="date"
                            value={milestoneDate}
                            onChange={(e) => setMilestoneDate(e.target.value)}
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
                            placeholder="마일스톤 이름"
                            required
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>모양</label>
                            <select value={shape} onChange={(e) => setShape(e.target.value)}>
                                <option value="diamond">마름모 (◆)</option>
                                <option value="circle">원 (●)</option>
                                <option value="triangle">삼각형 (▲)</option>
                                <option value="square">사각형 (■)</option>
                                <option value="star">별 (★)</option>
                                <option value="flag">깃발 (⚑)</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>색상</label>
                            <div className="color-picker-wrapper">
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                />
                                <span className="color-preview" style={{ backgroundColor: color }}></span>
                            </div>
                        </div>
                    </div>
                    <div className="dialog-actions">
                        <button type="button" className="cancel-btn" onClick={onClose}>취소</button>
                        <button type="submit" className="submit-btn">추가</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default MilestoneQuickAdd;
