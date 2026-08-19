import { describe, it, expect } from 'vitest';
import {
    placeMilestoneLabels, milestoneLabelStyle, estimateLabelWidth,
    LABEL_GAP, LABEL_TIER_STEP, LABEL_BASE_OFFSET, MARKER_SCALE,
    labelHeadroom, HEADROOM_FLOOR,
} from '../../src/features/timeline/milestoneLabels.js';

const WIDTH = 1000;
const ms = (id, x, label = 'M', labelPosition = undefined) => ({ id, x, label, labelPosition });

// 두 라벨이 실제로 같은 칸에서 겹치는지 — 배치 결과를 다시 구간으로 환산해서 본다.
function intervalOf(item, placement) {
    const w = estimateLabelWidth(item.label);
    const { position, shiftX } = placement;
    if (position === 'left') return [item.x - LABEL_GAP - w + shiftX, item.x - LABEL_GAP + shiftX];
    if (position === 'right') return [item.x + LABEL_GAP + shiftX, item.x + LABEL_GAP + w + shiftX];
    return [item.x - w / 2 + shiftX, item.x + w / 2 + shiftX];
}

function findOverlaps(items, placements) {
    const bad = [];
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            const a = placements.get(items[i].id);
            const b = placements.get(items[j].id);
            if (a.position !== b.position || a.tier !== b.tier) continue;
            const [as, ae] = intervalOf(items[i], a);
            const [bs, be] = intervalOf(items[j], b);
            if (as < be && ae > bs) bad.push([items[i].id, items[j].id]);
        }
    }
    return bad;
}

describe('placeMilestoneLabels — auto 는 겹치지 않는다', () => {
    it('떨어져 있으면 둘 다 위 0층에 둔다 (층을 낭비하지 않는다)', () => {
        const items = [ms('a', 100), ms('b', 500)];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.get('a')).toMatchObject({ position: 'top', tier: 0 });
        expect(p.get('b')).toMatchObject({ position: 'top', tier: 0 });
    });

    it('붙어 있으면 두 번째를 아래로 내린다', () => {
        const items = [ms('a', 100, '기획 완료'), ms('b', 105, '설계 완료')];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.get('a')).toMatchObject({ position: 'top', tier: 0 });
        expect(p.get('b')).toMatchObject({ position: 'bottom', tier: 0 });
        expect(findOverlaps(items, p)).toEqual([]);
    });

    it('같은 자리에 여섯 개가 몰려도 하나도 겹치지 않는다', () => {
        // 예전에는 칸이 top/bottom/right 셋뿐이라 넷째부터 top 으로 되돌려 그냥 겹쳤다.
        const items = Array.from({ length: 6 }, (_, i) => ms(`m${i}`, 500 + i, `마일스톤 ${i}`));
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.size).toBe(6);
        expect(findOverlaps(items, p)).toEqual([]);
        // 위·아래를 번갈아 쓰므로 층은 3층 이내로 끝난다
        expect(Math.max(...items.map(i => p.get(i.id).tier))).toBeLessThanOrEqual(2);
    });

    it('라벨 텍스트가 같아도 다르게 배치한다 (같은 이름이라 겹쳐도 된다는 규칙은 없다)', () => {
        const items = [ms('a', 300, '검토'), ms('b', 302, '검토')];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.get('a').tier === p.get('b').tier && p.get('a').position === p.get('b').position).toBe(false);
    });

    it('긴 라벨은 더 넓은 자리를 차지한다 (짧은 라벨 기준으로 판정하면 겹친다)', () => {
        const short = estimateLabelWidth('M');
        const long = estimateLabelWidth('아주 긴 마일스톤 이름입니다');
        expect(long).toBeGreaterThan(short * 5);
    });
});

describe('placeMilestoneLabels — 수동 지정은 그 자리를 지킨다', () => {
    it('수동으로 고른 위치는 그대로 쓴다', () => {
        const p = placeMilestoneLabels([ms('a', 400, '출시', 'left')], WIDTH);
        expect(p.get('a').position).toBe('left');
    });

    it('auto 는 수동이 예약한 자리를 피한다', () => {
        const items = [ms('a', 500, '출시', 'top'), ms('b', 503, '점검')];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.get('a')).toMatchObject({ position: 'top', tier: 0 });
        expect(p.get('b').position === 'top' && p.get('b').tier === 0).toBe(false);
        expect(findOverlaps(items, p)).toEqual([]);
    });

    it('수동끼리는 겹쳐도 둔다 — 겹침을 허용하는 유일한 경로다', () => {
        const items = [ms('a', 500, '출시', 'top'), ms('b', 503, '점검', 'top')];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(p.get('a')).toMatchObject({ position: 'top', tier: 0 });
        expect(p.get('b')).toMatchObject({ position: 'top', tier: 0 });
        expect(findOverlaps(items, p).length).toBe(1);
    });

    it("labelPosition: 'auto' 는 수동이 아니다", () => {
        const items = [ms('a', 500, '출시', 'auto'), ms('b', 503, '점검', 'auto')];
        const p = placeMilestoneLabels(items, WIDTH);
        expect(findOverlaps(items, p)).toEqual([]);
    });

    it('알 수 없는 값은 top 으로 떨어진다 (빈 화면을 만들지 않는다)', () => {
        const p = placeMilestoneLabels([ms('a', 400, '출시', 'diagonal')], WIDTH);
        expect(p.get('a').position).toBe('top');
    });
});

