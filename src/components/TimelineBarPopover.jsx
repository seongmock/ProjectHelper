import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import './TimelineBarPopover.css';
import ColorPicker from './ColorPicker';

function TimelineBarPopover({ position, task, successors = [], predecessors = [], onClose, onUpdate, onDelete, onAddMilestone, onStartLinking }) {
    const popoverRef = useRef(null);
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



    return (
        <div
            className="timeline-popover"
            style={{ top: adjustedPos.y, left: adjustedPos.x }}
            ref={popoverRef}
        >
            <div className="popover-header">
                <span className="popover-title">작업 설정</span>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="popover-section">
                <div className="section-title">기간</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>시작일</label>
                        <input
                            type="date"
                            value={task.startDate}
                            onChange={(e) => onUpdate(task.id, { startDate: e.target.value })}
                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>종료일</label>
                        <input
                            type="date"
                            value={task.endDate}
                            onChange={(e) => onUpdate(task.id, { endDate: e.target.value })}
                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}
                        />
                    </div>
                </div>
            </div>

            <div className="popover-section">
                <div className="section-title">색상</div>
                <div className="color-grid">
                    <ColorPicker
                        color={task.color}
                        onChange={(color) => onUpdate(task.id, { color })}
                    />
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

            {/* 구분선 (Divider) 설정 */}
            <div className="popover-section">
                <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>구분선 (Divider)</span>
                    <input
                        type="checkbox"
                        checked={task.divider?.enabled || false}
                        onChange={(e) => onUpdate(task.id, {
                            divider: {
                                ...task.divider,
                                enabled: e.target.checked,
                                style: task.divider?.style || 'solid',
                                color: task.divider?.color || '#000000',
                                thickness: task.divider?.thickness || 2
                            }
                        })}
                    />
                </div>

                {task.divider?.enabled && (
                    <div className="divider-settings" style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>스타일</span>
                            <select
                                value={task.divider?.style || 'solid'}
                                onChange={(e) => onUpdate(task.id, { divider: { ...task.divider, style: e.target.value } })}
                                style={{ padding: '2px 4px', fontSize: '12px', fontFamily: 'monospace' }}
                            >
                                <option value="solid">────── (Solid)</option>
                                <option value="dashed">- - - - - - (Dashed)</option>
                                <option value="dotted">·············· (Dotted)</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>색상</span>
                            <div style={{ width: '100%' }}>
                                <ColorPicker
                                    color={task.divider?.color || '#000000'}
                                    onChange={(color) => onUpdate(task.id, { divider: { ...task.divider, color } })}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>두께 (px)</span>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={task.divider?.thickness || 2}
                                onChange={(e) => onUpdate(task.id, { divider: { ...task.divider, thickness: parseInt(e.target.value) } })}
                                style={{ width: '60px', padding: '2px 4px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>
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
