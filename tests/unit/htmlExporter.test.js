// HTML 내보내기 XSS 회귀 테스트.
//
// 이 파일이 만드는 HTML은 Confluence 등 사내 위키에 임베드되는 것이 주 용도다.
// 이스케이프가 빠지면 self-XSS 가 아니라 문서를 열어보는 모든 사람에게 실행되는
// 저장형 XSS 가 된다. 실사(2026-08-05) 시점에 6개 지점이 무방비였다.
import { describe, it, expect } from 'vitest';
import { exportToHtml } from '../../src/features/io/htmlExporter.js';
import { placeMilestoneLabels, milestoneLabelStyle } from '../../src/features/timeline/milestoneLabels.js';
import { dependencyPath } from '../../src/features/timeline/dependencyPath.js';

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

describe('exportToHtml — 상태 색상 모드', () => {
    // 앱 화면과 내보낸 문서의 색이 갈리면 색상 모드 자체가 의미를 잃는다.
    const done = task({ id: 'done1', progress: 100 });
    const overdue = task({
        id: 'late1',
        timeRanges: [{ id: 'r1', startDate: '2000-01-01', endDate: '2000-01-31', dependencies: [] }],
    });

    it('기본(작업 색상) 모드에서는 상태 색 맵이 비어 있고 범례도 없다', () => {
        const html = exportToHtml([done, overdue]);
        expect(html).toContain('const STATUS_COLOR = {}');
        expect(html).not.toContain('ph-legend');
    });

    it('상태 색상 모드에서 작업별 색이 구워지고 범례가 붙는다', () => {
        const html = exportToHtml([done, overdue], { colorMode: 'status' });
        expect(html).toContain('"done1":"#2e9e6b"');
        expect(html).toContain('"late1":"#d9534f"');
        expect(html).toContain('class="ph-legend"');
        expect(html).toContain('지연');
    });

    it('중첩 자식도 상태 색을 받는다', () => {
        const parent = task({ id: 'p1', children: [task({ id: 'c1', progress: 100 })] });
        const html = exportToHtml([parent], { colorMode: 'status' });
        expect(html).toContain('"c1":"#2e9e6b"');
    });

    it('날짜 없는 작업은 맵에 없다 — 작업 색으로 폴백한다', () => {
        const noDates = task({ id: 'nd1', timeRanges: [] });
        const html = exportToHtml([noDates], { colorMode: 'status' });
        expect(html).not.toContain('"nd1":');
    });
});

// 내보내기가 앱의 배치 알고리즘을 **다시 구현하지 않는다**는 것을 증명한다.
// "같은 문자열이 들어 있다"는 검사는 소스를 베껴 넣어도 통과한다 — 그래서 심어진 소스를
// 실제로 실행해 앱 모듈과 같은 답을 내는지 본다. 이스케이프 사고나 드리프트가 생기면
// 여기서 깨진다.
describe('exportToHtml — 라벨 배치는 앱 모듈을 심어서 쓴다', () => {
    const extractEmbedded = (html) => {
        const begin = html.indexOf('// ---8<--- milestoneLabels.js');
        const end = html.indexOf('// ---8<--- /milestoneLabels.js');
        expect(begin).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(begin);
        return html.slice(html.indexOf('\n', begin) + 1, end);
    };

    const loadEmbedded = () => {
        const source = extractEmbedded(exportToHtml([task()]));
        return new Function(
            `${source}\nreturn { placeMilestoneLabels, milestoneLabelStyle };`
        )();
    };

    const items = [
        { id: 'a', x: 100, label: '요구사항 확정', labelPosition: 'auto' },
        { id: 'b', x: 110, label: '설계 리뷰', labelPosition: 'auto' },
        { id: 'c', x: 118, label: 'Kickoff', labelPosition: 'auto' },
        { id: 'd', x: 125, label: '개발 착수', labelPosition: 'auto' },
        { id: 'e', x: 4, label: '가장 왼쪽 마일스톤 라벨', labelPosition: 'auto' },
        { id: 'f', x: 300, label: '수동 배치', labelPosition: 'left' },
    ];

    it('심어진 소스가 앱 모듈과 같은 배치를 낸다', () => {
        const embedded = loadEmbedded();
        const mine = embedded.placeMilestoneLabels(items, 400);
        const theirs = placeMilestoneLabels(items, 400);
        expect([...mine.entries()]).toEqual([...theirs.entries()]);
    });

    it('심어진 소스가 앱과 같은 스타일 객체를 낸다', () => {
        const embedded = loadEmbedded();
        for (const placement of placeMilestoneLabels(items, 400).values()) {
            expect(embedded.milestoneLabelStyle(placement)).toEqual(milestoneLabelStyle(placement));
        }
    });

    it('겹치는 라벨은 층으로 흩어진다 — 예전처럼 top 으로 되돌아가지 않는다', () => {
        const embedded = loadEmbedded();
        const placed = embedded.placeMilestoneLabels(items.slice(0, 4), 400);
        const slots = [...placed.values()].map(p => `${p.position}:${p.tier}`);
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('내보낸 HTML 은 라벨 위치를 인라인 CSS 로 굽는다', () => {
        const html = exportToHtml([
            task({ milestones: [{ id: 'm1', date: '2026-02-01', label: '중간 점검' }] }),
        ]);
        expect(html).toContain('function styleToCss');
        // 예전 내보내기의 하드코딩된 배치 문자열은 더 이상 없다
        expect(html).not.toContain("labelStyle = 'bottom: 100%; left: 50%;");
    });
});

describe('exportToHtml — 화살표 경로도 앱 모듈을 심어서 쓴다', () => {
    const loadEmbedded = () => {
        const html = exportToHtml([task()]);
        const begin = html.indexOf('// ---8<--- dependencyPath.js');
        const end = html.indexOf('// ---8<--- /dependencyPath.js');
        expect(begin).toBeGreaterThan(-1);
        const source = html.slice(html.indexOf('\n', begin) + 1, end);
        return new Function(`${source}\nreturn dependencyPath;`)();
    };

    // 세 갈래(정방향 우회 / 같은 행 직선 / 역방향 우회)를 모두 지난다
    const cases = [[0, 20, 200, 60], [100, 20, 110, 20], [200, 20, 100, 60], [100, 20, 130, 60]];

    it('심어진 경로 함수가 앱과 같은 path 를 낸다', () => {
        const embedded = loadEmbedded();
        for (const args of cases) {
            expect(embedded(...args)).toBe(dependencyPath(...args));
        }
    });

    it('내보내기 안에 경로 계산이 다시 적혀 있지 않다', () => {
        const html = exportToHtml([task()]);
        expect(html).toContain('const path = dependencyPath(startX, startY, endX, endY);');
        expect(html).not.toContain('const forwardX = endX - 30;\n                        const midY');
    });
});

// 소스를 심는 방식은 조용히 깨질 수 있다 — 이스케이프 하나가 어긋나면 스크립트 전체가
// 구문 오류가 되고, 내보낸 문서는 **아무것도 그리지 않은 채** 멀쩡해 보인다.
describe('exportToHtml — 내보낸 스크립트는 구문이 온전하다', () => {
    it('스크립트 본문이 파싱된다', () => {
        const html = exportToHtml([
            task({ milestones: [{ id: 'm1', date: '2026-02-01', label: '중간 점검' }] }),
        ]);
        const body = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
        expect(body).toContain('function placeMilestoneLabels');
        expect(() => new Function(body)).not.toThrow();
    });
});
