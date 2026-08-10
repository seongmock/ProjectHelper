// 모든 모달의 공용 껍데기 — 오버레이 · 헤더 · 닫기 · Escape · 포커스 · 접근성.
//
// 예전에는 모달마다 이 구조를 각자 복사해 갖고 있었고, 그래서 Escape 로 닫히는
// 모달과 안 닫히는 모달이 섞여 있었다. 내용만 children 으로 넘긴다.
//
// 포커스도 여기가 소유한다(진입·가두기·복귀). 새 오버레이는 이 껍데기를 써라 —
// 각자 구현하면 예전 Escape 처럼 모달마다 키보드 동작이 갈라진다.
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getFocusableElements, nextTrapIndex } from './focusTrap';
import './Modal.css';

function Modal({ isOpen, onClose, title, children, footer, className = '', width }) {
    const titleId = useId();
    const dialogRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        // 캡처 단계에서 받는다 — 모달 안의 입력이 keydown 을 stopPropagation 하는 경우가 있다
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, onClose]);

    // 열면 포커스를 안으로 들이고, 닫으면 열었던 자리로 돌려준다.
    // 돌려주지 않으면 포커스가 <body> 로 떨어져서 다음 Tab 이 페이지 맨 위에서 다시
    // 시작한다 — 키보드만 쓰는 사용자에게는 방금 누른 버튼을 잃는 것이다.
    useEffect(() => {
        if (!isOpen) return;
        const opener = document.activeElement;
        const dialog = dialogRef.current;
        // 자식이 이미 자기 입력을 잡았으면(팔레트 검색창·마일스톤 이름) 빼앗지 않는다.
        // 자식 effect 가 부모보다 먼저 도므로 여기서는 결과만 확인한다.
        if (dialog && !dialog.contains(document.activeElement)) {
            (getFocusableElements(dialog)[0] ?? dialog).focus();
        }
        return () => {
            // 열었던 요소가 그 사이 사라졌을 수 있다(스냅샷 삭제 등)
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        };
    }, [isOpen]);

    // Tab 이 모달 밖으로 새면 배경이 보이지 않는 채로 조작된다.
    // 자식이 Tab 을 자기 것으로 쓰는 경우(팔레트의 목록 이동)는 defaultPrevented 로 비켜 준다.
    const handleTrap = (e) => {
        if (e.key !== 'Tab' || e.defaultPrevented) return;
        const dialog = dialogRef.current;
        const focusables = getFocusableElements(dialog);
        const target = nextTrapIndex(
            focusables.length,
            focusables.indexOf(document.activeElement),
            e.shiftKey
        );
        if (target === null) return;
        e.preventDefault();
        (target === -1 ? dialog : focusables[target]).focus();
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={dialogRef}
                className={`modal-content ${className}`.trim()}
                style={width ? { maxWidth: width } : undefined}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleTrap}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                // 받을 것이 하나도 없는 모달에서도 포커스가 배경으로 새지 않게 한다
                tabIndex={-1}
            >
                <div className="modal-header">
                    <h3 id={titleId}>{title}</h3>
                    <button className="modal-close" onClick={onClose} aria-label="닫기">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}

export default Modal;
