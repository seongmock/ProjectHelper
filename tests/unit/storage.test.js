// `storage` — 이 앱의 유일한 영속화 경로. localStorage 캐시 + 서버 동기화 하이브리드다.
//
// 여기서 틀리면 증상이 전부 **조용하다**: 캐시가 화면에 뜨므로 사용자는 저장된 줄 알고,
// 어긋난 리비전은 409 로 남의 편집을 덮고, 프로젝트를 바꿨는데 늦게 도착한 이전 응답이
// 새 프로젝트의 캐시에 옛 트리를 써 넣는다. 그래서 이 파일은 **판단**만 본다 —
// 서버 우선/폴백, If-Match, epoch 가드, 프로젝트별 캐시 키, 401 채널.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── localStorage 스텁 ────────────────────────────────
// 모듈 최상단에서 레거시 키 마이그레이션이 즉시 돌기 때문에 import 보다 먼저 있어야 한다.
const makeLocalStorage = (seed = {}) => {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        _map: map,
    };
};

// 응답 큐 방식의 fetch 스텁. 호출 기록을 남겨 경로·헤더·본문을 검사한다.
const makeFetch = () => {
    const calls = [];
    const queue = [];
    const fn = vi.fn(async (url, options = {}) => {
        calls.push({ url, options });
        const next = queue.shift();
        if (!next) throw new Error(`예상치 못한 요청: ${url}`);
        if (typeof next === 'function') return next(url, options);
        return next;
    });
    fn.calls = calls;
    fn.reply = (body, status = 200) => {
        queue.push({ ok: status >= 200 && status < 300, status, json: async () => body });
        return fn;
    };
    fn.fail = (status) => fn.reply({ ok: false }, status);
    fn.offline = () => { queue.push(() => { throw new TypeError('Failed to fetch'); }); return fn; };
    return fn;
};

// storage.js 는 모듈 레벨 상태(currentProjectId·knownRevision·epoch)를 들고 있으므로
// 검사마다 새로 import 해야 한다.
const freshStorage = async (seed) => {
    vi.resetModules();
    const localStorage = makeLocalStorage(seed);
    const fetch = makeFetch();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('fetch', fetch);
    const mod = await import('../../src/utils/storage.js');
    return { ...mod, localStorage, fetch };
};

const TREE = [{ id: 't1', name: '작업', children: [] }];

beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('레거시 키 마이그레이션 (모듈 로드 시 1회)', () => {
    it('접미사 없는 옛 키를 :default 로 옮기고 원래 키를 지운다', async () => {
        const { localStorage } = await freshStorage({
            'project-timeline-data': JSON.stringify(TREE),
            'project-timeline-snapshots': JSON.stringify([{ id: 's1' }]),
        });
        expect(localStorage.getItem('project-timeline-data:default')).toBe(JSON.stringify(TREE));
        expect(localStorage.getItem('project-timeline-snapshots:default')).toBe(JSON.stringify([{ id: 's1' }]));
        expect(localStorage.getItem('project-timeline-data')).toBeNull();
    });

    it('이미 :default 가 있으면 덮어쓰지 않는다', async () => {
        const { localStorage } = await freshStorage({
            'project-timeline-data': JSON.stringify([{ id: 'old' }]),
            'project-timeline-data:default': JSON.stringify([{ id: 'new' }]),
        });
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual([{ id: 'new' }]);
    });
});

describe('loadData — 서버 우선, 실패하면 캐시', () => {
    it('서버가 주면 그것을 쓰고 캐시를 갱신한다', async () => {
        const { storage, fetch, localStorage } = await freshStorage();
        fetch.reply({ ok: true, data: TREE, revision: 7 });
        expect(await storage.loadData()).toEqual(TREE);
        expect(fetch.calls[0].url).toBe('/api/projects/default/data');
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual(TREE);
        expect(storage.getKnownRevision()).toBe(7);
    });

    it('네트워크가 죽으면 캐시로 계속 동작한다 (오프라인)', async () => {
        const { storage, fetch } = await freshStorage({
            'project-timeline-data:default': JSON.stringify(TREE),
        });
        fetch.offline();
        expect(await storage.loadData()).toEqual(TREE);
    });

    it('서버도 캐시도 없으면 null 이다 (빈 배열이 아니다 — 호출자가 구분해야 한다)', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.offline();
        expect(await storage.loadData()).toBeNull();
    });
});

