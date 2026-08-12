// 의존성 화살표 SVG 레이어. 좌표 계산은 utils/timelineGeometry.js 가,
// "이 간선을 지금 화면에 어떻게 그릴 수 있는가"는 dependencyLinks.js 가 판정한다.
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
// 끝이 화면에 없어 대표 행으로 끌어올린 선 — 더 촘촘한 점선이라 "이 행 자신의 연결이
// 아니다"가 색 없이도 읽힌다. 어느 자손의 것인지는 툴팁이 이름으로 말한다.
const ROLLED_UP_STYLE = { stroke: '#999', dash: '2 3', width: 2, title: null };
// 화면 밖으로 나가는 연결의 표식. 오류가 아니라 정보라서 빨강/주황을 쓰지 않고,
// 선이 아닌 **원**이라 색을 못 보아도 다른 간선과 구별된다.
const HIDDEN_STYLE = { stroke: '#0ea5e9', width: 2 };
const HIDDEN_STUB = 18; // 보이는 끝에서 화면 밖 방향으로 뻗는 길이(px)

const styleFor = (issue, rolledUp) => ISSUE_STYLES[issue] || (rolledUp ? ROLLED_UP_STYLE : NORMAL_STYLE);
// 화살촉은 marker 라 stroke 를 물려받지 못한다 — 색마다 하나씩 정의해 두고 골라 쓴다.
const markerId = (stroke) => `arrowhead-${stroke.replace('#', '')}`;

const joinTitle = (parts) => parts.filter(Boolean).join('\n');

function DependencyLayer({ links, hiddenEdges, rowCount, dateRange, contentWidth, rowHeight, edgeIssues }) {
    const totalDays = dateUtils.getDuration(dateRange.start, dateRange.end);
    const strokes = [NORMAL_STYLE.stroke, HIDDEN_STYLE.stroke, ...Object.values(ISSUE_STYLES).map(s => s.stroke)];

    return (
        <svg
            className="dependency-layer"
            style={{ width: contentWidth, height: rowCount * rowHeight }}
        >
            <defs>
                {[...new Set(strokes)].map(stroke => (
                    <marker
                        key={stroke}
                        id={markerId(stroke)}
                        markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"
                    >
                        <polygon points="0 0, 10 3.5, 0 7" fill={stroke} />
                    </marker>
                ))}
            </defs>
            {links.map(({ source, target, rolledUpNames }) => {
                const from = itemAnchor(source, 'end', dateRange, totalDays, contentWidth, rowHeight);
                const to = itemAnchor(target, 'start', dateRange, totalDays, contentWidth, rowHeight);
                const issue = edgeIssues?.[dependencyEdgeKey(source.data.id, target.data.id)];
                const rolledUp = rolledUpNames.length > 0;
                const style = styleFor(issue, rolledUp);
                return (
                    <path
                        key={`${source.data.id}-${target.data.id}`}
                        data-testid={issue ? `dependency-${issue}` : 'dependency-ok'}
                        data-rolled-up={rolledUp ? 'true' : undefined}
                        d={dependencyPath(from.x, from.y, to.x, to.y)}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={style.width}
                        strokeDasharray={style.dash || undefined}
                        markerEnd={`url(#${markerId(style.stroke)})`}
                    >
                        {(style.title || rolledUp) && (
                            <title>
                                {joinTitle([
                                    style.title,
                                    rolledUp && `접힌 곳의 연결 — ${rolledUpNames.join(', ')}`,
                                ])}
                            </title>
                        )}
                    </path>
                );
            })}
            {hiddenEdges.map(({ item, edge, names }) => {
                const anchor = itemAnchor(item, edge, dateRange, totalDays, contentWidth, rowHeight);
                // 나가는 쪽(edge='end')은 오른쪽으로, 들어오는 쪽은 왼쪽으로 뻗는다.
                // 왼쪽 끝에 붙은 바에서 음수로 나가면 잘려 보이지 않으므로 0 앞에서 멈춘다.
                const outer = edge === 'end'
                    ? anchor.x + HIDDEN_STUB
                    : Math.max(3, anchor.x - HIDDEN_STUB);
                return (
                    <g key={`${item.data.id}-${edge}-hidden`} data-testid="dependency-hidden">
                        <line
                            x1={edge === 'end' ? anchor.x : outer}
                            y1={anchor.y}
                            x2={edge === 'end' ? outer : anchor.x}
                            y2={anchor.y}
                            stroke={HIDDEN_STYLE.stroke}
                            strokeWidth={HIDDEN_STYLE.width}
                            strokeDasharray="3 2"
                            markerEnd={edge === 'start' ? `url(#${markerId(HIDDEN_STYLE.stroke)})` : undefined}
                        />
                        <circle cx={outer} cy={anchor.y} r="3.5" fill={HIDDEN_STYLE.stroke} />
                        <title>{`화면 밖의 연결 — ${names.join(', ')}`}</title>
                    </g>
                );
            })}
        </svg>
    );
}

export default DependencyLayer;
