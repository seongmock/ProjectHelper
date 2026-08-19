// `GET /api/guide` 는 AI 에이전트가 **사전 지식 없이 이 서버를 쓰는 유일한 입구**다.
// 손으로 쓴 문서라 코드가 움직여도 아무도 깨뜨리지 못한다 — 없는 경로를 알려주면
// 에이전트는 404 를 받고, 왜 틀렸는지 알 방법이 없다. 그래서 여기서 보는 것은 문장이
// 아니라 **가이드가 약속한 경로가 실제 스펙에 있는가**다.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guide = require('../lib/aiGuide');

// openapi.yaml 의 paths 목록 (yaml 파서를 들이지 않는다 — 서버는 express 외 의존성이 없다)
const spec = fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8');
const specPaths = new Set(
    spec.split('\n')
        .map(line => /^ {2}(\/\S*):\s*$/.exec(line))
        .filter(Boolean)
        .map(m => m[1])
);

// 가이드의 모든 문자열을 훑어 "METHOD /api/..." 를 뽑는다.
const collectStrings = (node, out = []) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(n => collectStrings(n, out));
    else if (node && typeof node === 'object') Object.values(node).forEach(n => collectStrings(n, out));
    return out;
};

const MENTION = /\b(GET|POST|PATCH|PUT|DELETE)\s+(\/api\/[A-Za-z0-9/{}._-]*)/g;
const mentions = [...collectStrings(guide).join('\n').matchAll(MENTION)]
    .map(([, method, url]) => ({ method, url }));

// 스펙은 /api 를 서버 베이스로 두고, 프로젝트 스코프 경로는 별칭이라 따로 적지 않는다.
const toSpecPath = (url) => {
    const p = url.replace(/^\/api/, '').replace(/^\/projects\/\{pid\}/, '');
    return p === '' ? '/' : p;
};

// 스펙에 없지만 실제로 서빙되는 경로가 있다(예: /api/openapi.yaml — 스펙이 자기 자신을
// 항목으로 적지는 않는다). 그래서 index.js 가 직접 등록한 리터럴 경로도 함께 인정한다.
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const servedPaths = new Set(
    [...indexSrc.matchAll(/app\.(get|post|patch|put|delete)\('(\/api[^']*)'/g)].map(m => m[2])
);

const isServed = (url) => servedPaths.has(url) || specPaths.has(toSpecPath(url));

describe('가이드가 약속한 경로는 실제로 존재한다', () => {
    test('뽑아낸 경로가 있어야 검사가 의미를 갖는다', () => {
        assert.ok(mentions.length >= 15, `추출된 경로 ${mentions.length}건 — 정규식이 죽었을 수 있다`);
    });

    for (const { method, url } of mentions) {
        test(`${method} ${url}`, () => {
            assert.ok(isServed(url),
                `${url} 는 openapi.yaml 에도 index.js 에도 없다 — 가이드가 없는 경로를 알려주고 있다`);
        });
    }
});

describe('에이전트가 처음 읽는 항목이 비어 있지 않다', () => {
    test('discovery 는 guide/openapi/health 를 스스로 가리킨다', () => {
        for (const key of ['guide', 'openapi', 'health', 'projects', 'revision']) {
            assert.equal(typeof guide.discovery[key], 'string', `discovery.${key} 누락`);
        }
    });

    test('하지 말 것 목록이 비어 있지 않다 (통짜 교체 금지가 여기 산다)', () => {
        assert.ok(guide.donts.length > 0);
        assert.ok(guide.donts.some(d => d.includes('/api/data')),
            'POST /api/data 경고가 사라지면 2026-08-05 소실 사고 경로가 다시 열린다');
    });

    test('동시성 규약이 If-Match 와 409 를 명시한다', () => {
        const text = collectStrings(guide.concurrency).join(' ');
        assert.match(text, /If-Match/);
        assert.match(text, /409/);
    });

    test('인증이 꺼진 상태(open)와 서비스 토큰을 모두 설명한다', () => {
        const text = collectStrings(guide.auth).join(' ');
        assert.match(text, /open/);
        assert.match(text, /Bearer/);
        assert.match(text, /PH_API_TOKENS/);
    });

    test('JSON 직렬화가 가능하다 (그대로 응답 본문이 된다)', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(guide)), guide);
    });
});
