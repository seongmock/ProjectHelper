// 경량 요청 검증 — 외부 라이브러리 없이 필요한 필드 타입만 검사
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const validators = {
    string: (v) => typeof v === 'string',
    bool: (v) => typeof v === 'boolean',
    int: (v) => Number.isInteger(v),
    // 달력에 없는 날짜(2026-02-30)는 Date.parse 를 통과한 뒤 3월 2일로 굴러간다 —
    // 저장은 원문, 투영(recalcTaskBounds)은 굴러간 값이라 API 가 같은 것에 대해 두
    // 날짜를 말했다. 왕복 대조가 그것을 막는다('YYYY-MM-DD' 는 UTC 자정으로 파싱된다).
    // Date.parse 를 먼저 통과시켜야 한다 — DATE_RE 는 `\d{2}` 라 '2026-99-99' 도 지나가고,
    // 그런 값에 곧바로 .toISOString() 을 부르면 RangeError 가 나 **검증기가 던진다**.
    // 클라이언트 잘못이 400 이 아니라 500 으로 나가는 것은 검증이 없는 것보다 나쁘다.
    date: (v) => {
        if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
        const t = Date.parse(v);
        return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
    },
    color: (v) => typeof v === 'string' && HEX_RE.test(v),
    stringArray: (v) => Array.isArray(v) && v.every(s => typeof s === 'string'),
    object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

const isEnum = (values) => (v) => values.includes(v);

// spec: { fieldName: { type: 'date'|'string'|..., required?: true, enum?: [...], nullable?: true } }
// body의 각 필드를 spec에 따라 검사. 미지의 키는 allowUnknown=false면 거부.
// 반환: 오류 메시지 문자열 또는 null(통과)
const validate = (body, spec, { allowUnknown = false } = {}) => {
    if (!validators.object(body)) return 'request body must be a JSON object';

    for (const [field, rule] of Object.entries(spec)) {
        const value = body[field];
        if (value === undefined) {
            if (rule.required) return `missing required field: ${field}`;
            continue;
        }
        if (value === null) {
            if (rule.nullable) continue;
            return `field '${field}' must not be null`;
        }
        if (rule.enum) {
            if (!isEnum(rule.enum)(value)) {
                return `field '${field}' must be one of: ${rule.enum.join(', ')}`;
            }
            continue;
        }
        const check = validators[rule.type];
        if (!check) return `unknown validator type for field: ${field}`;
        if (!check(value)) return `field '${field}' must be a valid ${rule.type}`;
    }

    if (!allowUnknown) {
        // hasOwn 이어야 한다 — `k in spec` 은 프로토타입 체인을 타므로 `constructor`·
        // `toString`·`__proto__` 같은 이름이 미지의 키 검사를 통과했고, spec 순회에도
        // 안 걸려 **타입 검사 없이** 트리에 그대로 저장됐다.
        const unknown = Object.keys(body).filter(k => !Object.hasOwn(spec, k));
        if (unknown.length > 0) return `unknown field(s): ${unknown.join(', ')}`;
    }
    return null;
};

// ── 작업 트리 전체 검증 ──────────────────────────────
// POST /api/data 는 트리 전체를 한 번에 덮어쓰므로 파괴력이 가장 크다.
// 2026-08-05 실사에서 이 경로에 검증이 없어 운영 데이터가 소실됐다.
// 목적은 완전한 스키마 강제가 아니라 '트리로 볼 수 없는 것'과 '자원 고갈'의 차단이다.
const MAX_TASKS = 5000;
const MAX_DEPTH = 20;

const validateTaskTree = (tasks) => {
    if (!Array.isArray(tasks)) return 'data must be an array of tasks';

    let count = 0;
    const seenIds = new Set();

    const walk = (nodes, depth, at) => {
        if (!Array.isArray(nodes)) return `${at} must be an array`;
        if (depth > MAX_DEPTH) return `task tree exceeds max depth of ${MAX_DEPTH}`;

        for (let i = 0; i < nodes.length; i++) {
            const task = nodes[i];
            const p = `${at}[${i}]`;

            if (!validators.object(task)) return `${p} must be an object`;
            if (typeof task.id !== 'string' || task.id === '') return `${p}.id must be a non-empty string`;
            if (typeof task.name !== 'string') return `${p}.name must be a string`;

            // 중복 id는 updateTaskInTree/deleteFromTree가 잘못된 노드를 건드리게 만든다
            if (seenIds.has(task.id)) return `duplicate task id: ${task.id}`;
            seenIds.add(task.id);

            if (++count > MAX_TASKS) return `task count exceeds limit of ${MAX_TASKS}`;

            if (task.timeRanges !== undefined) {
                if (!Array.isArray(task.timeRanges)) return `${p}.timeRanges must be an array`;
                for (let j = 0; j < task.timeRanges.length; j++) {
                    const r = task.timeRanges[j];
                    const rp = `${p}.timeRanges[${j}]`;
                    if (!validators.object(r)) return `${rp} must be an object`;
                    if (r.startDate !== undefined && r.startDate !== null && !validators.date(r.startDate)) {
                        return `${rp}.startDate must be YYYY-MM-DD`;
                    }
                    if (r.endDate !== undefined && r.endDate !== null && !validators.date(r.endDate)) {
                        return `${rp}.endDate must be YYYY-MM-DD`;
                    }
                }
            }

            if (task.milestones !== undefined && !Array.isArray(task.milestones)) {
                return `${p}.milestones must be an array`;
            }

            if (task.children !== undefined && task.children !== null) {
                const err = walk(task.children, depth + 1, `${p}.children`);
                if (err) return err;
            }
        }
        return null;
    };

    return walk(tasks, 0, 'data');
};


// ── 전역 뷰 설정 ─────────────────────────────────────
// POST /api/settings 는 무검증 통짜 덮어쓰기였다 — 설정 하나만 담아 보내면(가져오기
// 경로와 AI 가 그렇게 한다) 사용자의 나머지 뷰 설정이 전부 사라졌다.
// 키 목록을 여기 두지 않는 것은 일부러다: 클라이언트 settingsStore.js 의
// SETTING_DEFAULTS 가 유일한 목록이고, 그것을 베껴 두면 설정을 하나 추가할 때마다
// 두 곳이 갈라진다. 그래서 검사하는 것은 **구조**뿐 — 이름·타입·크기.
const SETTING_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_SETTING_KEYS = 64;
const MAX_SETTING_STRING = 200;

const validateSettings = (body) => {
    if (!validators.object(body)) return 'settings must be a JSON object';
    const keys = Object.keys(body);
    if (keys.length > MAX_SETTING_KEYS) return `too many settings keys (max ${MAX_SETTING_KEYS})`;
    for (const key of keys) {
        if (!SETTING_KEY_RE.test(key)) return `invalid settings key: ${key}`;
        const v = body[key];
        if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
            return `settings.${key} must be a string, number, boolean or null`;
        }
        if (typeof v === 'string' && v.length > MAX_SETTING_STRING) {
            return `settings.${key} is too long (max ${MAX_SETTING_STRING})`;
        }
        if (typeof v === 'number' && !Number.isFinite(v)) return `settings.${key} must be finite`;
    }
    return null;
};

