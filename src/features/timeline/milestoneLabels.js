// 마일스톤 라벨을 어디에 놓을지 정하는 순수함수.
//
// 규칙은 사용자가 정한 두 문장이다.
//   ① **auto 는 겹치지 않는다.** 자동 배치가 겹치면 두 글자가 포개져 둘 다 못 읽는다 —
//      가려진 라벨은 "없는 일정"과 구별되지 않는다. 라벨 텍스트가 같든 다르든 마찬가지다.
//   ② **겹침은 수동으로 지정했을 때만 허용한다.** labelPosition 을 손으로 고른 것은
//      "여기에 두겠다"는 선언이므로 그 자리를 먼저 예약하고, auto 는 그것을 피해 간다.
//      수동끼리는 서로 피하지 않는다 — 둘 다 사용자가 고른 자리다.
//
// 겹침 회피는 **층(tier)** 으로 한다. 예전에는 top → bottom → right 세 칸만 시도하고
// 넷째부터는 `'top'` 으로 되돌려 그냥 겹쳐 버렸다(칸이 셋뿐이니 필연이다). 층은 위·아래로
// 번갈아 늘어나므로 빈 칸이 반드시 있다 — n 개가 서로 겹쳐도 층은 최대 ⌈n/2⌉ 이다.
//
// 잘림 방지는 별개의 규칙이다. 겹침을 허용한 수동 라벨도 **잘리는 것은 원하지 않는다**
// (겹쳐서 읽기 어려운 것과, 컨테이너 밖으로 나가 아예 사라지는 것은 다른 문제다).
// 그래서 모든 라벨은 마지막에 [0, containerWidth] 안으로 밀어 넣고(shiftX), 그래도
// 안 들어가면 maxWidth 로 줄여 말줄임표에 맡긴다.

export const LABEL_GAP = 8;        // 마커와 좌/우 라벨 사이 간격
export const LABEL_TIER_STEP = 24; // 층 간격(px) — 라벨 높이보다 넓어야 한다.
//   16px 이던 시절엔 층을 나눠 놓고도 라벨끼리 겹쳤다. 실측 높이는 앱 22px,
//   내보낸 HTML 20px(padding 2px×2 + 줄높이) 이므로 24 는 둘 다 2px 이상 띄운다.
//   "층으로 피한다"는 규칙이 그 차이만큼 거짓이었다.
export const LABEL_BASE_OFFSET = 4;// 0층과 마커 사이
export const LABEL_CHAR_WIDTH = 7; // font-size-xs 기준 한 글자 평균 폭(한글은 더 넓다)
export const LABEL_PADDING = 12;   // .milestone-label 의 좌우 padding 합(2 × 6px)

// `.milestone-marker` 에 걸린 scale — 라벨은 그 자손이므로 실제 화면 폭은 이만큼 줄고,
// 반대로 라벨 안에서 준 px 값은 이만큼 작게 나타난다. 컨테이너 좌표와 라벨 로컬 좌표를
// 오갈 때 이 값을 빼먹으면 클램프가 항상 조금씩 어긋난다.
export const MARKER_SCALE = 0.8;

export const LABEL_POSITIONS = ['top', 'bottom', 'left', 'right'];

// 한글은 라틴 문자보다 넓다. 정확한 측정은 DOM 이 필요하고(그러면 순수함수가 아니다),
// 배치 판정에는 **넉넉한 추정**이 안전하다 — 좁게 잡으면 겹치지 않는다고 판단한 뒤 겹친다.
export function estimateLabelWidth(label) {
    const text = String(label ?? '');
    let raw = LABEL_PADDING;
    for (const ch of text) {
        // 한글/한자/가나 + CJK 기호 구간 (직접 적으면 전각 공백이 섞여 lint 가 막는다)
        raw += /[\u1100-\u11FF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ch)
            ? LABEL_CHAR_WIDTH * 1.6
            : LABEL_CHAR_WIDTH;
    }
    return raw * MARKER_SCALE;
}

// position 별 기준 구간 [start, end] (컨테이너 좌표, shift 적용 전)
function baseInterval(position, x, width) {
    switch (position) {
        case 'left': return [x - LABEL_GAP - width, x - LABEL_GAP];
        case 'right': return [x + LABEL_GAP, x + LABEL_GAP + width];
        default: return [x - width / 2, x + width / 2]; // top/bottom
    }
}

// 구간을 [0, containerWidth] 안으로 밀어 넣는다. 라벨이 컨테이너보다 넓으면 밀어도
// 안 들어가므로, 그때는 왼쪽 끝에 맞추고 maxWidth 로 줄이라고 알린다.
function clampInterval([start, end], containerWidth) {
    const width = end - start;
    if (containerWidth > 0 && width > containerWidth) {
        return { shiftX: -start, maxWidth: containerWidth };
    }
    let shiftX = 0;
    if (start < 0) shiftX = -start;
    else if (containerWidth > 0 && end > containerWidth) shiftX = containerWidth - end;
    return { shiftX, maxWidth: null };
}

