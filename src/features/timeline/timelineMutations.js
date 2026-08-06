// 타임라인 드래그의 결과를 "무엇을 어떻게 바꿀지" 목록으로 계산하는 순수 함수들.
//
// 반환값은 항상 `[{ taskId, updates }]` — 호출부는 그대로 onUpdateTasks 에 넘긴다.
// 여러 작업이 바뀌어도 undo 한 번에 되돌아가야 하므로 개별 호출로 쪼개면 안 된다.
//
// 이 로직이 TimelineView.jsx 안에 있을 때는 "복사인가 이동인가 / 같은 작업인가
// 다른 작업인가" 네 경우가 주석으로만 구분돼 있었고 도달 불가능한 분기도 섞여 있었다.
import { dateUtils } from '../../utils/dateUtils';
import { generateId } from '../../utils/dataModel';

// 기간 목록에서 작업의 전체 시작/종료일을 다시 구한다. 기간이 없으면 null (바 없음).
const boundsOf = (ranges) => {
    if (ranges.length === 0) return { startDate: null, endDate: null };
    const dates = ranges.flatMap(r => [new Date(r.startDate), new Date(r.endDate)]);
    return {
        startDate: dateUtils.formatDate(new Date(Math.min(...dates))),
        endDate: dateUtils.formatDate(new Date(Math.max(...dates))),
    };
};

const withRanges = (task, ranges) => ({
    taskId: task.id,
    updates: { timeRanges: ranges, ...boundsOf(ranges) },
});

// 기간(바) 드래그 결과.
//   targetTask: 다른 작업 행에 떨어뜨렸으면 그 작업, 아니면 null
//   isCopyMode: Ctrl 을 누른 채 드래그 → 원본을 남긴다
export const planRangeDrop = ({ sourceTask, targetTask, rangeId, startDate, endDate, isCopyMode }) => {
    if (!sourceTask) return [];

    const start = dateUtils.formatDate(startDate);
    const end = dateUtils.formatDate(endDate);
    const sourceRanges = sourceTask.timeRanges || [];
    const crossTask = !!targetTask && targetTask.id !== sourceTask.id;

    // 같은 작업 안에서의 단순 이동 — 해당 기간의 날짜만 바꾼다
    if (!crossTask && !isCopyMode) {
        // timeRanges 가 없는 레거시 작업은 rangeId 'legacy' 로 들어온다
        const base = sourceRanges.length > 0
            ? [...sourceRanges]
            : [{ id: 'legacy', startDate: sourceTask.startDate, endDate: sourceTask.endDate }];
        const index = base.findIndex(r => r.id === rangeId);
        if (index >= 0) base[index] = { ...base[index], startDate: start, endDate: end };
        else if (rangeId === 'legacy') return [withRanges(sourceTask, [{ id: generateId(), startDate: start, endDate: end }])];
        return [withRanges(sourceTask, base)];
    }

    const moving = sourceRanges.find(r => r.id === rangeId)
        ?? (rangeId === 'legacy'
            ? { id: generateId(), startDate: sourceTask.startDate, endDate: sourceTask.endDate }
            : null);
    if (!moving) return [];

    const dropped = {
        ...moving,
        id: isCopyMode ? generateId() : moving.id, // 복사는 새 id — 같은 id 두 개는 트리 헬퍼를 망친다
        startDate: start,
        endDate: end,
        color: moving.color || sourceTask.color,
    };

    // 같은 작업에 복사 — 원본을 그대로 두고 하나 더 붙인다
    if (!crossTask) return [withRanges(sourceTask, [...sourceRanges, dropped])];

    const updates = [];
    if (!isCopyMode) {
        updates.push(withRanges(sourceTask, sourceRanges.filter(r => String(r.id) !== String(rangeId))));
    }
    updates.push(withRanges(targetTask, [...(targetTask.timeRanges || []), dropped]));
    return updates;
};

// 마일스톤 드래그 결과. 규칙은 기간과 같다.
export const planMilestoneDrop = ({ sourceTask, targetTask, milestoneId, date, isCopyMode }) => {
    if (!sourceTask || !sourceTask.milestones) return [];
    const milestone = sourceTask.milestones.find(m => m.id === milestoneId);
    if (!milestone) return [];

    const crossTask = !!targetTask && targetTask.id !== sourceTask.id;

    if (!crossTask && !isCopyMode) {
        return [{
            taskId: sourceTask.id,
            updates: {
                milestones: sourceTask.milestones.map(m => (m.id === milestoneId ? { ...m, date } : m)),
            },
        }];
    }

    const dropped = { ...milestone, id: isCopyMode ? generateId() : milestone.id, date };

    if (!crossTask) {
        return [{ taskId: sourceTask.id, updates: { milestones: [...sourceTask.milestones, dropped] } }];
    }

    const updates = [];
    if (!isCopyMode) {
        updates.push({
            taskId: sourceTask.id,
            updates: { milestones: sourceTask.milestones.filter(m => m.id !== milestoneId) },
        });
    }
    updates.push({
        taskId: targetTask.id,
        updates: { milestones: [...(targetTask.milestones || []), dropped] },
    });
    return updates;
};
