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

    // 오늘 날짜 마커 위치 계산
    const todayPosition = useMemo(() => {
        const today = new Date();
        if (today < startDate || today > endDate) return null;

        const days = dateUtils.getDaysBetween(startDate, today);
        return (days / totalDays) * containerWidth;
    }, [startDate, endDate, totalDays, containerWidth]);

    return (
        <div className="timeline-header">
            <div className="timeline-units" style={{ width: containerWidth }}>
                {timeUnits.map((unit, index) => (
                    <div
                        key={index}
                        className="timeline-unit"
                        style={{ width: `${getUnitWidth(unit)}px` }}
                    >
                        <span className="unit-label">{unit.label}</span>
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
