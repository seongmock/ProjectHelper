import { useCallback, useState } from 'react';
import { Wand2, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import { usePopover } from '../../shared/hooks/usePopover';
import './MilestoneEditPopover.css';
import ColorPicker from '../../shared/ui/ColorPicker';

function MilestoneEditPopover({ position, milestone, predecessors = [], successors = [], onClose, onUpdate, onDelete, onStartLinking, onRemoveDependency }) {
    const [labelText, setLabelText] = useState(milestone.label || '');

    // 팝오버가 닫힐 때(바깥 클릭·Escape) 편집 중이던 레이블을 흘리지 않고 저장한다
    const handleDismiss = useCallback(() => {
        if (labelText !== milestone.label) {
            onUpdate(milestone.id, { label: labelText });
        }
        onClose();
    }, [labelText, milestone.id, milestone.label, onUpdate, onClose]);

    const { popoverRef, adjustedPos } = usePopover(position, handleDismiss);

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
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleKeyDown(e);
                            e.stopPropagation();
                        }}
                        onKeyUp={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
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
                        onKeyDown={(e) => e.stopPropagation()}
                        onKeyUp={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    />
                </div>

                {/* 모양 및 색상 (한 줄 배치) */}
                <div className="popover-row" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label>모양</label>
                        <select
                            value={milestone.shape}
                            onChange={(e) => onUpdate(milestone.id, { shape: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                            onKeyUp={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
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
                    <div className="position-buttons" style={{ display: 'flex', gap: '4px' }}>
                        {[
                            { id: 'auto', label: '자동', Icon: Wand2 },
                            { id: 'top', label: '상', Icon: ArrowUp },
                            { id: 'bottom', label: '하', Icon: ArrowDown },
                            { id: 'right', label: '우', Icon: ArrowRight }
                        ].map(pos => (
                            <button
                                key={pos.id}
                                className={`position-btn ${milestone.labelPosition === pos.id || (!milestone.labelPosition && pos.id === 'auto') ? 'active' : ''}`}
                                onClick={() => onUpdate(milestone.id, { labelPosition: pos.id })}
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '3px',
                                    padding: '6px 4px',
                                    fontSize: '11px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <pos.Icon size={12} aria-hidden="true" />
                                {pos.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 의존성 관리 */}
            <div className="popover-section" style={{ marginTop: '16px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
                <div className="section-title" style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>연결 (Dependencies)</div>
                <button
                    className="action-btn secondary full-width"
                    onClick={() => {
                        onStartLinking();
                        onClose();
                    }}
                    style={{ marginBottom: '8px', width: '100%', textAlign: 'center', padding: '4px 8px', fontSize: '12px' }}
                >
                    + 연결 추가 (Link)
                </button>

                {/* 선행 작업 (Predecessors) */}
                {predecessors && predecessors.length > 0 && (
                    <div className="dependency-list">
                        <div className="dependency-subtitle" style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>선행 (Predecessors)</div>
                        {predecessors.map(pred => (
                            <div key={pred.id} className="dependency-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                                    ← {pred.name}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F', cursor: 'pointer', background: 'none', border: 'none' }}
                                    onClick={() => onRemoveDependency(milestone.id, pred.id)}
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
                        {successors.map(succ => (
                            <div key={succ.id} className="dependency-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                                    → {succ.name}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F', cursor: 'pointer', background: 'none', border: 'none' }}
                                    onClick={() => onRemoveDependency(succ.id, milestone.id)}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                )}
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
            </div>
        </div>
    );
}

export default MilestoneEditPopover;
