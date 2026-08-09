// 의존성 화살표 SVG 레이어. 좌표 계산은 utils/timelineGeometry.js 가 한다.
import React from 'react';
import { dateUtils } from '../../utils/dateUtils';
import { dependencyEdgeKey } from '../../utils/taskTree';
import { itemAnchor, dependencyPath } from './timelineGeometry';

// 문제 있는 간선의 표현. 색만으로 구분하지 않는다 — 실선/점선과 hover 설명을 함께 준다
// (§5.3 접근성: 색 단독 인코딩 금지). 판정은 taskTree.js 의 findDependencyIssues 가 한다.
const ISSUE_STYLES = {
    cycle: { stroke: '#dc2626', dash: null, width: 2.5, title: '순환 의존성 — 이 연결이 고리를 닫는다' },
    overlap: { stroke: '#f59e0b', dash: '6 3', width: 2.5, title: '일정 위반 — 후행이 선행 종료보다 먼저 시작한다' },
};
const NORMAL_STYLE = { stroke: '#999', dash: '4 2', width: 2, title: null };
const styleFor = (issue) => ISSUE_STYLES[issue] || NORMAL_STYLE;
// 화살촉은 marker 라 stroke 를 물려받지 못한다 — 색마다 하나씩 정의해 두고 골라 쓴다.
const markerId = (stroke) => `arrowhead-${stroke.replace('#', '')}`;

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

function DependencyLayer({ flatTasks, itemMap, dateRange, contentWidth, rowHeight, edgeIssues }) {
    const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
    const strokes = [NORMAL_STYLE.stroke, ...Object.values(ISSUE_STYLES).map(s => s.stroke)];

    return (
        <svg
            className="dependency-layer"
            style={{ width: contentWidth, height: flatTasks.length * rowHeight }}
        >
            <defs>
                {strokes.map(stroke => (
                    <marker
                        key={stroke}
                        id={markerId(stroke)}
                        markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"
                    >
                        <polygon points="0 0, 10 3.5, 0 7" fill={stroke} />
                    </marker>
                ))}
            </defs>
            {collectLinks(flatTasks, itemMap).map(({ source, target }) => {
                const from = itemAnchor(source, 'end', dateRange, totalDays, contentWidth, rowHeight);
                const to = itemAnchor(target, 'start', dateRange, totalDays, contentWidth, rowHeight);
                const issue = edgeIssues?.[dependencyEdgeKey(source.data.id, target.data.id)];
                const style = styleFor(issue);
                return (
                    <path
                        key={`${source.data.id}-${target.data.id}`}
                        data-testid={issue ? `dependency-${issue}` : 'dependency-ok'}
                        d={dependencyPath(from.x, from.y, to.x, to.y)}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={style.width}
                        strokeDasharray={style.dash || undefined}
                        markerEnd={`url(#${markerId(style.stroke)})`}
                    >
                        {style.title && <title>{style.title}</title>}
                    </path>
                );
            })}
        </svg>
    );
}

export default DependencyLayer;
