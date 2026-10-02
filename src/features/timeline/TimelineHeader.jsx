import { useMemo } from 'react';
import { dateUtils } from '../../utils/dateUtils';
import { monthGridLines } from './timelineGeometry';
import './TimelineHeader.css';

function TimelineHeader({ startDate, endDate, timeScale, containerWidth, showToday = true, singleAxis = false, onClick }) {
    // 월별 또는 분기별 범위 생성
    const timeUnits = useMemo(() => {
        if (timeScale === 'monthly') {
            return dateUtils.generateMonthRange(startDate, endDate);
        } else {
            return dateUtils.generateQuarterRange(startDate, endDate);
        }
    }, [startDate, endDate, timeScale]);

    const totalDays = dateUtils.getDuration(startDate, endDate);

    // 각 시간 단위의 너비 계산
    const getUnitWidth = (unit) => {
        let unitStart, unitEnd;

        if (timeScale === 'monthly') {
            unitStart = dateUtils.getMonthStart(unit.year, unit.month);
            unitEnd = dateUtils.getMonthEnd(unit.year, unit.month);
        } else {
            unitStart = dateUtils.getQuarterStart(unit.year, unit.quarter);
            unitEnd = dateUtils.getQuarterEnd(unit.year, unit.quarter);
        }

        // 뷰 범위 내에서만 계산
        const clampedStart = unitStart < startDate ? startDate : unitStart;
        const clampedEnd = unitEnd > endDate ? endDate : unitEnd;

        const days = dateUtils.getDuration(clampedStart, clampedEnd);
        return (days / totalDays) * containerWidth;
    };

    // 년도별로 그룹화
    const yearGroups = useMemo(() => {
        const groups = {};
        let offsetAccumulated = 0;

        timeUnits.forEach((unit) => {
            const year = unit.year;
            const width = getUnitWidth(unit);

            if (!groups[year]) {
                groups[year] = {
                    year,
                    width: 0,
                    offset: offsetAccumulated,
                    units: []
                };
            }

            groups[year].width += width;
            groups[year].units.push({
                ...unit,
                width
            });

            offsetAccumulated += width;
        });

        return Object.values(groups);
    }, [timeUnits, containerWidth, startDate, endDate, totalDays]);

    // 오늘 날짜 마커 위치 계산
    const todayPosition = useMemo(() => {
        if (!showToday) return null; // 오늘 보기 꺼져있으면 계산 안함
        const today = new Date();
        if (today < startDate || today > endDate) return null;

        const days = dateUtils.getDaysBetween(startDate, today);
        return (days / totalDays) * containerWidth;
    }, [startDate, endDate, totalDays, containerWidth, showToday]);

    // 한 줄 머리글(SOW 테마): 'YYYY.MM' 만, 연도 행 없음. 위치는 본문의 월 격자와 같은
    // monthGridLines 에서 온다. 달이 46px 보다 좁으면 분기 첫 달에만 라벨을 단다(트래커 규칙).
    // 판정은 축 전체에 한 번 — 달마다 재면 31일 달만 라벨이 붙어 들쭉날쭉해진다.
    if (singleAxis) {
        const lines = monthGridLines({ start: startDate, end: endDate }, containerWidth);
        const sparse = lines.length > 0 && containerWidth / lines.length < 46;
        return (
            <div className="timeline-header single-axis" onClick={onClick}>
                <div className="timeline-units" style={{ width: containerWidth }}>
                    {lines.map(line => (
                        <div
                            key={`${line.year}-${line.month}`}
                            className="timeline-unit"
                            style={{ left: `${line.x}px`, width: `${line.width}px` }}
                        >
                            {(!sparse || line.month % 3 === 1) && (
                                <span className="unit-label">{`${line.year}.${String(line.month).padStart(2, '0')}`}</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="timeline-header" onClick={onClick}>
            {/* 년도 행 */}
            <div className="timeline-years" style={{ width: containerWidth }}>
                {yearGroups.map((yearGroup, index) => (
                    <div
                        key={index}
                        className="timeline-year"
                        style={{
                            width: `${yearGroup.width}px`,
                            left: `${yearGroup.offset}px`
                        }}
                    >
                        <span className="year-label">{yearGroup.year}</span>
                    </div>
                ))}
            </div>

            {/* 월/분기 행 */}
            <div className="timeline-units" style={{ width: containerWidth }}>
                {timeUnits.map((unit, index) => (
                    <div
                        key={index}
                        className="timeline-unit"
                        style={{ width: `${getUnitWidth(unit)}px` }}
                    >
                        <span className="unit-label">
                            {timeScale === 'monthly' ? `${unit.month}월` : `Q${unit.quarter}`}
                        </span>
                    </div>
                ))}
            </div>


        </div>
    );
}

export default TimelineHeader;
