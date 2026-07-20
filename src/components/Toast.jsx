import './Toast.css';

const ICONS = {
    success: '✓',
    error: '✕',
    warn: '⚠',
    info: 'ℹ',
};

function ToastItem({ toast, onRemove }) {
    return (
        <div className={`toast toast--${toast.type}`} role="alert">
            <span className="toast__icon">{ICONS[toast.type]}</span>
            <span className="toast__message">{toast.message}</span>
            <button className="toast__close" onClick={() => onRemove(toast.id)} aria-label="닫기">✕</button>
        </div>
    );
}

function ToastContainer({ toasts, onRemove }) {
    if (!toasts.length) return null;

    return (
        <div className="toast-container" aria-live="polite">
            {toasts.map(t => (
                <ToastItem key={t.id} toast={t} onRemove={onRemove} />
            ))}
        </div>
    );
}

export default ToastContainer;
