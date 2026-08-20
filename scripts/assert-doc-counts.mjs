#!/usr/bin/env node
// 문서가 말하는 테스트 개수를 실제 바닥값과 맞춘다.
//
// 왜 필요한가: 2026-08-20 감사에서 네 문서가 서로 다른 숫자를 말하고 있었다 —
// README 는 E2E 51건, AGENTS.md 는 28건과 51건을 한 파일에서, copilot-instructions 는
// 37건, verify-app 스킬은 16건. 실제는 107건이었다. 테스트를 늘린 커밋은 초록불이고
// 문서는 아무도 검사하지 않으니, 숫자는 **늘릴 때마다** 조용히 낡는다. 새로 온 사람이
// "E2E 51건"을 보고 107건 중 56건이 어디서 사라졌는지 찾는 데 시간을 쓰게 된다.
//
// 검사 방식은 좁게 잡았다: 키워드(unit/단위/server/서버/E2E) 바로 뒤에 오는 숫자가
// 단위(건/테스트/개//)를 달고 있을 때만 본다. 아무 숫자나 잡으면 문서를 고칠 때마다
// 게이트가 오작동하고, 오작동하는 게이트는 곧 주석 처리된다.
//
// 과거 기록 문서는 대상이 아니다(`docs/*_REPORT.md`, 실사 보고서, HANDOVER 세션 로그).
// 그 숫자는 그 시점의 사실이므로 고치면 기록이 거짓이 된다.
import { readFileSync } from 'node:fs';
import { FLOOR } from './test-floors.mjs';

const FILES = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.github/copilot-instructions.md',
    '.claude/skills/verify-app/SKILL.md',
];

const KEY = { unit: 'unit', 단위: 'unit', server: 'server', 서버: 'server', E2E: 'e2e' };
const CLAIM = /(unit|단위|server|서버|E2E)\s*(?:테스트\s*)?(\d{2,4})\s*(?:건|테스트|개|\/)/g;

let failed = false;
for (const file of FILES) {
    const text = readFileSync(file, 'utf8');
    let found = 0;
    for (const [whole, word, digits] of text.matchAll(CLAIM)) {
        const kind = KEY[word];
        const count = Number(digits);
        found += 1;
        if (count !== FLOOR[kind]) {
            console.error(`::error file=${file}::"${whole.trim()}" — ${kind} 는 ${FLOOR[kind]}건이다. ` +
                '문서의 숫자가 낡았다 (또는 scripts/test-floors.mjs 를 함께 고쳐야 한다).');
            failed = true;
        }
    }
    if (found === 0) {
        console.error(`::error file=${file}::테스트 개수 표기가 사라졌다 — 개수를 지우면 이 게이트가 아무것도 검사하지 못한다.`);
        failed = true;
    } else {
        console.log(`${file}: ${found}건 확인`);
    }
}

if (failed) process.exit(1);
console.log(`[docs] 통과 — unit ${FLOOR.unit} · server ${FLOOR.server} · e2e ${FLOOR.e2e}`);
