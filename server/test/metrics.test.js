// 운영 지표. 이 숫자들이 답해야 하는 질문은 셋이다 — 살아 있나 / 언제부터 / 뭐가 깨지나.
//
// 검사에서 지키려는 성질은 두 가지다. ① **카운터가 응답을 망가뜨리지 않는다**: 계측이
// 요청 경로에 있으므로 여기서 던지면 멀쩡한 API 가 500 이 된다. ② **식별 정보가 새지
// 않는다**: 메트릭은 대시보드·로그로 흘러 나가는 값이라 프로젝트 이름이 실리면 인증
// 뒤에 두는 의미가 없어진다.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let metrics;

beforeEach(() => {
    // 모듈 상태를 들고 있으므로 시나리오마다 새로 로드한다.
    delete require.cache[require.resolve('../lib/metrics')];
    metrics = require('../lib/metrics');
});

const hit = (over = {}) => metrics.record({ method: 'GET', status: 200, durationMs: 10, ...over });

describe('요청 카운터', () => {
    test('상태코드를 계열별로 센다', () => {
        hit({ status: 200 });
        hit({ status: 302 });
        hit({ status: 404 });
        hit({ status: 500 });
        const { requests } = metrics.snapshot();
        assert.equal(requests.total, 4);
        assert.deepEqual(
            [requests['2xx'], requests['3xx'], requests['4xx'], requests['5xx']],
            [1, 1, 1, 1]
        );
    });

    test('평균과 최댓값을 함께 준다 (평균만 보면 느린 한 건이 묻힌다)', () => {
        hit({ durationMs: 10 });
        hit({ durationMs: 30 });
        const { requests } = metrics.snapshot();
        assert.equal(requests.avgMs, 20);
        assert.equal(requests.maxMs, 30);
    });

    test('요청이 하나도 없어도 평균은 0 이다 (0으로 나누지 않는다)', () => {
        assert.equal(metrics.snapshot().requests.avgMs, 0);
    });

    test('모르는 상태코드 계열이 와도 총계는 센다', () => {
        hit({ status: 999 });
        assert.equal(metrics.snapshot().requests.total, 1);
    });
});

describe('마지막 변경 시각 — 백업이 최신인지 판단하는 근거', () => {
    test('성공한 쓰기만 변경으로 센다', () => {
        hit({ method: 'POST', status: 200 });
        hit({ method: 'PATCH', status: 400 }); // 거부된 쓰기는 아무것도 바꾸지 않았다
        hit({ method: 'GET', status: 200 });
        const { mutations } = metrics.snapshot();
        assert.equal(mutations.total, 1);
        assert.match(mutations.lastAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('변경이 없으면 시각도 없다 (0 이나 지금 시각으로 채우지 않는다)', () => {
        hit();
        assert.equal(metrics.snapshot().mutations.lastAt, null);
    });

    test('5xx 가 나면 마지막 오류 시각이 남는다', () => {
        assert.equal(metrics.snapshot().lastErrorAt, null);
        hit({ status: 503 });
        assert.match(metrics.snapshot().lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('스냅샷', () => {
    test('가동 시간과 시작 시각을 함께 준다 (재시작이 숫자에서 사라지면 안 된다)', () => {
        const snap = metrics.snapshot();
        assert.equal(typeof snap.uptimeSec, 'number');
        assert.ok(snap.uptimeSec >= 0);
        assert.match(snap.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('JSON 으로 직렬화된다 (그대로 응답 본문이 된다)', () => {
        hit();
        const snap = metrics.snapshot();
        assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
    });

    test('프로젝트 이름·사용자·경로 같은 식별 정보를 담지 않는다', () => {
        metrics.record({ method: 'POST', status: 200, durationMs: 1, user: 'sm.yoo', path: '/api/projects/secret' });
        const text = JSON.stringify(metrics.snapshot());
        assert.equal(text.includes('sm.yoo'), false);
        assert.equal(text.includes('secret'), false);
    });
});

describe('Prometheus 노출 형식', () => {
    test('메트릭마다 HELP·TYPE·값이 있고 줄바꿈으로 끝난다', () => {
        hit();
        const text = metrics.toPrometheus();
        assert.match(text, /# HELP ph_uptime_seconds /);
        assert.match(text, /# TYPE ph_requests_total counter\nph_requests_total 1\n/);
        assert.equal(text.endsWith('\n'), true);
    });

    test('상태코드 계열은 라벨로 나간다', () => {
        hit({ status: 404 });
        assert.match(metrics.toPrometheus(), /ph_requests_by_class_total\{class="4xx"\} 1/);
    });

    test('값은 모두 숫자다 (문자열이 섞이면 스크레이퍼가 그 줄을 버린다)', () => {
        hit();
        for (const line of metrics.toPrometheus().trim().split('\n')) {
            if (line.startsWith('#')) continue;
            const value = line.slice(line.lastIndexOf(' ') + 1);
            assert.ok(Number.isFinite(Number(value)), `숫자가 아니다: ${line}`);
        }
    });
});
