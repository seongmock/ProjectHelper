import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import './ImportExportModal.css';

function ImportExportModal({ isOpen, onClose, mode, onImport, onExport, currentData, toast }) {
    const [activeTab, setActiveTab] = useState('file'); // 'file' | 'text'
    const [jsonText, setJsonText] = useState('');
    const [isMerge, setIsMerge] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            // 초기화
            setActiveTab('file');
            setJsonText('');
            setIsMerge(false);

            // Export 모드이고 텍스트 탭이면 데이터 로드
            if (mode === 'EXPORT' && activeTab === 'text') {
                setJsonText(JSON.stringify(currentData, null, 2));
            }
        }
    }, [isOpen, mode, currentData]);

    // 탭 변경 시 Export 데이터 로드
    useEffect(() => {
        if (isOpen && mode === 'EXPORT' && activeTab === 'text') {
            setJsonText(JSON.stringify(currentData, null, 2));
        }
    }, [activeTab, isOpen, mode, currentData]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            onImport(file, isMerge);
            onClose();
        }
    };

    const handleTextImport = () => {
        try {
            const parsed = JSON.parse(jsonText);
            const blob = new Blob([jsonText], { type: 'application/json' });
            const file = new File([blob], 'pasted_data.json', { type: 'application/json' });
            onImport(file, isMerge);
            onClose();
        } catch (err) {
            toast.error('유효하지 않은 JSON 형식입니다: ' + err.message);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(jsonText)
            .then(() => toast.success('JSON 데이터가 클립보드에 복사되었습니다.'))
            .catch(err => toast.error('복사 실패: ' + err));
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={mode === 'IMPORT' ? '📥 데이터 가져오기' : '📤 데이터 내보내기'}
            className="ie-modal"
        >
            <div className="tabs">
                <button
                    className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
                    onClick={() => setActiveTab('file')}
                >
                    {mode === 'IMPORT' ? '📁 파일 업로드' : '⬇️ 파일 다운로드'}
                </button>
                <button
                    className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                    onClick={() => setActiveTab('text')}
                >
                    {mode === 'IMPORT' ? '📋 JSON 붙여넣기' : '📋 JSON 복사'}
                </button>
            </div>

            <div className="tab-content">
                {/* === IMPORT MODE === */}
                {mode === 'IMPORT' && (
                    <>
                        <div className="option-row">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={isMerge}
                                    onChange={e => setIsMerge(e.target.checked)}
                                />
                                <span>기존 데이터에 병합 (Merge)</span>
                            </label>
                            <p className="hint">체크 해제 시 기존 데이터를 덮어씁니다.</p>
                        </div>

                        {activeTab === 'file' ? (
                            <div className="file-upload-area">
                                <p>JSON 파일을 선택하여 업로드하세요.</p>
                                <input
                                    type="file"
                                    accept=".json"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                />
                                <button
                                    className="primary-button"
                                    onClick={() => fileInputRef.current.click()}
                                >
                                    파일 선택
                                </button>
                            </div>
                        ) : (
                            <div className="text-area-wrapper">
                                <textarea
                                    placeholder="여기에 JSON 코드를 붙여넣으세요..."
                                    value={jsonText}
                                    onChange={e => setJsonText(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onKeyUp={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                />
                                <button
                                    className="primary-button full-width"
                                    onClick={handleTextImport}
                                    disabled={!jsonText.trim()}
                                >
                                    데이터 적용
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* === EXPORT MODE === */}
                {mode === 'EXPORT' && (
                    <>
                        {activeTab === 'file' ? (
                            <div className="file-download-area">
                                <p>현재 프로젝트 데이터를 JSON 파일로 저장합니다.</p>
                                <button
                                    className="primary-button"
                                    onClick={() => { onExport(); onClose(); }}
                                >
                                    다운로드 (.json)
                                </button>
                            </div>
                        ) : (
                            <div className="text-area-wrapper">
                                <textarea
                                    readOnly
                                    value={jsonText}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onKeyUp={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                />
                                <button
                                    className="secondary-button full-width"
                                    onClick={handleCopy}
                                >
                                    클립보드에 복사
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

export default ImportExportModal;
