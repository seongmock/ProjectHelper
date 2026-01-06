// 날짜 계산 및 포맷팅 유틸리티

export const dateUtils = {
    // 날짜 문자열을 Date 객체로 변환
    parseDate: (dateStr) => {
        return new Date(dateStr);
    },

    // Date 객체를 YYYY-MM-DD 형식으로 변환
    formatDate: (date) => {
        if (typeof date === 'string') return date;
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    // 두 날짜 사이의 일수 계산
    getDaysBetween: (startDate, endDate) => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = end - start;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    },

    // 날짜 범위 생성 (월별)
    generateMonthRange: (startDate, endDate) => {
        const months = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        let current = new Date(start.getFullYear(), start.getMonth(), 1);

        while (current <= end) {
            months.push({
                year: current.getFullYear(),
                month: current.getMonth() + 1,
                date: new Date(current),
                label: `${current.getFullYear()}년 ${current.getMonth() + 1}월`,
            });
            current.setMonth(current.getMonth() + 1);
        }

        return months;
    },

    // 날짜 범위 생성 (분기별)
    generateQuarterRange: (startDate, endDate) => {
        const quarters = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        let current = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);

        while (current <= end) {
            const quarter = Math.floor(current.getMonth() / 3) + 1;
            quarters.push({
                year: current.getFullYear(),
                quarter: quarter,
                date: new Date(current),
                label: `${current.getFullYear()}년 Q${quarter}`,
            });
            current.setMonth(current.getMonth() + 3);
        }

        return quarters;
    },

    // 월의 일수 계산
    getDaysInMonth: (year, month) => {
        return new Date(year, month, 0).getDate();
    },

    // 특정 날짜가 범위 내에 있는지 확인
    isInRange: (date, rangeStart, rangeEnd) => {
        const d = new Date(date);
        const start = new Date(rangeStart);
        const end = new Date(rangeEnd);
        return d >= start && d <= end;
    },

    // 날짜에 일수 추가
    addDays: (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    },

    // 오늘 날짜
    getToday: () => {
        return new Date();
    },

    // 날짜 범위의 전체 폭 계산 (픽셀)
    calculateWidth: (startDate, endDate, viewStartDate, viewEndDate, totalWidth) => {
        const viewDays = dateUtils.getDaysBetween(viewStartDate, viewEndDate);
        const taskStart = new Date(startDate) < new Date(viewStartDate) ? viewStartDate : startDate;
        const taskEnd = new Date(endDate) > new Date(viewEndDate) ? viewEndDate : endDate;
        const taskDays = dateUtils.getDaysBetween(taskStart, taskEnd);
        const offsetDays = dateUtils.getDaysBetween(viewStartDate, taskStart);

        return {
            width: (taskDays / viewDays) * totalWidth,
            offset: (offsetDays / viewDays) * totalWidth,
        };
    },

    // 월의 첫날
    getMonthStart: (year, month) => {
        return new Date(year, month - 1, 1);
    },

    // 월의 마지막 날
    getMonthEnd: (year, month) => {
        return new Date(year, month, 0);
    },

    // 분기의 첫날
    getQuarterStart: (year, quarter) => {
        return new Date(year, (quarter - 1) * 3, 1);
    },

    // 분기의 마지막 날
    getQuarterEnd: (year, quarter) => {
        return new Date(year, quarter * 3, 0);
    },
};
