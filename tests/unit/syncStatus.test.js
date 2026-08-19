// 저장 상태 판정 단위 테스트.
//
// 이 규칙이 틀리면 화면이 거짓말을 한다. 특히 두 방향이 위험하다:
// 실패를 '저장됨'으로 표시하면 사용자가 잃을 편집을 지키지 못하고,
// 저장이 끝났는데 '저장 중'에 머물면 인디케이터 자체를 믿지 않게 된다.
import { describe, it, expect } from 'vitest';
import {
    initialSyncState, nextSyncState, hasUnsavedEdits, retryDelay, describeSyncState,
    SYNC_SAVED, SYNC_PENDING, SYNC_SAVING, SYNC_ERROR, SYNC_GONE,
} from '../../src/features/projects/syncStatus';

const at = (phase, failures = 0) => ({ phase, failures });

describe('nextSyncState', () => {
    it('편집은 저장됨을 대기로 바꾼다', () => {
        expect(nextSyncState(initialSyncState, 'edit')).toEqual(at(SYNC_PENDING));
    });

    it('저장 성공 왕복', () => {
        let s = nextSyncState(initialSyncState, 'edit');
        s = nextSyncState(s, 'saving');
        expect(s).toEqual(at(SYNC_SAVING));
        s = nextSyncState(s, 'saved');
        expect(s).toEqual(at(SYNC_SAVED));
        expect(hasUnsavedEdits(s)).toBe(false);
    });

    it('저장 중에 들어온 편집은 응답이 성공해도 저장됨이 되지 않는다', () => {
        // 이걸 놓치면 요청이 나간 뒤 한 편집이 저장된 것처럼 보인다.
        const saving = at(SYNC_SAVING);
        const editedWhileSaving = nextSyncState(saving, 'edit');
        expect(editedWhileSaving).toEqual(at(SYNC_PENDING));
        expect(nextSyncState(editedWhileSaving, 'saved')).toEqual(at(SYNC_PENDING));
        expect(hasUnsavedEdits(editedWhileSaving)).toBe(true);
    });

    it('실패는 phase 를 가리지 않고 error 로 가며 연속 실패를 센다', () => {
        let s = nextSyncState(at(SYNC_SAVING), 'failed');
        expect(s).toEqual(at(SYNC_ERROR, 1));
        s = nextSyncState(nextSyncState(s, 'saving'), 'failed');
        expect(s).toEqual(at(SYNC_ERROR, 2));
        expect(nextSyncState(at(SYNC_PENDING), 'failed')).toEqual(at(SYNC_ERROR, 1));
    });

    it('실패 상태에서 편집해도 실패 상태가 유지된다', () => {
        // 미저장 사실이 아직 유효하다 — 편집이 경고를 지워서는 안 된다.
        const errored = at(SYNC_ERROR, 3);
        expect(nextSyncState(errored, 'edit')).toBe(errored);
        expect(hasUnsavedEdits(errored)).toBe(true);
    });

    it('재시도가 성공하면 연속 실패 횟수가 0으로 돌아간다', () => {
        const retrying = nextSyncState(at(SYNC_ERROR, 4), 'saving');
        expect(retrying).toEqual(at(SYNC_SAVING, 4));
        expect(nextSyncState(retrying, 'saved')).toEqual(at(SYNC_SAVED, 0));
    });

    it('409(충돌)는 저장됨으로 정리한다 — 서버 우선 재로드가 뒤따른다', () => {
        expect(nextSyncState(at(SYNC_SAVING, 2), 'conflict')).toEqual(at(SYNC_SAVED, 0));
    });

    it('알 수 없는 이벤트는 상태를 그대로 돌려준다', () => {
        const s = at(SYNC_PENDING);
        expect(nextSyncState(s, 'nope')).toBe(s);
    });

    it('상태를 제자리에서 바꾸지 않는다', () => {
        const s = at(SYNC_SAVING, 1);
        nextSyncState(s, 'failed');
        expect(s).toEqual(at(SYNC_SAVING, 1));
    });
});

describe('retryDelay', () => {
    it('첫 실패는 기본 지연, 이후 2배씩 늘어난다', () => {
        expect(retryDelay(1)).toBe(2000);
        expect(retryDelay(2)).toBe(4000);
        expect(retryDelay(3)).toBe(8000);
        expect(retryDelay(4)).toBe(16000);
    });

    it('상한이 있다 — 무한히 멀어지면 서버가 돌아와도 복구가 늦다', () => {
        expect(retryDelay(10)).toBe(60000);
        expect(retryDelay(100)).toBe(60000);
    });

    it('0·음수도 기본 지연으로 방어한다', () => {
        expect(retryDelay(0)).toBe(2000);
        expect(retryDelay(-1)).toBe(2000);
    });
});

describe('describeSyncState', () => {
    it('대기와 저장 중은 한 문구로 묶는다', () => {
        expect(describeSyncState(at(SYNC_PENDING)).label).toBe(describeSyncState(at(SYNC_SAVING)).label);
        expect(describeSyncState(at(SYNC_PENDING)).tone).toBe('busy');
    });

    it('실패만 재시도를 제안한다', () => {
        expect(describeSyncState(at(SYNC_ERROR, 1)).canRetry).toBe(true);
        expect(describeSyncState(at(SYNC_SAVED)).canRetry).toBe(false);
        expect(describeSyncState(at(SYNC_SAVING)).canRetry).toBe(false);
    });

    it('색 말고도 구분할 것을 준다 — 모든 상태가 라벨과 설명을 갖는다', () => {
        for (const phase of [SYNC_SAVED, SYNC_PENDING, SYNC_SAVING, SYNC_ERROR, SYNC_GONE]) {
            const d = describeSyncState(at(phase));
            expect(d.label).toBeTruthy();
            expect(d.hint).toBeTruthy();
        }
    });
});

// 프로젝트가 통째로 사라진 경우. 이것을 error 로 묶어 두면 화면은 '저장 실패'만 말하고
// 재시도는 404 를 향해 영원히 백오프한다 — 무슨 일이 일어났는지도, 무엇을 해야 하는지도
// 알 수 없는 상태가 된다.
describe('삭제된 프로젝트 (gone)', () => {
    it('어느 상태에서든 gone 으로 간다', () => {
        for (const phase of [SYNC_SAVED, SYNC_PENDING, SYNC_SAVING, SYNC_ERROR]) {
            expect(nextSyncState(at(phase, 3), 'gone').phase).toBe(SYNC_GONE);
        }
    });

    it('gone 은 흡수 상태다 — 늦게 온 응답이 저장됨으로 되돌리지 못한다', () => {
        const gone = nextSyncState(at(SYNC_SAVING), 'gone');
        for (const event of ['edit', 'saving', 'saved', 'failed', 'conflict']) {
            expect(nextSyncState(gone, event)).toBe(gone);
        }
    });

    it('미저장으로 센다 — 화면의 트리는 아직 이 브라우저에만 있다', () => {
        expect(hasUnsavedEdits(at(SYNC_GONE))).toBe(true);
    });

    it('재시도가 아니라 복구를 제안한다 — 대상이 없으므로 다시 보내도 404 다', () => {
        const d = describeSyncState(at(SYNC_GONE, 2));
        expect(d.canRetry).toBe(false);
        expect(d.canRecover).toBe(true);
        expect(describeSyncState(at(SYNC_ERROR, 1)).canRecover).toBeFalsy();
    });
});
