// 서버 저장 상태 판정 — 순수함수. DOM·타이머·fetch 를 모르고, 다음 상태만 답한다.
//
// 배경: `storage.saveData` 의 실패(`{ok:false}`)는 `console.warn` 하나로 끝나고 있었다.
// 화면에는 아무 표시도 없고 재시도도 없어서, 사용자는 저장됐다고 믿은 채 편집을 멈춘다.
// 그 뒤 새로고침하면 로드가 서버 우선이라 **localStorage 캐시까지 낡은 데이터로 덮인다**
// (`storage.loadData`) — 미저장 편집이 흔적 없이 사라지는 경로다.
//
// 그래서 두 가지를 이 파일이 정한다: ① 지금 저장 상태가 무엇인가(표시 근거)
// ② 실패했으면 얼마 뒤에 다시 시도하는가(자동 복구). 판정이 여기 모여 있어야
// "저장됨으로 보이는데 실제로는 아닌" 조합이 생기지 않는다.

export const SYNC_SAVED = 'saved';     // 서버와 일치 — 잃을 것이 없다
export const SYNC_PENDING = 'pending'; // 저장할 편집이 있고 디바운스 대기 중
export const SYNC_SAVING = 'saving';   // 요청 진행 중
export const SYNC_ERROR = 'error';     // 마지막 시도가 실패 — 미저장 편집이 남아 있다

export const initialSyncState = { phase: SYNC_SAVED, failures: 0 };

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

/**
 * 저장 상태 전이. event: 'edit' | 'saving' | 'saved' | 'failed' | 'conflict'
 *
 * 두 가지 비대칭이 중요하다:
 *  - `saved` 는 **`saving` 중일 때만** 받는다. 요청이 나간 뒤 사용자가 또 편집하면
 *    phase 는 이미 `pending` 이고, 그 응답으로 `saved` 를 찍으면 방금 한 편집이
 *    저장된 것처럼 보인다.
 *  - `failed` 는 phase 를 가리지 않고 `error` 로 간다. 실패를 `saved` 로 남기는 것보다
 *    과하게 경고하는 편이 낫다.
 */
export function nextSyncState(state, event) {
    const { phase, failures } = state;

    switch (event) {
        case 'edit':
            // error 는 유지한다 — 실패 사실과 미저장 사실이 둘 다 아직 유효하다.
            if (phase === SYNC_ERROR) return state;
            return phase === SYNC_PENDING ? state : { phase: SYNC_PENDING, failures };

        case 'saving':
            return phase === SYNC_SAVING ? state : { phase: SYNC_SAVING, failures };

        case 'saved':
            if (phase !== SYNC_SAVING) return state;
            return { phase: SYNC_SAVED, failures: 0 };

        case 'failed':
            return { phase: SYNC_ERROR, failures: failures + 1 };

        // 409 — 외부(AI)가 먼저 바꿨다. 서버 우선 정책상 재로드가 뒤따르므로
        // 내 쪽에 미저장으로 남는 것이 없다.
        case 'conflict':
            return { phase: SYNC_SAVED, failures: 0 };

        default:
            return state;
    }
}

/** 서버에 도달하지 않은 편집이 있는가 — beforeunload 경고·폴링 연기의 근거 */
export const hasUnsavedEdits = (state) => state.phase !== SYNC_SAVED;

/**
 * 다음 재시도까지 기다릴 시간(ms). 지수 백오프 — 서버가 죽어 있는 동안
 * 1.5초마다 요청을 던지면 로그만 채우고 복구를 앞당기지도 못한다.
 */
export function retryDelay(failures) {
    if (failures <= 1) return RETRY_BASE_MS;
    return Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

/**
 * 표시용 서술. 색 단독 인코딩을 피하려면 화면이 아이콘·텍스트도 함께 골라야 하는데,
 * 그 분기가 컴포넌트에 흩어지면 상태와 문구가 갈라진다(실사 §5.3).
 */
export function describeSyncState(state) {
    switch (state.phase) {
        case SYNC_PENDING:
        case SYNC_SAVING:
            // 둘을 한 문구로 묶는다. 디바운스 1.5초를 사용자에게 두 단계로 보여 줄 이유가 없다.
            return { tone: 'busy', label: '저장 중…', hint: '서버에 반영하는 중입니다.', canRetry: false };
        case SYNC_ERROR:
            return {
                tone: 'error',
                label: '저장 실패',
                hint: '변경분이 이 브라우저에만 있습니다. 자동으로 다시 시도합니다 — 눌러서 즉시 재시도.',
                canRetry: true,
            };
        default:
            return { tone: 'quiet', label: '저장됨', hint: '서버에 저장되었습니다.', canRetry: false };
    }
}
