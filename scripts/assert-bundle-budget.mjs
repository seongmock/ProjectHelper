#!/usr/bin/env node
// 번들 예산 게이트 — "500kB 경고가 없다"를 문장이 아니라 검사로 만든다.
//
// 왜 필요한가: 무겁던 것(html2canvas)은 `await import()` 로 갈라져 나갔고, 그래서 vite 의
// 500kB 경고는 이미 사라졌다. 문제는 그 사실이 아무 곳에도 고정돼 있지 않다는 점이다 —
// 다음 사람이 캡처 모듈을 위쪽에서 정적으로 import 하면 경고는 빌드 로그 한 줄로 돌아오고,
// 로그를 읽는 사람은 없다. 두 가지를 못 박는다:
//   ① 엔트리 청크가 vite 경고 문턱(500kB) 아래에 있다.
//   ② 캡처 라이브러리는 **자기 청크**로 남아 있다(= 첫 화면에 실려 오지 않는다).
// 압축 전 크기를 본다 — vite 의 경고가 보는 값과 같은 값이어야 검사가 경고를 대신한다.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist/assets';
const BUDGET = 500 * 1024;      // vite 의 chunkSizeWarningLimit 기본값
const LAZY = 'html2canvas';

let files;
try {
    files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
} catch {
    console.error(`[bundle] ${DIR} 가 없다 — npm run build 를 먼저 돌려라`);
    process.exit(1);
}

const sizes = new Map(files.map((f) => [f, statSync(join(DIR, f)).size]));
for (const [f, size] of [...sizes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(8)} kB  ${f}`);
}

const entry = files.find((f) => f.startsWith('index-'));
let failed = false;

if (!entry) {
    console.error('[bundle] 엔트리 청크(index-*.js)를 찾지 못했다 — 빌드 산출물 이름이 바뀌었나?');
    failed = true;
} else if (sizes.get(entry) > BUDGET) {
    console.error(`[bundle] 엔트리 청크가 예산을 넘었다: ${entry} ` +
        `${(sizes.get(entry) / 1024).toFixed(1)}kB > ${BUDGET / 1024}kB. ` +
        '무거운 의존성을 동적 import 로 갈라라.');
    failed = true;
}

if (!files.some((f) => f.includes(LAZY))) {
    console.error(`[bundle] ${LAZY} 가 별도 청크로 없다 — 어딘가에서 정적으로 import 하고 있다. ` +
        '캡처는 버튼을 누를 때만 필요하므로 `await import()` 로 유지해야 한다.');
    failed = true;
}

if (failed) process.exit(1);
console.log(`[bundle] 통과 — 엔트리 ${(sizes.get(entry) / 1024).toFixed(1)}kB < ${BUDGET / 1024}kB, ` +
    `${LAZY} 는 별도 청크`);
