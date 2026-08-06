import { useState, useEffect } from 'react';
import { Save, Download } from 'lucide-react';
import { storage } from '../utils/storage';
import Modal from './Modal';

function SaveLoadModal({ isOpen, onClose, onLoad, currentData, onExportSnapshot, toast }) {
    const [snapshots, setSnapshots] = useState([]);
    const [saveName, setSaveName] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadSnapshots();
            setSaveName(`Backup ${new Date().toLocaleString()}`);
        }
    }, [isOpen]);

    const loadSnapshots = async () => {
        const data = await storage.loadSnapshots();
        setSnapshots(data || []);
    };

    const handleSave = async () => {
        if (!saveName.trim()) {
            toast.warn('저장할 이름을 입력해주세요.');
            return;
        }

        const existing = snapshots.find(s => s.name === saveName.trim());
        if (existing) {
            if (window.confirm(`'${saveName}' 이름의 프로젝트가 이미 존재합니다. 덮어쓰시겠습니까?`)) {
                const ok = await storage.updateSnapshot(existing.id, currentData);
                if (ok) {
                    await loadSnapshots();
                    setSaveName(`Backup ${new Date().toLocaleString()}`);
                    toast.success('업데이트되었습니다.');
                } else {
                    toast.error('저장 실패.');
                }
            }
            return;
        }

        const ok = await storage.saveSnapshot(saveName, currentData);
        if (ok) {
            await loadSnapshots();
            setSaveName(`Backup ${new Date().toLocaleString()}`);
            toast.success('저장되었습니다.');
        } else {
            toast.error('저장에 실패했습니다 (용량 부족 등).');
        }
    };

    const handleOverwrite = async (id, name) => {
        if (window.confirm(`'${name}' 프로젝트를 현재 상태로 덮어쓰시겠습니까?`)) {
            const ok = await storage.updateSnapshot(id, currentData);
            if (ok) {
                await loadSnapshots();
                toast.success('업데이트되었습니다.');
            } else {
                toast.error('업데이트 실패.');
            }
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('정말 삭제하시겠습니까?')) {
            await storage.deleteSnapshot(id);
            await loadSnapshots();
        }
    };

    const handleExport = (snapshot) => {
        onExportSnapshot(snapshot);
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Save size={17} aria-hidden="true" /> 프로젝트 저장/불러오기</>}
            width="600px"
            footer={<button className="secondary-button" onClick={onClose}>닫기</button>}
        >
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
                                    <Download size={13} aria-hidden="true" /> 내보내기
                                </button>
                                <button
                                    className="danger-button"
                                    onClick={() => handleDelete(snap.id)}
                                    style={{ padding: '4px 8px', fontSize: '12px', background: '#ff4444', color: 'white', border: 'none', borderRadius: '4px' }}
                                >
                                    삭제
                                </button>
                                <button
                                    className="secondary-button"
                                    onClick={() => handleOverwrite(snap.id, snap.name)}
                                    title="현재 상태로 덮어쓰기"
                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                >
                                    <Save size={13} aria-hidden="true" /> 덮어쓰기
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Modal>
    );
}

export default SaveLoadModal;
