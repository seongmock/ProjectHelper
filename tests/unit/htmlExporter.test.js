// HTML 내보내기 XSS 회귀 테스트.
//
// 이 파일이 만드는 HTML은 Confluence 등 사내 위키에 임베드되는 것이 주 용도다.
// 이스케이프가 빠지면 self-XSS 가 아니라 문서를 열어보는 모든 사람에게 실행되는
// 저장형 XSS 가 된다. 실사(2026-08-05) 시점에 6개 지점이 무방비였다.
import { describe, it, expect } from 'vitest';
import { exportToHtml } from '../../src/utils/htmlExporter.js';

const XSS = '<img src=x onerror=alert(1)>';
const BREAKOUT = '</script><script>alert(1)</script>';

const task = (extra = {}) => ({
    id: 't1',
    name: '정상 작업',
    color: '#4A90E2',
    children: [],
    milestones: [],
    timeRanges: [{ id: 'r1', startDate: '2026-01-01', endDate: '2026-03-31', dependencies: [] }],
    ...extra,
});

describe('exportToHtml — 스크립트 블록 탈출 차단', () => {
    it('작업명의 </script> 가 스크립트 블록을 닫지 못한다', () => {
        const html = exportToHtml([task({ name: BREAKOUT })]);
        // 데이터 영역에 원시 </script> 가 나타나면 탈출이 가능하다.
        // 정상적으로는 < 로 이스케이프되어야 한다.
        expect(html).not.toContain('</script><script>alert(1)</script>');
        expect(html).toContain('\\u003c');
    });

    it('라벨의 </script> 도 이스케이프된다', () => {
        const html = exportToHtml([
            task({ milestones: [{ id: 'm1', date: '2026-02-01', label: BREAKOUT }] }),
        ]);
        expect(html).not.toContain('</script><script>');
    });

    it('데이터 영역에 원시 < 문자가 남지 않는다', () => {
        const html = exportToHtml([task({ name: XSS })]);
        const dataLine = html.split('\n').find(l => l.includes('const RAW_DATA'));
        expect(dataLine).toBeDefined();
        expect(dataLine).not.toContain('<img');
        expect(dataLine).toContain('\\u003cimg');
    });

    it('U+2028/U+2029 를 이스케이프한다 (JS 구문 오류 방지)', () => {
        // 소스에 리터럴로 넣으면 눈에 보이지 않아 유지보수가 어렵다 — 코드로 만든다.
        const LS = String.fromCharCode(0x2028);
        const PS = String.fromCharCode(0x2029);
        const html = exportToHtml([task({ name: `줄${LS}바꿈${PS}문자` })]);
        const dataLine = html.split('\n').find(l => l.includes('const RAW_DATA'));
        expect(dataLine).toContain('\\u2028');
        expect(dataLine).toContain('\\u2029');
        // 원시 문자가 남아 있으면 JS 파서가 줄바꿈으로 해석해 구문 오류가 난다
        expect(dataLine).not.toContain(LS);
        expect(dataLine).not.toContain(PS);
    });
});

describe('exportToHtml — 런타임 이스케이프 헬퍼', () => {
    it('esc() 헬퍼가 산출물에 포함된다', () => {
        const html = exportToHtml([task()]);
        expect(html).toContain('function esc(');
        expect(html).toContain('&amp;');
        expect(html).toContain('&lt;');
        expect(html).toContain('&quot;');
    });

    it('사용자 데이터를 innerHTML 로 넣는 모든 지점이 esc() 를 통과한다', () => {
        const html = exportToHtml([task()]);
        // 작업 목록
        expect(html).toContain('title="${esc(task.name)}"');
        // 바 title 속성
        expect(html).toContain('var title = esc(task.name)');
        // 바 라벨
        expect(html).toContain('labelText += esc(');
        // 마일스톤 title 속성 + 라벨 텍스트 — 두 곳 모두
        expect(html).toContain("title=\"' + esc(m.label)");
        expect((html.match(/esc\(m\.label\)/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    it('미이스케이프 보간이 남아 있지 않다 (회귀 방지)', () => {
        const html = exportToHtml([task()]);
        expect(html).not.toContain('title="${task.name}"');
        expect(html).not.toContain("+ m.label +");
    });
});

describe('exportToHtml — 기본 동작', () => {
    it('자립형 HTML 을 만든다', () => {
        const html = exportToHtml([task()]);
        expect(html).toContain('ph-gantt-');
        expect(html).toContain('<style>');
        expect(html).toContain('<script>');
        expect(html).toContain('정상 작업');
    });

    it('빈 트리에서도 죽지 않는다', () => {
        expect(() => exportToHtml([])).not.toThrow();
    });

    it('다크모드 설정이 반영된다', () => {
        expect(exportToHtml([task()], { darkMode: true })).toContain('#1e1e1e');
    });
});
