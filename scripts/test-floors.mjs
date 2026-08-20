// 테스트 개수의 **단일 출처**.
//
// 왜 파일 하나를 더 만드나: 이 숫자는 두 게이트가 쓴다 — 실제 실행 개수를 보는
// `assert-test-floor.mjs` 와, 문서가 말하는 개수를 보는 `assert-doc-counts.mjs`.
// 양쪽에 상수를 따로 두면 "테스트는 늘렸는데 문서는 그대로"를 잡으려던 게이트가
// 자기 자신부터 드리프트한다.
//
// 숫자를 **올리는** 것은 테스트를 늘렸다는 뜻이니 그냥 올리면 된다. 내릴 때는 왜
// 내리는지 커밋 메시지에 적어라. 그 한 줄이 이 파일의 존재 이유다.
export const FLOOR = {
    unit: 588,      // vitest — tests/unit/**
    server: 267,    // node:test — server/test/**
    e2e: 107,       // playwright — tests/e2e/** (skip 0 은 별도 게이트)
};