// 기존 값 위에 얕게 병합한다. 설정은 평평한 스칼라 묶음이라 깊은 병합이 필요 없고,
// 깊은 병합은 "키를 지운다"를 불가능하게 만든다.
const mergeSettings = (current, patch) => ({
    ...(validators.object(current) ? current : {}),
    ...patch,
});

// 검증 → 병합 → **병합 결과 재검증**. 셋이 한 함수인 것이 요점이다.
// 요청 단위로만 세면 상한 이내의 쓰기를 반복해 서버 쪽 키를 무한히 누적할 수 있고,
// 브라우저는 캐시와 병합한 **전체** blob 을 보내므로 그 순간부터 사용자의 설정 저장이
// 전부 400 이 된다(그 실패는 storage.js 가 console.warn 으로 삼킨다 — 화면에 남는 것은
// "설정이 저장되지 않는다"뿐이다). 나눠 두면 호출부가 재검증을 잊는다.
const applySettingsPatch = (current, patch) => {
    const error = validateSettings(patch);
    if (error) return { error };
    const merged = mergeSettings(current, patch);
    const mergedError = validateSettings(merged);
    if (mergedError) return { error: `merged settings invalid: ${mergedError}` };
    return { merged };
};

module.exports = {
    validate, validators, validateTaskTree, validateSettings, mergeSettings, applySettingsPatch,
    MAX_TASKS, MAX_DEPTH, MAX_SETTING_KEYS,
};
