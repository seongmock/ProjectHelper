import { CircleCheck, CircleX, TriangleAlert, Info, X } from 'lucide-react';
import './Toast.css';

const ICONS = {
    success: CircleCheck,
    error: CircleX,
    warn: TriangleAlert,
    info: Info,
};

function ToastItem({ toast, onRemove }) {
    const Icon = ICONS[toast.type] ?? Info;
    return (
        <div className={`toast toast--${toast.type}`} role="alert">
            <span className="toast__icon"><Icon size={16} aria-hidden="true" /></span>
            <span className="toast__message">{toast.message}</span>
            <button className="toast__close" onClick={() => onRemove(toast.id)} aria-label="닫기">
                <X size={14} aria-hidden="true" />
            </button>
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
