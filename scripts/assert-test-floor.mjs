#!/usr/bin/env node
// 테스트가 조용히 사라지는 것을 막는 바닥값.
//
// 왜 필요한가: 초록불은 "통과했다"는 뜻이지 "검사했다"는 뜻이 아니다. 실패하는 테스트를
// 지우면 CI 는 더 빨리, 더 조용히 통과한다 — 정확히 반대 신호다. E2E 의 skip 게이트가
// 같은 이유로 있고(skip 은 아무것도 검증하지 않는다), 이건 그 게이트의 단위/서버판이다.
//
// 숫자를 **올리는** 것은 테스트를 늘렸다는 뜻이니 그냥 올리면 된다. 내릴 때는 왜
// 내리는지 커밋 메시지에 적어라. 그 한 줄이 이 파일의 존재 이유다.
const FLOOR = {
    unit: 588,   // vitest — tests/unit/**
    server: 267, // node:test — server/test/**
    e2e: 107,    // playwright — tests/e2e/** (skip 0 은 별도 게이트)
};

const [kind, raw] = process.argv.slice(2);

if (!(kind in FLOOR)) {
    console.error(`사용법: node scripts/assert-test-floor.mjs <${Object.keys(FLOOR).join('|')}> <개수>`);
    process.exit(2);
}

const count = Number(raw);
if (!Number.isInteger(count) || count < 0) {
    // 개수를 못 읽었다는 것은 리포터 출력 형식이 바뀌었다는 뜻이다 — 통과시키면 게이트가
    // 사라진 줄도 모르게 된다.
    console.error(`::error::${kind} 테스트 개수를 읽지 못했다 (받은 값: ${JSON.stringify(raw)})`);
    process.exit(1);
}

if (count < FLOOR[kind]) {
    console.error(`::error::${kind} 테스트가 ${count}건이다 — 바닥값 ${FLOOR[kind]}건보다 적다. ` +
        '테스트가 지워졌거나 수집되지 않았다. 의도한 감소라면 scripts/assert-test-floor.mjs 를 함께 낮춰라.');
    process.exit(1);
}

console.log(`${kind}: ${count}건 (바닥값 ${FLOOR[kind]})`);
