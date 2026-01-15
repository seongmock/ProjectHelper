import { useState, useEffect } from 'react';
import { storage } from '../utils/storage';
import './Modal.css'; // Reusing Modal CSS

function SaveLoadModal({ isOpen, onClose, onLoad, currentData, onExportSnapshot }) {
    const [snapshots, setSnapshots] = useState([]);
    const [saveName, setSaveName] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadSnapshots();
            setSaveName(`Backup ${new Date().toLocaleString()}`);
        }
    }, [isOpen]);

    const loadSnapshots = () => {
        setSnapshots(storage.loadSnapshots());
    };

    const handleSave = () => {
        if (!saveName.trim()) {
            alert('저장할 이름을 입력해주세요.');
            return;
        }
        if (storage.saveSnapshot(saveName, currentData)) {
            loadSnapshots();
            setSaveName(`Backup ${new Date().toLocaleString()}`);
        } else {
            alert('저장에 실패했습니다 (용량 부족 등).');
        }
    };

    const handleDelete = (id) => {
        if (window.confirm('정말 삭제하시겠습니까?')) {
            storage.deleteSnapshot(id);
            loadSnapshots();
        }
    };

    const handleExport = (snapshot) => {
        onExportSnapshot(snapshot);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h2>💾 프로젝트 저장/불러오기</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* 저장 섹션 */}
                    <div className="save-section" style={{ marginBottom: '20px', padding: '15px', background: 'var(--color-bg-secondary)', borderRadius: '8px' }}>
                        <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>현재 상태 저장</h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input
                                type="text"
                                value={saveName}
                                onChange={(e) => setSaveName(e.target.value)}
                                placeholder="저장할 이름을 입력하세요"
                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                            />
                            <button className="primary-button" onClick={handleSave}>저장</button>
                        </div>
                    </div>

                    {/* 목록 섹션 */}
                    <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>저장된 목록</h3>
                    <div className="snapshot-list" style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                        {snapshots.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                저장된 항목이 없습니다.
                            </div>
                        ) : (
                            snapshots.map(snap => (
                                <div key={snap.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '12px',
                                    borderBottom: '1px solid var(--color-border)'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 'bold' }}>{snap.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                            {new Date(snap.date).toLocaleString()}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            className="secondary-button"
                                            onClick={() => {
                                                if (window.confirm(`'${snap.name}' 상태로 복구하시겠습니까? 현재 변경사항은 사라집니다.`)) {
                                                    onLoad(snap.data);
                                                    onClose();
                                                }
                                            }}
                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                        >
                                            불러오기
                                        </button>
                                        <button
                                            className="secondary-button"
                                            onClick={() => handleExport(snap)}
                                            title="내보내기"
                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                        >
                                            📤 내보내기
                                        </button>
                                        <button
                                            className="danger-button"
                                            onClick={() => handleDelete(snap.id)}
                                            style={{ padding: '4px 8px', fontSize: '12px', background: '#ff4444', color: 'white', border: 'none', borderRadius: '4px' }}
                                        >
                                            삭제
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="secondary-button" onClick={onClose}>닫기</button>
                </div>
            </div>
        </div>
    );
}

export default SaveLoadModal;