describe('saveData — localStorage 는 즉시, 서버는 If-Match 로', () => {
    it('서버 요청 전에 이미 로컬에 써 있다', async () => {
        const { storage, fetch, localStorage } = await freshStorage();
        fetch.reply({ ok: true, revision: 1 });
        const promise = storage.saveData(TREE);
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual(TREE);
        expect(await promise).toEqual({ ok: true });
    });

    it('알고 있는 리비전이 있으면 If-Match 를 보낸다', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.reply({ ok: true, data: TREE, revision: 12 });
        await storage.loadData();
        fetch.reply({ ok: true, revision: 13 });
        await storage.saveData(TREE);
        expect(fetch.calls[1].options.headers['If-Match']).toBe('12');
        expect(storage.getKnownRevision()).toBe(13);
    });

    it('리비전을 모르면 If-Match 없이 보낸다 (첫 저장을 막지 않는다)', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.reply({ ok: true, revision: 1 });
        await storage.saveData(TREE);
        expect(fetch.calls[0].options.headers['If-Match']).toBeUndefined();
    });

    it('409 는 실패가 아니라 충돌이다 — 호출자가 서버 상태를 다시 읽어야 한다', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.fail(409);
        expect(await storage.saveData(TREE)).toEqual({ ok: false, conflict: true });
    });

    it('그 밖의 실패는 { ok:false } 이고 로컬 사본은 남는다', async () => {
        const { storage, fetch, localStorage } = await freshStorage();
        fetch.fail(500);
        expect(await storage.saveData(TREE)).toEqual({ ok: false });
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual(TREE);
    });
});

describe('프로젝트 스코프 — 캐시 키와 epoch 가드', () => {
    it('캐시 키가 프로젝트별로 갈린다', async () => {
        const { storage, fetch, localStorage } = await freshStorage();
        fetch.reply({ ok: true, revision: 1 });
        await storage.saveData(TREE);
        storage.setProject('alpha');
        fetch.reply({ ok: true, revision: 1 });
        await storage.saveData([{ id: 'other', children: [] }]);
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual(TREE);
        expect(JSON.parse(localStorage.getItem('project-timeline-data:alpha'))).toEqual([{ id: 'other', children: [] }]);
    });

    it('프로젝트를 바꾸면 알고 있던 리비전을 버린다 (남의 리비전으로 If-Match 를 보내면 409 다)', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.reply({ ok: true, data: TREE, revision: 5 });
        await storage.loadData();
        expect(storage.getKnownRevision()).toBe(5);
        storage.setProject('alpha');
        expect(storage.getKnownRevision()).toBeNull();
    });

    it('전환 후 도착한 이전 프로젝트의 늦은 응답이 리비전을 오염시키지 않는다', async () => {
        const { storage } = await freshStorage();
        let release;
        // 응답을 손으로 붙잡아 둔다 — 전환보다 늦게 도착시키는 것이 이 검사의 전부다.
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve; })));

        const pending = storage.loadData();          // default 의 로드가 떠 있는 동안
        storage.setProject('alpha');                 // 사용자가 프로젝트를 바꾼다
        release({ ok: true, status: 200, json: async () => ({ ok: true, data: TREE, revision: 99 }) });
        await pending;

        expect(storage.getKnownRevision()).toBeNull(); // 99 가 alpha 의 리비전이 되면 안 된다
    });

    it('늦게 도착한 데이터는 **자기 프로젝트의** 캐시에만 들어간다', async () => {
        const { storage, localStorage } = await freshStorage();
        let release;
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve; })));
        const pending = storage.loadData();
        storage.setProject('alpha');
        release({ ok: true, status: 200, json: async () => ({ ok: true, data: TREE, revision: 99 }) });
        await pending;
        expect(localStorage.getItem('project-timeline-data:alpha')).toBeNull();
        expect(JSON.parse(localStorage.getItem('project-timeline-data:default'))).toEqual(TREE);
    });
});

