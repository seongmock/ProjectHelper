// 접힌 행의 숨은 마일스톤에 **자리가 있을 때만** 라벨을 단다 — 순수함수.
//
// 자리는 0층(마커 바로 위 또는 바로 아래) 하나다. 층을 쌓으면 접은 행의 라벨이 아래 행들까지 덮는다.
// 자리를 못 찾은 라벨은 그리지 않고 툴팁에만 남는다(라벨 겹침에 대해 정해 둔 규칙과 같다).
//
// 판정은 **화면 전체를 위에서 아래로 한 번에** 한다. 행마다 따로 정하던 첫 구현은 그 행 안에서만 겹침을
// 피해서, 한 행의 아래 라벨과 다음 행의 위 라벨이 두 행 사이의 같은 띠에 포개졌다. 그래서 한 행은
//   · 그 행 자신의 라벨(모든 층)
//   · 바로 위 행이 **아래**에 단 0층 라벨(자신의 것 + 숨은 것)  → 내 '위' 칸과 같은 띠
//   · 바로 아래 행이 **위**에 단 0층 자신의 라벨              → 내 '아래' 칸과 같은 띠
// 을 피한다. 아래 행의 숨은 라벨은 그 행 차례에 내 아래 라벨을 피하므로 순서만 지키면 된다.
// 이미 그려지던 일반 마일스톤 라벨끼리의 행 사이 겹침은 그대로다 — 여기서는 새로 다는 라벨이 겹침을
// 보태지 않는 것만 보장한다.
import { dateUtils } from '../../utils/dateUtils';
import { placeMilestoneLabels } from './milestoneLabels';
import { isDateInRange, milestoneLabelText } from './timelineGeometry';

// 한 행의 숨은 마일스톤 → 배치 입력. x 는 TimelineBar 의 마커와 같은 환산이다.
export const rollupMilestoneItems = (rollup, dateRange, contentWidth, showDates) => {
    if (!rollup?.milestones?.length || !contentWidth) return [];
    const totalDays = dateUtils.getDaysBetween(dateRange.start, dateRange.end);
    return rollup.milestones
        .filter(ms => isDateInRange(ms.date, dateRange))
        .map(ms => ({
            id: ms.id,
            ms,
            label: milestoneLabelText(ms, showDates),
            x: (dateUtils.getDaysBetween(dateRange.start, ms.date) / totalDays) * contentWidth,
        }));
};

const zeroTier = (placements, position) =>
    [...placements.values()].filter(p => p.position === position && (p.tier ?? 0) === 0);

/**
 * @param {Array<{id, own, hidden}>} rows  화면 순서의 행. own = 그 행 자신의 마일스톤(visibleMilestoneItems),
 *   hidden = 숨은 마일스톤(rollupMilestoneItems) — 접히지 않은 행은 빈 배열.
 * @returns {Map<rowId, Map<milestoneId, placement>>}  라벨을 달 숨은 마일스톤만 들어 있다
 */
export const planRollupLabels = (rows, containerWidth) => {
    const result = new Map();
    // 자신의 라벨 배치는 TimelineBar 와 같은 입력·같은 옵션이라 같은 답이다(첫 행은 아래로만 쌓는다)
    const own = rows.map((row, i) => placeMilestoneLabels(row.own, containerWidth, { preferBelow: i === 0 }));
    let aboveBand = []; // 바로 위 행이 아래에 단 0층 라벨

    rows.forEach((row, i) => {
        let placed = new Map();
        if (row.hidden?.length) {
            const belowBand = i + 1 < rows.length ? zeroTier(own[i + 1], 'top') : [];
            placed = placeMilestoneLabels(row.hidden, containerWidth, {
                // 첫 행 위는 sticky 날짜 머리글 밑이다 — 아래만 쓴다
                positions: i === 0 ? ['bottom'] : ['top', 'bottom'],
                maxTier: 0,
                reserved: [
                    ...own[i].values(),
                    ...aboveBand.map(p => ({ ...p, position: 'top', tier: 0 })),
                    ...belowBand.map(p => ({ ...p, position: 'bottom', tier: 0 })),
                ],
            });
            result.set(row.id, placed);
        }
        aboveBand = [...zeroTier(own[i], 'bottom'), ...zeroTier(placed, 'bottom')];
    });
    return result;
};
