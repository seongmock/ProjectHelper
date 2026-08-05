// 경량 요청 검증 — 외부 라이브러리 없이 필요한 필드 타입만 검사
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const validators = {
    string: (v) => typeof v === 'string',
    bool: (v) => typeof v === 'boolean',
    int: (v) => Number.isInteger(v),
    date: (v) => typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)),
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
        const unknown = Object.keys(body).filter(k => !(k in spec));
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

module.exports = { validate, validators, validateTaskTree, MAX_TASKS, MAX_DEPTH };
