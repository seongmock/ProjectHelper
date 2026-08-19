// 저장 상태 인디케이터. 판정과 문구는 syncStatus.js 가 정하고, 여기서는 그리기만 한다.
//
// 왜 상시 표시인가: 저장은 1.5초 디바운스로 조용히 일어나기 때문에, 실패했을 때만
// 무언가를 띄우면 사용자는 그 표시가 무엇인지 배울 기회가 없다. 평소 눈에 익은 자리에
// "저장됨"이 있어야 "저장 실패"가 읽힌다. 대신 정상 상태는 저조도로 낮춰 실사 §5.1
// (모든 요소가 동등한 비중이라 시선 우선순위가 없다)을 되풀이하지 않는다.
import { Check, RefreshCw, CloudAlert } from 'lucide-react';
import { describeSyncState } from './syncStatus';
import './SyncIndicator.css';

const ICONS = {
    quiet: Check,
    busy: RefreshCw,
    error: CloudAlert,
};

function SyncIndicator({ state, onRetry, onRecover }) {
    const { tone, label, hint, canRetry, canRecover } = describeSyncState(state);
    const Icon = ICONS[tone];

    // 색만으로 구분하지 않는다 — 아이콘·텍스트·title 이 함께 상태를 말한다(실사 §5.3).
    const content = (
        <>
            <Icon size={14} aria-hidden="true" className={tone === 'busy' ? 'sync-spin' : undefined} />
            <span>{label}</span>
        </>
    );

    // 누를 수 있는 상태는 둘이고 하는 일이 다르다: 실패는 재시도, 삭제됨은 새 프로젝트로
    // 옮기기. 같은 버튼에 같은 동작을 붙이면 삭제된 프로젝트에 404 를 다시 던지게 된다.
    if (canRetry || canRecover) {
        return (
            <button
                type="button"
                className={`sync-indicator sync-${tone}`}
                onClick={canRecover ? onRecover : onRetry}
                title={hint}
                aria-label={canRecover ? `${label} — 눌러서 새 프로젝트로 저장` : `${label} — 눌러서 즉시 재시도`}
                data-sync-state={state.phase}
                data-testid="sync-indicator"
            >
                {content}
            </button>
        );
    }

    return (
        <span
            className={`sync-indicator sync-${tone}`}
            title={hint}
            aria-live="polite"
            data-sync-state={state.phase}
            data-testid="sync-indicator"
        >
            {content}
        </span>
    );
}

export default SyncIndicator;
