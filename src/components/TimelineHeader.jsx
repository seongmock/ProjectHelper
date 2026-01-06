import { useMemo } from 'react';
import { dateUtils } from '../utils/dateUtils';
import './TimelineHeader.css';

function TimelineHeader({ startDate, endDate, timeScale, containerWidth }) {
    // 월별 또는 분기별 범위 생성
    const timeUnits = useMemo(() => {
        if (timeScale === 'monthly') {
            return dateUtils.generateMonthRange(startDate, endDate);
        } else {
            return dateUtils.generateQuarterRange(startDate, endDate);
        }
    }, [startDate, endDate, timeScale]);

    const totalDays = dateUtils.getDaysBetween(startDate, endDate);

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

        const days = dateUtils.getDaysBetween(clampedStart, clampedEnd);
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
        const today = new Date();
        if (today < startDate || today > endDate) return null;

        const days = dateUtils.getDaysBetween(startDate, today);
        return (days / totalDays) * containerWidth;
    }, [startDate, endDate, totalDays, containerWidth]);

    return (
        <div className="timeline-header">
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

            {/* 오늘 날짜 마커 */}
            {todayPosition !== null && (
                <div className="today-marker" style={{ left: `${todayPosition}px` }} />
            )}
        </div>
    );
}

export default TimelineHeader;
