// 의존성 화살표 SVG 레이어. 좌표 계산은 utils/timelineGeometry.js 가 한다.
import React from 'react';
import { dateUtils } from '../../utils/dateUtils';
import { itemAnchor, dependencyPath } from './timelineGeometry';

// 의존성이 걸린 (선행, 후행) 쌍을 모은다 — 기간 단위와 마일스톤 단위 둘 다.
// 작업 단위 의존성(task.dependencies)은 레거시라 선행으로만 등장한다.
const collectLinks = (flatTasks, itemMap) => {
    const links = [];
    const add = (dependencies, targetId) => {
        (dependencies || []).forEach(depId => {
            const source = itemMap.get(depId);
            const target = itemMap.get(targetId);
            if (source && target) links.push({ source, target });
        });
    };
    flatTasks.forEach(task => {
        (task.timeRanges || []).forEach(range => add(range.dependencies, range.id));
        (task.milestones || []).forEach(ms => add(ms.dependencies, ms.id));
    });
    return links;
};

function DependencyLayer({ flatTasks, itemMap, dateRange, contentWidth, rowHeight }) {
    const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);

    return (
        <svg
            className="dependency-layer"
            style={{ width: contentWidth, height: flatTasks.length * rowHeight }}
        >
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
                </marker>
            </defs>
            {collectLinks(flatTasks, itemMap).map(({ source, target }) => {
                const from = itemAnchor(source, 'end', dateRange, totalDays, contentWidth, rowHeight);
                const to = itemAnchor(target, 'start', dateRange, totalDays, contentWidth, rowHeight);
                return (
                    <path
                        key={`${source.data.id}-${target.data.id}`}
                        d={dependencyPath(from.x, from.y, to.x, to.y)}
                        fill="none"
                        stroke="#999"
                        strokeWidth="2"
                        strokeDasharray="4 2"
                        markerEnd="url(#arrowhead)"
                    />
                );
            })}
        </svg>
    );
}

export default DependencyLayer;