describe('placeMilestoneLabels — 화면 밖으로 잘리지 않는다', () => {
    it('왼쪽 끝의 라벨을 오른쪽으로 밀어 넣는다', () => {
        const items = [ms('a', 0, '착수')];
        const p = placeMilestoneLabels(items, WIDTH);
        const [start] = intervalOf(items[0], p.get('a'));
        expect(p.get('a').shiftX).toBeGreaterThan(0);
        expect(start).toBeGreaterThanOrEqual(-0.001);
    });

    it('오른쪽 끝의 라벨을 왼쪽으로 당긴다', () => {
        const items = [ms('a', WIDTH, '최종 마감')];
        const p = placeMilestoneLabels(items, WIDTH);
        const [, end] = intervalOf(items[0], p.get('a'));
        expect(p.get('a').shiftX).toBeLessThan(0);
        expect(end).toBeLessThanOrEqual(WIDTH + 0.001);
    });

    it("수동 'right' 라벨도 오른쪽 끝에서 당겨 온다 — 겹침 허용이 잘림 허용은 아니다", () => {
        const items = [ms('a', WIDTH - 5, '릴리스 준비', 'right')];
        const p = placeMilestoneLabels(items, WIDTH);
        const [, end] = intervalOf(items[0], p.get('a'));
        expect(end).toBeLessThanOrEqual(WIDTH + 0.001);
    });

    it("수동 'left' 라벨도 왼쪽 끝에서 밀어 낸다", () => {
        const items = [ms('a', 5, '킥오프 미팅', 'left')];
        const p = placeMilestoneLabels(items, WIDTH);
        const [start] = intervalOf(items[0], p.get('a'));
        expect(start).toBeGreaterThanOrEqual(-0.001);
    });

    it('컨테이너보다 긴 라벨은 왼쪽에 맞추고 maxWidth 로 줄인다', () => {
        const p = placeMilestoneLabels([ms('a', 50, '아주 긴 이름을 가진 마일스톤 라벨 텍스트입니다 정말로')], 120);
        expect(p.get('a').maxWidth).toBe(120);
        expect(p.get('a').shiftX).toBeGreaterThan(0);
    });

    it('containerWidth 를 모르면(0) 왼쪽만 지킨다 — 오른쪽 끝이 어디인지 알 수 없다', () => {
        // 첫 렌더에는 컨테이너 폭이 아직 0 이다. 왼쪽 끝(0)은 폭과 무관하게 아는 값이므로
        // 왼쪽 잘림은 그때도 막고, 오른쪽 클램프와 maxWidth 는 판단을 보류한다.
        const left = placeMilestoneLabels([ms('a', 0, '착수')], 0);
        expect(left.get('a').shiftX).toBeGreaterThan(0);
        expect(left.get('a').maxWidth).toBeNull();

        const right = placeMilestoneLabels([ms('a', 5000, '착수')], 0);
        expect(right.get('a').shiftX).toBe(0);
        expect(right.get('a').maxWidth).toBeNull();
    });
});

describe('placeMilestoneLabels — 입력 방어', () => {
    it('빈 목록/비배열은 빈 Map', () => {
        expect(placeMilestoneLabels([], WIDTH).size).toBe(0);
        expect(placeMilestoneLabels(null, WIDTH).size).toBe(0);
        expect(placeMilestoneLabels(undefined, WIDTH).size).toBe(0);
    });

    it('라벨이 비어 있어도 자리를 준다', () => {
        const p = placeMilestoneLabels([ms('a', 100, '')], WIDTH);
        expect(p.get('a').position).toBe('top');
    });
});

describe('milestoneLabelStyle — 네 변을 모두 지정한다', () => {
    for (const position of ['top', 'bottom', 'left', 'right']) {
        it(`${position}: top/bottom/left/right 가 모두 값을 갖는다`, () => {
            // 한쪽만 주면 CSS 의 `top: -24px; left: 50%` 가 남아 상자가 늘어난다.
            const style = milestoneLabelStyle({ position, tier: 0, shiftX: 0, maxWidth: null });
            for (const side of ['top', 'bottom', 'left', 'right']) {
                expect(style[side], `${position} → ${side}`).toBeDefined();
            }
        });
    }

    it('층이 올라가면 마커에서 더 멀어진다', () => {
        const t0 = milestoneLabelStyle({ position: 'top', tier: 0, shiftX: 0 });
        const t2 = milestoneLabelStyle({ position: 'top', tier: 2, shiftX: 0 });
        expect(t0.marginBottom).toBe(`${LABEL_BASE_OFFSET}px`);
        expect(t2.marginBottom).toBe(`${LABEL_BASE_OFFSET + 2 * LABEL_TIER_STEP}px`);
    });

    it('shiftX 는 마커의 scale 을 되돌려서 적용한다', () => {
        const style = milestoneLabelStyle({ position: 'top', tier: 0, shiftX: 8 });
        expect(style.transform).toContain(`${8 / MARKER_SCALE}px`);
    });

    it('maxWidth 가 있으면 말줄임 처리를 함께 켠다', () => {
        const style = milestoneLabelStyle({ position: 'top', tier: 0, shiftX: 0, maxWidth: 100 });
        expect(style.maxWidth).toBe(`${100 / MARKER_SCALE}px`);
        expect(style.textOverflow).toBe('ellipsis');
        expect(style.overflow).toBe('hidden');
    });

    it('maxWidth 가 없으면 말줄임을 켜지 않는다 (짧은 라벨을 괜히 자르지 않게)', () => {
        const style = milestoneLabelStyle({ position: 'top', tier: 0, shiftX: 0, maxWidth: null });
        expect(style.maxWidth).toBeUndefined();
        expect(style.textOverflow).toBeUndefined();
    });

    it('배치 정보가 없어도 top 스타일을 돌려준다', () => {
        expect(milestoneLabelStyle(undefined).bottom).toBe('100%');
    });
});

