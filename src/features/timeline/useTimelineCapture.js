// 타임라인 전체를 PNG 로 캡처해 클립보드에 넣는다.
//
// html2canvas 는 "화면에 보이는 것"만 찍기 때문에, 캡처 직전에 스크롤 컨테이너의
// overflow/높이를 임시로 풀어 전체를 펼쳤다가 원래대로 되돌린다. 되돌리기가 빠지면
// 화면이 깨진 채로 남으므로 스타일 백업/복구가 이 함수의 절반을 차지한다.
import { useCallback } from 'react';
import { captureHeight } from './captureGeometry';

// 임시로 style 프로퍼티를 덮어쓰고, 되돌리는 함수를 반환한다
const overrideStyle = (el, patch) => {
    if (!el) return () => { };
    const original = {};
    Object.keys(patch).forEach(key => { original[key] = el.style[key]; });
    Object.assign(el.style, patch);
    return () => Object.assign(el.style, original);
};

export function useTimelineCapture({
    containerRef, captureRef, timelineScrollRef, taskNamesScrollRef,
    flatTasks, isCompact, darkMode, toast,
}) {
    return useCallback(async () => {
        const captureContainer = captureRef.current;
        if (!captureContainer) return;

        const restores = [];
        try {
            containerRef.current?.classList.add('capturing');

            restores.push(overrideStyle(timelineScrollRef.current, { overflow: 'visible' }));
            restores.push(overrideStyle(taskNamesScrollRef.current, { overflowY: 'visible', height: 'auto' }));

            // 높이는 DOM 이 아니라 데이터로 계산한다 — 캡처 중 DOM 을 건드리므로
            // 실측값은 신뢰할 수 없고, stale closure 도 피할 수 있다.
            const header = captureContainer.querySelector('.timeline-header');
            const headerHeight = header ? header.offsetHeight : (isCompact ? 50 : 70);
            const rowHeight = isCompact ? 28 : 40;
            const timelineContent = captureContainer.querySelector('.timeline-content');

            let rowCount = flatTasks.length;
            if (rowCount === 0 && timelineContent) {
                rowCount = timelineContent.querySelectorAll('.timeline-bar').length;
            }

            // 행은 .timeline-content 의 위쪽 여백(--timeline-label-headroom) **아래**에서
            // 시작한다. 그 여백은 첫 행 위로 층을 쌓는 마일스톤 라벨의 자리라 그림에 반드시
            // 들어가야 하고, 높이 계산에서 빠뜨리면 딱 그만큼 **마지막 행이 잘려 나간다**
            // (실측: 여백 42px = 행 하나보다 크다). 여백은 CSS 상수여서 캡처 중 우리가
            // 덮어쓰는 스타일과 무관하다 — 그래서 이 값만은 실측해서 읽는다.
            const contentPadTop = timelineContent
                ? parseFloat(getComputedStyle(timelineContent).paddingTop) || 0
                : 0;

            // 여백 없이 딱 맞춘다. 판정은 순수함수에 있다 — E2E 가 같은 함수에 실측
            // 입력을 넣어 마지막 행까지 덮는지 확인한다.
            const contentHeight = captureHeight({
                headerHeight,
                contentPadTop,
                rowCount,
                rowHeight,
                scrollHeight: timelineScrollRef.current?.scrollHeight,
            });

            restores.push(overrideStyle(captureContainer, {
                width: 'max-content',
                height: `${contentHeight}px`,
                overflow: 'visible',
                backgroundColor: darkMode ? '#1E1E1E' : '#FFFFFF',
            }));
            // timeline-content 의 min-height 를 풀지 않으면 아래쪽 배경이 끊긴다
            restores.push(overrideStyle(timelineContent, { minHeight: '0', height: '100%' }));

            // 캡처할 때만 필요한 모듈 — 별도 청크로 지연 로드 (초기 번들 축소)
            const { default: html2canvas } = await import('html2canvas');
            const canvas = await html2canvas(captureContainer, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: darkMode ? '#1E1E1E' : '#FFFFFF',
                width: captureContainer.scrollWidth,
                height: contentHeight,
                windowWidth: captureContainer.scrollWidth,
                windowHeight: contentHeight,
                onclone: (clonedDoc) => {
                    const clonedContent = clonedDoc.querySelector('.timeline-content');
                    if (clonedContent) {
                        clonedContent.style.minHeight = '0';
                        clonedContent.style.height = 'auto';
                    }
                },
            });

            restores.forEach(restore => restore());
            restores.length = 0;
            containerRef.current?.classList.remove('capturing');

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    toast.error('이미지 생성 실패');
                    return;
                }
                try {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    toast.success('타임라인 이미지가 클립보드에 복사되었습니다.');
                    return;
                } catch (err) {
                    console.error('클립보드 복사 실패:', err);
                }
                // 클립보드 권한이 없으면 파일로 떨어뜨린다
                try {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `timeline-capture-${new Date().toISOString().slice(0, 10)}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    toast.info('클립보드 접근 권한 문제로 이미지를 다운로드했습니다.');
                } catch (downloadErr) {
                    console.error('다운로드 실패:', downloadErr);
                    toast.error('이미지 저장에 실패했습니다.');
                }
            });
        } catch (err) {
            // 중간에 실패해도 화면은 반드시 원래대로 돌려놓는다
            restores.forEach(restore => restore());
            containerRef.current?.classList.remove('capturing');
            console.error('이미지 캡처 실패:', err);
            toast.error(`이미지 캡처 중 오류가 발생했습니다: ${err.message}`);
        }
    }, [containerRef, captureRef, timelineScrollRef, taskNamesScrollRef,
        flatTasks, isCompact, darkMode, toast]);
}
