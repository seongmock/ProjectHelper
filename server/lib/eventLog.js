// 프로젝트별 append-only 감사 로그 — data/projects/<pid>/events.jsonl
//
// 배경: 2026-08-05 운영 데이터가 소실됐을 때 "누가·언제·무엇을 얼마나 지웠는가"를
// 답할 기록이 없었다. 요청 로그(lib/logger.js)는 stdout 으로만 나가 컨테이너와 함께
// 사라지고, 변경의 크기를 담지 않는다. 이 로그는 데이터와 같은 볼륨에 남는다.
//
// **이벤트 소싱이 아니다.** 이 로그로 상태를 복원하지 않는다. 되돌리기는 여전히
// 세대 백업(data.json.bak.N)과 스냅샷이 담당한다. 여기서 얻는 것은 추적 가능성뿐이다.
//
// 로그 실패가 쓰기를 실패시켜서는 안 된다 — 모든 append 는 삼켜지고 warn 으로만 남는다.
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// 롤오버: 2MB 를 넘으면 events.jsonl.1 로 한 세대만 밀어둔다.
// 이벤트 1건이 ~150바이트이므로 약 1.4만 건 — 내부 도구 규모에서 수개월치다.
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const eventFile = (dir) => path.join(dir, 'events.jsonl');

const rotateIfLarge = (file) => {
    let size = 0;
    try {
        size = fs.statSync(file).size;
    } catch {
        return; // 아직 없음
    }
    if (size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
};

const append = (dir, event) => {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const file = eventFile(dir);
        rotateIfLarge(file);
        fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
    } catch (err) {
        logger.warn('event log append failed', { dir, error: err.message });
    }
};

// 최신순으로 최대 limit 건. 깨진 줄(쓰기 중 잘림 등)은 건너뛴다.
const read = (dir, { limit = DEFAULT_LIMIT } = {}) => {
    const n = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
    let raw;
    try {
        raw = fs.readFileSync(eventFile(dir), 'utf-8');
    } catch {
        return [];
    }
    const lines = raw.split('\n').filter(Boolean).slice(-n).reverse();
    return lines.reduce((acc, line) => {
        try {
            acc.push(JSON.parse(line));
        } catch { /* 잘린 줄은 버린다 */ }
        return acc;
    }, []);
};

module.exports = { append, read, eventFile, MAX_BYTES, DEFAULT_LIMIT, MAX_LIMIT };