// auto 가 시도하는 칸의 순서: 위 0층 → 아래 0층 → 위 1층 → 아래 1층 → …
// 위를 먼저 보는 것은 기존 동작과 같다(라벨은 관습적으로 마커 위에 붙는다).
function* autoSlots() {
    for (let tier = 0; ; tier++) {
        yield { position: 'top', tier };
        yield { position: 'bottom', tier };
    }
}

const slotKey = (position, tier) => `${position}:${tier}`;
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

/**
 * @param {Array<{id, x, label, labelPosition}>} items  화면에 보이는 마일스톤들
 * @param {number} containerWidth  바 컨테이너 폭(px)
 * @returns {Map<string, {position, tier, shiftX, maxWidth}>}
 */
export function placeMilestoneLabels(items, containerWidth) {
    const result = new Map();
    if (!Array.isArray(items) || items.length === 0) return result;

    const prepared = items
        .map(m => ({ ...m, width: estimateLabelWidth(m.label) }))
        .sort((a, b) => a.x - b.x);

    // 칸별 점유 구간. 수동 라벨을 먼저 채운다 — auto 가 피해 갈 대상이기 때문이다.
    const occupied = new Map(); // slotKey -> [{start, end}]
    const reserve = (position, tier, interval) => {
        const key = slotKey(position, tier);
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(interval);
    };

    const manual = prepared.filter(m => m.labelPosition && m.labelPosition !== 'auto');
    const auto = prepared.filter(m => !m.labelPosition || m.labelPosition === 'auto');

    for (const m of manual) {
        const position = LABEL_POSITIONS.includes(m.labelPosition) ? m.labelPosition : 'top';
        const [start, end] = baseInterval(position, m.x, m.width);
        const { shiftX, maxWidth } = clampInterval([start, end], containerWidth);
        result.set(m.id, { position, tier: 0, shiftX, maxWidth });
        reserve(position, 0, { start: start + shiftX, end: end + shiftX });
    }

    for (const m of auto) {
        for (const { position, tier } of autoSlots()) {
            const [start, end] = baseInterval(position, m.x, m.width);
            const { shiftX, maxWidth } = clampInterval([start, end], containerWidth);
            const interval = { start: start + shiftX, end: end + shiftX };
            const taken = occupied.get(slotKey(position, tier)) ?? [];
            if (taken.some(other => overlaps(interval, other))) continue;
            result.set(m.id, { position, tier, shiftX, maxWidth });
            reserve(position, tier, interval);
            break;
        }
    }

    return result;
}

/**
 * 배치 결과를 인라인 스타일로 바꾼다.
 *
 * **네 변(top/bottom/left/right)을 항상 모두 지정한다.** `.milestone-label` 의 CSS 에
 * `top: -24px; left: 50%` 가 있어서, 한쪽만 덮어쓰면 반대쪽 값이 남아 abspos 규칙에 따라
 * 상자가 **늘어난다**(top+bottom 이 둘 다 auto 가 아니면 height 를, left+right 면 width 를
 * 그 사이에 맞춘다). 'left' 라벨이 이 상태였다 — right:100% 를 줬는데 CSS 의 left:50% 가
 * 남아 라벨이 가로로 쭉 늘어났다.
 */
export function milestoneLabelStyle(placement) {
    const { position, tier = 0, shiftX = 0, maxWidth = null } = placement ?? {};
    // 라벨은 scale(0.8) 된 마커 안에 있다 → 컨테이너 px 를 로컬 px 로 되돌린다.
    const localShift = shiftX / MARKER_SCALE;
    const offset = LABEL_BASE_OFFSET + tier * LABEL_TIER_STEP;
    const style = {
        top: 'auto', bottom: 'auto', left: 'auto', right: 'auto',
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
        maxWidth: maxWidth === null ? undefined : `${maxWidth / MARKER_SCALE}px`,
        // 잘리는 대신 말줄임 — nowrap 만 있으면 상자를 넘어서까지 그려진다
        overflow: maxWidth === null ? undefined : 'hidden',
        textOverflow: maxWidth === null ? undefined : 'ellipsis',
    };

    switch (position) {
        case 'left':
            return { ...style, right: '100%', top: '50%', marginRight: `${LABEL_GAP}px`,
                transform: `translateY(-50%) translateX(${localShift}px)` };
        case 'right':
            return { ...style, left: '100%', top: '50%', marginLeft: `${LABEL_GAP}px`,
                transform: `translateY(-50%) translateX(${localShift}px)` };
        case 'bottom':
            return { ...style, top: '100%', left: '50%', marginTop: `${offset}px`,
                transform: `translateX(calc(-50% + ${localShift}px))` };
        case 'top':
        default:
            return { ...style, bottom: '100%', left: '50%', marginBottom: `${offset}px`,
                transform: `translateX(calc(-50% + ${localShift}px))` };
    }
}
