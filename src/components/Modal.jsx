// 모든 모달의 공용 껍데기 — 오버레이 · 헤더 · 닫기 · Escape · 접근성.
//
// 예전에는 모달마다 이 구조를 각자 복사해 갖고 있었고, 그래서 Escape 로 닫히는
// 모달과 안 닫히는 모달이 섞여 있었다. 내용만 children 으로 넘긴다.
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

function Modal({ isOpen, onClose, title, children, footer, className = '', width }) {
    const titleId = useId();

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        // 캡처 단계에서 받는다 — 모달 안의 입력이 keydown 을 stopPropagation 하는 경우가 있다
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div
                className={`modal-content ${className}`.trim()}
                style={width ? { maxWidth: width } : undefined}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <div className="modal-header">
                    <h3 id={titleId}>{title}</h3>
                    <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}

export default Modal;
