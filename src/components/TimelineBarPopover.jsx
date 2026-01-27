import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import './TimelineBarPopover.css';
import ColorPicker from './ColorPicker';

function TimelineBarPopover({ position, task, clickedDate, clickedRangeId, successors = [], predecessors = [], onClose, onUpdate, onDelete, onAddMilestone, onStartLinking, onAddTimeRange, onRemoveDependency }) {
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
                <span className="popover-title">
                    {clickedRangeId ? '기간 설정 (Range Settings)' : '작업 설정 (Task Settings)'}
                </span>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            {/* 설명 (Description) - Hide if Range Mode */}
            {!clickedRangeId && (
                <div className="popover-section">
                    <textarea
                        placeholder="작업 설명 (Description)"
                        value={task.description || ''}
                        onChange={(e) => onUpdate(task.id, { description: e.target.value })}
                        style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '8px',
                            border: '1px solid var(--color-border)',
                            borderRadius: '4px',
                            fontSize: '13px',
                            resize: 'vertical',
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-primary)'
                        }}
                    />
                </div>
            )}

            {/* [NEW] 기간 추가 버튼: 주 메뉴로 이동 권장 */}
            {!clickedRangeId && (
                <div className="popover-section" style={{ paddingBottom: '0' }}>
                    <button
                        className="action-btn secondary full-width"
                        onClick={() => onAddTimeRange && onAddTimeRange(task.id, clickedDate || new Date())}
                        style={{ marginBottom: '8px', width: '100%', textAlign: 'center', padding: '6px 8px', fontSize: '13px', fontWeight: 'bold' }}
                    >
                        + 기간 추가 (Add Time Range)
                    </button>
                </div>
            )}


            <div className="popover-section">
                <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{clickedRangeId ? '선택된 기간 (Selected Range)' : '기간 (Time Ranges)'}</span>
                </div>

                {/* Render Multiple Time Ranges (Sorted) */}
                {/* Render Multiple Time Ranges (Sorted) */}
                {(() => {
                    // Prepare ranges (legacy fallback + sort)
                    const rawRanges = (task.timeRanges && task.timeRanges.length > 0)
                        ? task.timeRanges
                        : [{ id: 'legacy', startDate: task.startDate, endDate: task.endDate }];

                    // Sort for display
                    let sortedRanges = [...rawRanges].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

                    if (clickedRangeId) {
                        sortedRanges = sortedRanges.filter(r => r.id === clickedRangeId);
                    }

                    return sortedRanges.map((range) => {
                        const isSelectedRange = clickedRangeId && range.id === clickedRangeId;
                        const borderColor = isSelectedRange ? '2px solid var(--color-primary)' : '1px dashed #eee';
                        const bgColor = isSelectedRange ? 'rgba(74, 144, 226, 0.05)' : 'transparent';

                        return (
                            <div key={range.id} style={{ marginBottom: '8px', padding: '8px', border: borderColor, backgroundColor: bgColor, borderRadius: '4px' }}>
                                {/* Range Label & Color (New) */}
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                    <div style={{ flex: 2 }}>
                                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>라벨 (Optional)</label>
                                        <input
                                            type="text"
                                            value={range.label || ''}
                                            placeholder="기간 라벨"
                                            onChange={(e) => {
                                                const newRanges = task.timeRanges.map(r => r.id === range.id ? { ...r, label: e.target.value } : r);
                                                onUpdate(task.id, { timeRanges: newRanges });
                                            }}
                                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>색상</label>
                                        <ColorPicker
                                            color={range.color || task.color}
                                            onChange={(color) => {
                                                const newRanges = task.timeRanges.map(r => r.id === range.id ? { ...r, color: color } : r);
                                                onUpdate(task.id, { timeRanges: newRanges });
                                            }}
                                        />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>시작일</label>
                                        <input
                                            type="date"
                                            value={range.startDate}
                                            onChange={(e) => {
                                                const originalRanges = [...(task.timeRanges || [{ id: 'legacy', startDate: task.startDate, endDate: task.endDate }])];
                                                const targetIndex = originalRanges.findIndex(r => r.id === range.id);

                                                if (targetIndex !== -1) {
                                                    originalRanges[targetIndex] = { ...originalRanges[targetIndex], startDate: e.target.value };

                                                    // Determine overall start/end
                                                    const allStarts = originalRanges.map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
                                                    const allEnds = originalRanges.map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));

                                                    let minStartStr = '';
                                                    let maxEndStr = '';

                                                    if (allStarts.length > 0) {
                                                        minStartStr = new Date(Math.min(...allStarts)).toISOString().split('T')[0];
                                                    }
                                                    if (allEnds.length > 0) {
                                                        maxEndStr = new Date(Math.max(...allEnds)).toISOString().split('T')[0];
                                                    }

                                                    onUpdate(task.id, {
                                                        timeRanges: originalRanges,
                                                        startDate: minStartStr,
                                                        endDate: maxEndStr
                                                    });
                                                }
                                            }}
                                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>종료일</label>
                                        <input
                                            type="date"
                                            value={range.endDate}
                                            onChange={(e) => {
                                                const originalRanges = [...(task.timeRanges || [{ id: 'legacy', startDate: task.startDate, endDate: task.endDate }])];
                                                const targetIndex = originalRanges.findIndex(r => r.id === range.id);

                                                if (targetIndex !== -1) {
                                                    originalRanges[targetIndex] = { ...originalRanges[targetIndex], endDate: e.target.value };

                                                    // Determine overall start/end
                                                    const allStarts = originalRanges.map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
                                                    const allEnds = originalRanges.map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));

                                                    let minStartStr = '';
                                                    let maxEndStr = '';

                                                    if (allStarts.length > 0) {
                                                        minStartStr = new Date(Math.min(...allStarts)).toISOString().split('T')[0];
                                                    }
                                                    if (allEnds.length > 0) {
                                                        maxEndStr = new Date(Math.max(...allEnds)).toISOString().split('T')[0];
                                                    }

                                                    onUpdate(task.id, {
                                                        timeRanges: originalRanges,
                                                        startDate: minStartStr,
                                                        endDate: maxEndStr
                                                    });
                                                }
                                            }}
                                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}
                                        />
                                    </div>

                                    {/* Delete Range Button (Small Circle X) */}
                                    <button
                                        onClick={() => {
                                            if (window.confirm('이 기간을 삭제하시겠습니까?')) {
                                                const originalRanges = [...(task.timeRanges || [{ id: 'legacy', startDate: task.startDate, endDate: task.endDate }])];
                                                const newRanges = originalRanges.filter(r => r.id !== range.id);

                                                // Handle empty ranges (Should probably remove default empty fallback or clear dates)
                                                if (newRanges.length === 0) {
                                                    onUpdate(task.id, {
                                                        timeRanges: [],
                                                        startDate: '',
                                                        endDate: ''
                                                    });
                                                } else {
                                                    const allStarts = newRanges.map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
                                                    const allEnds = newRanges.map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));

                                                    let minStartStr = '';
                                                    let maxEndStr = '';

                                                    if (allStarts.length > 0) {
                                                        minStartStr = new Date(Math.min(...allStarts)).toISOString().split('T')[0];
                                                    }
                                                    if (allEnds.length > 0) {
                                                        maxEndStr = new Date(Math.max(...allEnds)).toISOString().split('T')[0];
                                                    }

                                                    onUpdate(task.id, {
                                                        timeRanges: newRanges,
                                                        startDate: minStartStr,
                                                        endDate: maxEndStr
                                                    });
                                                }
                                            }
                                        }}
                                        title="기간 삭제"
                                        style={{
                                            background: 'white',
                                            border: '1px solid #D9534F',
                                            color: '#D9534F',
                                            borderRadius: '50%',
                                            width: '16px',
                                            height: '16px',
                                            minWidth: '16px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            padding: 0,
                                            lineHeight: 1,
                                            marginTop: '16px'
                                        }}
                                    >
                                        &times;
                                    </button>
                                </div>
                            </div>
                        );
                    });
                })()}
            </div>

            {/* Task Level Color - Hide if Range Mode */}
            {!clickedRangeId && (
                <div className="popover-section">
                    <div className="section-title">색상</div>
                    <div className="color-grid">
                        <ColorPicker
                            color={task.color}
                            onChange={(color) => onUpdate(task.id, { color })}
                        />
                    </div>
                </div>
            )}

            {/* 의존성 관리 */}
            <div className="popover-section">
                <div className="section-title">연결 (Dependencies)</div>
                <button
                    className="action-btn secondary full-width"
                    onClick={onStartLinking}
                    style={{ marginBottom: '8px', width: '100%', textAlign: 'center', padding: '4px 8px', fontSize: '12px' }}
                >
                    {clickedRangeId ? '+ 연결 추가 (Link Range)' : '+ 연결 추가 (Link Task)'}
                </button>

                {/* 선행 작업 (Predecessors) */}
                {predecessors && predecessors.length > 0 && (
                    <div className="dependency-list">
                        <div className="dependency-subtitle" style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>선행 (Predecessors)</div>
                        {predecessors.map(predTask => (
                            <div key={predTask.id} className="dependency-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                                    ← {predTask.name || predTask.label}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F' }}
                                    onClick={() => {
                                        if (clickedRangeId) {
                                            // Remove predTask.id from ME (clickedRangeId)
                                            if (onRemoveDependency) {
                                                onRemoveDependency(clickedRangeId, predTask.id);
                                            } else {
                                                // Fallback (should not happen if App passes prop)
                                                // ... (Original logic)
                                                const rangeIndex = task.timeRanges.findIndex(r => r.id === clickedRangeId);
                                                if (rangeIndex !== -1) {
                                                    const currentDeps = task.timeRanges[rangeIndex].dependencies || [];
                                                    const updatedDeps = currentDeps.filter(id => id !== predTask.id);
                                                    const newRanges = [...task.timeRanges];
                                                    newRanges[rangeIndex] = { ...newRanges[rangeIndex], dependencies: updatedDeps };
                                                    onUpdate(task.id, { timeRanges: newRanges });
                                                }
                                            }
                                        } else {
                                            // Remove predTask.id from ME (task.id)
                                            if (onRemoveDependency) {
                                                onRemoveDependency(task.id, predTask.id);
                                            } else {
                                                const newDeps = task.dependencies.filter(id => id !== predTask.id);
                                                onUpdate(task.id, { dependencies: newDeps });
                                            }
                                        }
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
                                    → {succTask.name || succTask.label}
                                </span>
                                <button
                                    className="close-btn"
                                    style={{ fontSize: '14px', color: '#D9534F' }}
                                    onClick={() => {
                                        // 후행 작업 (Successor) 제거 -- Successor's dependency on ME (or MY RANGE)
                                        // succTask depends on ME.
                                        // We want to remove ME from succTask.dependencies.

                                        // What is "ME"?
                                        // If clickedRangeId, ME is clickedRangeId.
                                        // Else ME is task.id.

                                        // BUT succTask might depend on specific RANGE even if we are in Legacy view?
                                        // No, if legacy view (RangeId null), we act as Task ID.

                                        let myId = clickedRangeId || task.id;

                                        // Use generic handler
                                        if (onRemoveDependency) {
                                            onRemoveDependency(succTask.id, myId);
                                        } else {
                                            // Fallback Logic (Broken for Milestones, works for Tasks)
                                            // ...
                                        }
                                    }}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                )
                }
            </div >

            {/* 구분선 (Divider) 설정 - Hide if Range Mode */}
            {!clickedRangeId && (
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

                    {
                        task.divider?.enabled && (
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
                        )
                    }
                </div>
            )}

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
                        if (clickedRangeId) {
                            if (window.confirm('이 기간을 삭제하시겠습니까?')) {
                                const originalRanges = [...(task.timeRanges || [])]; // Should be migrated but safe check
                                const newRanges = originalRanges.filter(r => r.id !== clickedRangeId);

                                // Logic similar to the small 'x' button
                                if (newRanges.length === 0) {
                                    onUpdate(task.id, { timeRanges: [], startDate: '', endDate: '' });
                                } else {
                                    const allStarts = newRanges.map(r => new Date(r.startDate).getTime()).filter(t => !isNaN(t));
                                    const allEnds = newRanges.map(r => new Date(r.endDate).getTime()).filter(t => !isNaN(t));
                                    const minStart = allStarts.length > 0 ? new Date(Math.min(...allStarts)).toISOString().split('T')[0] : '';
                                    const maxEnd = allEnds.length > 0 ? new Date(Math.max(...allEnds)).toISOString().split('T')[0] : '';

                                    onUpdate(task.id, { timeRanges: newRanges, startDate: minStart, endDate: maxEnd });
                                }
                                onClose();
                            }
                        } else {
                            if (window.confirm('정말 이 작업을 삭제하시겠습니까?')) {
                                onDelete(task.id);
                                onClose();
                            }
                        }
                    }}
                >
                    {clickedRangeId ? '삭제 (Delete Range)' : '삭제 (Delete Task)'}
                </button>
            </div>
        </div >
    );
}

export default TimelineBarPopover;
