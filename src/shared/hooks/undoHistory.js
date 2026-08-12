// 되돌리기/다시실행 히스토리의 판정 — 순수 함수만. React 도, 트리도 모른다.
//
// 왜 훅에서 꺼냈나: 히스토리는 **20칸**이고, 한 번의 조작이 이벤트마다 한 칸씩 쌓으면
// 그 조작 하나로 앞선 편집 20건이 전부 밀려나간다. 실제로 그런 자리가 셋 있었다 —
// 진행률 슬라이더 드래그(step 5 → 최대 21건), 커스텀 색상 입력을 끄는 동안(연속),
// `[`/`]` 키를 누른 채 두기(브라우저 오토리핏, 초당 수십 건). 되돌리기는 잘못된 편집의
// 유일한 복구 수단인데 그것을 연속 입력이 지워 버리고, 되돌리기가 그 조작 안에서만
// 5% 씩·하루씩 맴돌았다.
//
// 텍스트 입력은 같은 문제를 이미 피하고 있다 — blur/Enter 에만 커밋한다(DraftField).
// 드래그하는 컨트롤에는 그런 커밋 시점이 없어서, 대신 **같은 제스처의 연속을 한 칸으로
// 합친다**(coalescing). 판정이 setState 클로저 안에만 있으면 테스트할 방법이 없어서
// 여기로 뽑았다.

export const MAX_HISTORY = 20;

// 같은 제스처로 볼 최대 간격(ms). 슬라이더 드래그·키 오토리핏의 이벤트 간격은 수십 ms 다.
// 이보다 벌어지면 손을 뗐다가 다시 한 조작으로 보고 새 칸을 만든다 — 그래야 두 번째
// 드래그가 첫 번째와 합쳐져 "되돌릴 수 없는 변경"이 되는 일이 없다.
export const COALESCE_WINDOW_MS = 600;

export const initHistory = (initialState) => ({
    history: [initialState],
    index: 0,
    // 진행 중인 제스처의 이름과 마지막 커밋 시각. 없으면 null.
    gestureKey: null,
    gestureAt: 0,
});

// 같은 제스처의 연속인가 — 이름이 주어졌고, 직전 커밋과 같은 이름이고, 창 안이다.
export const isSameGesture = (state, gestureKey, now) => (
    !!gestureKey && state.gestureKey === gestureKey && now - state.gestureAt <= COALESCE_WINDOW_MS
);

// 새 상태를 히스토리에 반영한다. gestureKey 가 있으면 같은 제스처의 연속은 칸을 늘리지
// 않고 현재 칸을 덮는다 — 되돌리기 대상은 **제스처가 시작되기 전** 상태로 남는다.
export const pushState = (state, resolvedState, gestureKey = null, now = Date.now()) => {
    const kept = state.history.slice(0, state.index + 1); // 다시실행 꼬리는 버린다
    if (isSameGesture(state, gestureKey, now)) {
        kept[kept.length - 1] = resolvedState;
        return { history: kept, index: kept.length - 1, gestureKey, gestureAt: now };
    }
    const sliced = [...kept, resolvedState].slice(-MAX_HISTORY);
    return { history: sliced, index: sliced.length - 1, gestureKey, gestureAt: now };
};

// 히스토리에 남기지 않는 갱신(드래그 중간 상태·접기 등 시각적 상태) — 현재 칸만 덮는다.
export const replacePresent = (state, resolvedState) => {
    const history = [...state.history];
    history[state.index] = resolvedState;
    return { ...state, history, gestureKey: null, gestureAt: 0 };
};

// 되돌리기/다시실행은 **진행 중인 제스처를 끊는다**. 끊지 않으면 창이 살아 있는 동안
// 도착한 연속 입력이 되돌린 칸을 덮어써서, 되돌린 것이 되돌아오지 않는다.
export const undoState = (state) => (
    state.index > 0 ? { ...state, index: state.index - 1, gestureKey: null, gestureAt: 0 } : state
);

export const redoState = (state) => (
    state.index < state.history.length - 1
        ? { ...state, index: state.index + 1, gestureKey: null, gestureAt: 0 }
        : state
);
