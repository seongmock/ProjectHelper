// 마일스톤 도형의 단일 정의 테스트.
//
// 이 파일이 지키는 것은 "예쁘게 그리는가"가 아니라 **세 화면이 같은 것을 그리는가**다.
// 표·차트·내보내기가 각자 도형을 그리던 동안, 선택 목록에는 있지만 어떤 화면에서는
// 다른 모양으로 나오는 조합이 실제로 있었다(별·깃발은 표에서 텍스트 글리프였다).
import { describe, it, expect } from 'vitest';
import { milestoneShape, MILESTONE_SHAPE_OPTIONS } from '../../src/shared/milestoneShapes.js';

describe('milestoneShape', () => {
    it('선택 목록의 모든 값이 자기 이름의 서술로 해석된다', () => {
        // 목록에 있는데 해석되지 않는 값이 있으면 사용자는 "고를 수 있지만 다이아몬드로
        // 그려지는" 도형을 만나게 된다 — 고른 것과 그려진 것이 다른 상태.
        for (const { value } of MILESTONE_SHAPE_OPTIONS) {
            expect(milestoneShape(value).name).toBe(value);
        }
    });

    it('상자형은 지름/회전으로, 경로형은 SVG 경로로 서술된다', () => {
        expect(milestoneShape('circle')).toMatchObject({ kind: 'box', borderRadius: '50%', rotate: 0 });
        expect(milestoneShape('square')).toMatchObject({ kind: 'box', borderRadius: '2px', rotate: 0 });
        expect(milestoneShape('diamond')).toMatchObject({ kind: 'box', rotate: 45 });
        // 다이아몬드는 굴리지 않는다 — 굴리면 회전한 사각형이 아니라 렌즈 모양이 된다
        expect(milestoneShape('diamond').borderRadius).toBeFalsy();
        for (const name of ['triangle', 'star', 'flag']) {
            const spec = milestoneShape(name);
            expect(spec.kind).toBe('path');
            expect(spec.viewBox).toBe('0 0 24 24');
            expect(spec.path.length).toBeGreaterThan(10);
        }
    });

    it('모르는 값·빈 값은 다이아몬드다', () => {
        // 서버는 shape 를 검증하지 않는다(AI·수동 편집으로 아무 문자열이 들어올 수 있다).
        for (const bad of [undefined, null, '', 'hexagon', 0, {}]) {
            expect(milestoneShape(bad).name).toBe('diamond');
        }
    });

    it('서술을 고쳐도 원본이 오염되지 않는다', () => {
        const spec = milestoneShape('circle');
        spec.borderRadius = '0';
        expect(milestoneShape('circle').borderRadius).toBe('50%');
    });

    it('import 가 없다 — 내보내기가 이 파일의 소스를 그대로 심기 때문이다', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('src/shared/milestoneShapes.js', 'utf8');
        expect(src).not.toMatch(/^import\s/m);
        expect(src).not.toMatch(/^export default/m);
        expect(src).not.toMatch(/^export\s*\{/m);
    });
});
