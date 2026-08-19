// server/lib/taskTree.js 는 src/utils/taskTree.js 의 **부분 CJS 포팅**이고, 겹치는 함수는
// 동작이 같아야 한다(CLAUDE.md). 규약은 문서에만 있었고 검사하는 것이 없었다 — 그래서
// 무작위 트리로 양쪽을 나란히 돌려 판정이 갈리는지 본다.
//
// 특히 의존성 판정은 클라이언트가 화면(화살표·배지)에, 서버가 쓰기 거부(400)와
// /dependency-issues 에 쓴다. 여기서 갈리면 **앱은 괜찮다는데 서버가 저장을 거부하는**
// 상태가 되고, 사용자에게는 원인이 보이지 않는다.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as client from '../../src/utils/taskTree.js';

const require = createRequire(import.meta.url);
const server = require('../../server/lib/taskTree.js');

// 재현 가능한 난수 — 실패했을 때 같은 트리를 다시 만들 수 있어야 한다
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

// 기간은 일부러 **역전(종료 < 시작)** 도 만든다 — 두 구현이 다른 bounds 함수를 쓰므로
// 거기서 갈리기 쉽다.
function makeTree() {
    const ids = [];
    const mk = (depth) => {
        const id = `t${ids.length}`;
        ids.push(id);
        const timeRanges = [];
        for (let i = 0; i < Math.floor(rnd() * 3); i++) {
            const start = Math.floor(rnd() * 60);
            const len = Math.floor(rnd() * 20) - 5;
            const rid = `${id}r${i}`;
            ids.push(rid);
            timeRanges.push({ id: rid, startDate: day(start), endDate: day(start + len), dependencies: [] });
        }
        const milestones = [];
        for (let i = 0; i < Math.floor(rnd() * 2); i++) {
            const mid = `${id}m${i}`;
            ids.push(mid);
            milestones.push({ id: mid, date: day(Math.floor(rnd() * 60)), dependencies: [] });
        }
        const children = depth < 2 && rnd() < 0.5 ? [mk(depth + 1), mk(depth + 1)] : [];
        return { id, name: id, timeRanges, milestones, children, progress: 0 };
    };
    return { roots: [mk(0), mk(0)], ids };
}

// Map/Set 은 JSON.stringify 로 전부 {} 가 된다 — 그대로 비교하면 검사가 텅 빈다.
const serialize = (value) => JSON.stringify(value, (key, v) => {
    if (v instanceof Map) return { __map: [...v.entries()].map(([k, mv]) => [k, mv instanceof Set ? [...mv] : mv]) };
    if (v instanceof Set) return [...v];
    return v;
});

describe('client / server taskTree 미러', () => {
    it('무작위 트리 300개에서 의존성 판정이 완전히 같다', () => {
        const diffs = [];
        const seen = { cycles: 0, overlaps: 0, dangling: 0 };

        for (let iter = 0; iter < 300; iter++) {
            const { roots, ids } = makeTree();
            const entities = [];
            const walk = (ts) => ts.forEach((t) => {
                (t.timeRanges || []).forEach(r => entities.push(r));
                (t.milestones || []).forEach(m => entities.push(m));
                walk(t.children || []);
            });
            walk(roots);
            // 존재하지 않는 id 도 섞는다 — dangling 판정까지 비교하기 위해서다
            entities.forEach((e) => {
                for (let i = 0; i < Math.floor(rnd() * 2); i++) {
                    e.dependencies.push(rnd() < 0.1 ? 'nosuch' : pick(ids));
                }
            });

            const a = client.findDependencyIssues(roots);
            const b = server.findDependencyIssues(roots);
            if (serialize(a) !== serialize(b)) diffs.push({ iter, client: serialize(a), server: serialize(b) });
            seen.cycles += a.cycles.length;
            seen.overlaps += a.overlaps.length;
            seen.dangling += a.dangling.length;

            for (let k = 0; k < 3 && entities.length; k++) {
                const source = pick(entities).id;
                const target = pick(ids);
                const x = client.wouldCreateDependencyCycle(a.successors, source, target);
                const y = server.wouldCreateDependencyCycle(b.successors, source, target);
                if (x !== y) diffs.push({ iter, source, target, client: x, server: y });
            }
        }

        // 판정이 항상 "문제 없음"이면 비교는 통과해도 아무것도 증명하지 못한다
        expect(seen.cycles).toBeGreaterThan(0);
        expect(seen.overlaps).toBeGreaterThan(0);
        expect(seen.dangling).toBeGreaterThan(0);
        expect(diffs.slice(0, 3)).toEqual([]);
    });

    it('삭제가 남기는 참조 정리도 같다', () => {
        const { roots, ids } = makeTree();
        const target = ids[0];
        const found = client.findTaskAndParent(roots, target);
        const owned = client.collectOwnedIds(found.task);
        expect([...owned].sort()).toEqual([...server.collectOwnedIds(found.task)].sort());
        expect(serialize(client.pruneDependencies(client.deleteFromTree(roots, target), owned)))
            .toEqual(serialize(server.pruneDependencies(server.deleteFromTree(roots, target), owned)));
    });
});