// 층은 세로 겹침을 없애기 위한 것이다 — 간격이 라벨보다 좁으면 층을 나눠 놓고도 겹친다.
// 실측: 앱 22px, 내보낸 HTML 20px (padding 2px×2 + 줄높이). 브라우저에서 재어 확인했다.
describe('LABEL_TIER_STEP 은 실제 라벨 높이보다 넓다', () => {
    const MEASURED_LABEL_HEIGHT = 22;

    it('층 간격이 라벨 높이 이상이다', () => {
        expect(LABEL_TIER_STEP).toBeGreaterThanOrEqual(MEASURED_LABEL_HEIGHT);
    });

    it('이웃한 두 층의 라벨 상자가 서로 닿지 않는다', () => {
        const t0 = LABEL_BASE_OFFSET;
        const t1 = LABEL_BASE_OFFSET + LABEL_TIER_STEP;
        // 0층 라벨의 바깥 끝 ↔ 1층 라벨의 안쪽 끝
        expect(t1 - (t0 + MEASURED_LABEL_HEIGHT)).toBeGreaterThan(0);
    });
});


// 층은 위로 무한히 쌓이는데 그 위에 비워 두는 자리는 42px(1층) 상수였다 — "auto 는 겹치지
// 않는다"를 지킬수록 라벨이 sticky 한 날짜 헤더를 더 침범하는 모순이 있었다. 여백은 실제로
// 쌓인 층수를 따라간다.
describe('labelHeadroom — 여백이 실제 층수를 따라간다', () => {
    const headroomFor = (count) => {
        // 같은 x 에 몰아넣으면 층이 강제로 쌓인다(위·아래 번갈아 → n 개면 ⌈n/2⌉ 층)
        const items = Array.from({ length: count }, (_, i) => ms(`m${i}`, 500, `마일스톤 ${i}`));
        return labelHeadroom(placeMilestoneLabels(items, WIDTH));
    };

    it('라벨이 없으면 바닥값 그대로다', () => {
        expect(labelHeadroom(placeMilestoneLabels([], WIDTH))).toBe(HEADROOM_FLOOR);
    });

    it('1층까지는 바닥값으로 충분하다', () => {
        expect(headroomFor(1)).toBe(HEADROOM_FLOOR);
        expect(headroomFor(3)).toBe(HEADROOM_FLOOR); // 위 0·1층, 아래 0층
    });

    it('2층이 생기면(라벨 5개가 겹칠 때) 여백이 한 층만큼 늘어난다', () => {
        expect(headroomFor(5)).toBe(HEADROOM_FLOOR + LABEL_TIER_STEP);
        expect(headroomFor(7)).toBe(HEADROOM_FLOOR + 2 * LABEL_TIER_STEP);
    });

    it('여백은 줄어들지 않는다 — 라벨 하나를 옮길 때마다 화면이 뛰면 안 된다', () => {
        expect(headroomFor(9)).toBeGreaterThan(headroomFor(1));
        expect(headroomFor(1)).toBeGreaterThanOrEqual(HEADROOM_FLOOR);
    });

    it('아래로만 내려간 라벨은 위쪽 여백을 요구하지 않는다', () => {
        const items = Array.from({ length: 5 }, (_, i) => ms(`m${i}`, 500, `아래 ${i}`, 'bottom'));
        expect(labelHeadroom(placeMilestoneLabels(items, WIDTH))).toBe(HEADROOM_FLOOR);
    });

    it('여백은 2층 라벨의 윗변보다 높다 (헤더를 덮지 않는다)', () => {
        // 행 중앙 기준 라벨 윗변 = 마커 반높이 10 + 기준 4 + 층 × 24 + 라벨 22
        const topOfTier2 = 10 + LABEL_BASE_OFFSET + 2 * LABEL_TIER_STEP + 22;
        expect(headroomFor(5) + 20).toBeGreaterThanOrEqual(topOfTier2); // +20 = 행 반높이
    });
});