describe('401 은 오프라인이 아니다', () => {
    it('401 이면 등록된 핸들러를 부른다', async () => {
        const { storage, setUnauthorizedHandler, fetch } = await freshStorage();
        const onUnauthorized = vi.fn();
        setUnauthorizedHandler(onUnauthorized);
        fetch.fail(401);
        await storage.loadData();
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('다른 실패에서는 부르지 않는다 (그건 진짜 오프라인일 수 있다)', async () => {
        const { storage, setUnauthorizedHandler, fetch } = await freshStorage();
        const onUnauthorized = vi.fn();
        setUnauthorizedHandler(onUnauthorized);
        fetch.fail(500);
        await storage.loadData();
        fetch.offline();
        await storage.loadData();
        expect(onUnauthorized).not.toHaveBeenCalled();
    });
});

describe('설정 — 전역이고, 병합해서 저장한다', () => {
    it('기존 설정 위에 병합한다 (부분 저장이 나머지를 지우면 안 된다)', async () => {
        const { storage, fetch, localStorage } = await freshStorage({
            'project-timeline-settings': JSON.stringify({ darkMode: true, zoomLevel: 2 }),
        });
        fetch.reply({ ok: true });
        storage.saveSettings({ zoomLevel: 5 });
        expect(JSON.parse(localStorage.getItem('project-timeline-settings')))
            .toEqual({ darkMode: true, zoomLevel: 5 });
    });

    it('설정 경로는 프로젝트 스코프 밖이다', async () => {
        const { storage, fetch } = await freshStorage();
        storage.setProject('alpha');
        fetch.reply({ ok: true, data: { darkMode: true } });
        await storage.loadSettings();
        expect(fetch.calls[0].url).toBe('/api/settings');
    });

    it('서버가 죽어도 설정 저장이 예외를 던지지 않는다', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.offline();
        expect(() => storage.saveSettings({ darkMode: true })).not.toThrow();
    });
});

describe('스냅샷', () => {
    it('저장하면 로컬 목록 맨 앞에 붙는다', async () => {
        const { storage, fetch, localStorage } = await freshStorage({
            'project-timeline-snapshots:default': JSON.stringify([{ id: 's1', name: '옛것' }]),
        });
        fetch.reply({ ok: true, snapshot: { id: 's2', name: '새것' } });
        expect(await storage.saveSnapshot('새것', TREE)).toBe(true);
        expect(JSON.parse(localStorage.getItem('project-timeline-snapshots:default')).map(s => s.id))
            .toEqual(['s2', 's1']);
    });

    it('서버가 실패하면 로컬 목록을 건드리지 않는다', async () => {
        const { storage, fetch, localStorage } = await freshStorage({
            'project-timeline-snapshots:default': JSON.stringify([{ id: 's1' }]),
        });
        fetch.fail(500);
        expect(await storage.saveSnapshot('새것', TREE)).toBe(false);
        expect(JSON.parse(localStorage.getItem('project-timeline-snapshots:default'))).toEqual([{ id: 's1' }]);
    });

    it('삭제는 로컬에서도 지운다', async () => {
        const { storage, fetch, localStorage } = await freshStorage({
            'project-timeline-snapshots:default': JSON.stringify([{ id: 's1' }, { id: 's2' }]),
        });
        fetch.reply({ ok: true });
        expect(await storage.deleteSnapshot('s1')).toBe(true);
        expect(JSON.parse(localStorage.getItem('project-timeline-snapshots:default'))).toEqual([{ id: 's2' }]);
    });

    it('서버도 캐시도 없으면 빈 배열이다', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.offline();
        expect(await storage.loadSnapshots()).toEqual([]);
    });
});

describe('프로젝트 삭제는 그 프로젝트의 캐시까지 걷어낸다', () => {
    it('남겨 두면 같은 이름으로 다시 만들었을 때 남의 트리가 되살아난다', async () => {
        const { storage, fetch, localStorage } = await freshStorage({
            'project-timeline-data:alpha': JSON.stringify(TREE),
            'project-timeline-snapshots:alpha': JSON.stringify([{ id: 's1' }]),
        });
        fetch.reply({ ok: true });
        await storage.deleteProject('alpha');
        expect(localStorage.getItem('project-timeline-data:alpha')).toBeNull();
        expect(localStorage.getItem('project-timeline-snapshots:alpha')).toBeNull();
    });
});

describe('fetchRevision — 폴링은 실패해도 조용해야 한다', () => {
    it('실패하면 null (예외를 던지면 폴링 타이머가 죽는다)', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.offline();
        expect(await storage.fetchRevision()).toBeNull();
    });

    it('성공하면 숫자', async () => {
        const { storage, fetch } = await freshStorage();
        fetch.reply({ ok: true, revision: 42 });
        expect(await storage.fetchRevision()).toBe(42);
    });
});
