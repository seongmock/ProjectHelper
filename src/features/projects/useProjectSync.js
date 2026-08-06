// 서버 동기화 오케스트레이션 — 초기 로드 · 자동저장 · 리비전 폴링 · 프로젝트 전환.
//
// App.jsx 에 흩어져 있던 effect 4개와 프로젝트 핸들러 4개를 한 곳에 모았다. 이것들은
// 서로 순서 의존이 있어서(아래 handleSwitchProject 주석 참조) 떨어져 있으면 위험하다.
//
// ── 왜 TanStack Query 를 쓰지 않았나 ────────────────────────────────────────
// 실사 보고서는 "서버 상태 = TanStack Query"를 제안했지만 이 앱에는 맞지 않는다:
//   - 서버 리소스가 사실상 1개(작업 트리)이고, TQ 의 주 가치인 다중 쿼리 캐시 관리가
//     필요 없다
//   - storage.js 는 If-Match 기반 낙관적 동시성(409 → 서버 우선 재로드)과
//     네트워크 실패 시 localStorage 폴백을 구현한다. TQ 는 둘 다 기본 제공하지 않아
//     결국 queryFn 으로 storage.js 를 감싸는 껍데기가 되거나, 오프라인 폴백을
//     재작성해야 한다 — 그 경로에는 테스트가 없어 회귀를 감지할 수단이 없다
// 얻으려던 것(App.jsx 축소, 동기화 로직 격리)은 이 훅으로 충분히 달성된다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../../utils/storage';
import { migrateTaskData } from '../../utils/dataModel';

const ACTIVE_PROJECT_KEY = 'project-timeline-active-project';
const AUTOSAVE_DEBOUNCE_MS = 1500; // 키 입력/드래그마다 서버 요청을 보내지 않기 위함
const REVISION_POLL_MS = 10000;

const readActiveProjectId = () => {
    try {
        return localStorage.getItem(ACTIVE_PROJECT_KEY) || 'default';
    } catch {
        return 'default';
    }
};

const rememberActiveProjectId = (pid) => {
    try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, pid);
    } catch { /* localStorage 불가 환경 무시 */ }
};

// 서버 응답에서 작업 배열을 꺼낸다 — 과거 형식({data:[...]})과 bare array 모두 지원
const toTaskArray = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return null;
};

export function useProjectSync({ tasks, setTasks, setTasksSilent, resetTasks, applySettings, toast, onProjectSwitched }) {
    const [isLoading, setIsLoading] = useState(true);
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectId] = useState(readActiveProjectId);

    const isSwitchingRef = useRef(false); // 전환 중 재진입 방지
    const dirtyRef = useRef(false);       // 디바운스 예약됐지만 아직 flush 안 된 편집 존재
    const saveTimerRef = useRef(null);    // 예약된 디바운스 타이머 (전환 시 동기 취소용)
    const skipNextSaveRef = useRef(false); // 외부 변경 재로드 직후 저장 에코 방지

    // 서버 데이터를 undo 히스토리 오염 없이 반영 (외부 변경 수신용)
    const reloadFromServer = useCallback(async () => {
        const data = toTaskArray(await storage.loadData());
        if (!data) return;
        skipNextSaveRef.current = true;
        setTasksSilent(() => migrateTaskData(data));
    }, [setTasksSilent]);

    // ── 초기 로드 ────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                // 1) 프로젝트 목록 해석 (저장된 활성 프로젝트 검증, 없으면 default → 첫 항목)
                let list;
                try {
                    list = await storage.listProjects();
                } catch {
                    list = [{ id: 'default', name: '기본 프로젝트' }]; // 오프라인 폴백
                }
                setProjects(list);

                const saved = readActiveProjectId();
                const resolved = list.find(p => p.id === saved)
                    ?? list.find(p => p.id === 'default')
                    ?? list[0];
                setActiveProjectId(resolved.id);
                rememberActiveProjectId(resolved.id);
                storage.setProject(resolved.id); // loadData 전에 스코프 설정

                // 2) 데이터/설정 로드
                const [serverData, serverSettings] = await Promise.all([
                    storage.loadData(),
                    storage.loadSettings(),
                ]);

                applySettings(serverSettings);
                const data = toTaskArray(serverData);
                if (data) setTasks(migrateTaskData(data));
            } finally {
                setIsLoading(false);
            }
        })();
        // 마운트 시 1회만 — 의존성을 넣으면 재로드 루프가 된다
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 자동 저장 (디바운스) ─────────────────────────
    // 409(리비전 충돌) 시 서버 우선 정책: 외부(AI) 변경을 다시 로드해 반영
    useEffect(() => {
        if (isLoading) return; // 초기 로드 중에는 저장하지 않음
        if (skipNextSaveRef.current) {
            skipNextSaveRef.current = false;
            return;
        }
        dirtyRef.current = true;
        saveTimerRef.current = setTimeout(async () => {
            const result = await storage.saveData(tasks);
            if (result?.ok) dirtyRef.current = false;
            if (result?.conflict) {
                toast.info('외부에서 데이터가 변경되어 최신 상태를 불러왔습니다.');
                await reloadFromServer();
            }
        }, AUTOSAVE_DEBOUNCE_MS);
        return () => clearTimeout(saveTimerRef.current);
    }, [tasks, isLoading, reloadFromServer, toast]);

    // ── 리비전 폴링 ──────────────────────────────────
    // 외부(AI API)가 데이터를 변경하면 10초 내 자동 반영.
    // activeProjectId 의존: 프로젝트 전환 시 인터벌 재생성 — storage가 새 스코프를 폴링
    useEffect(() => {
        if (isLoading) return;
        const id = setInterval(async () => {
            if (document.hidden) return; // 백그라운드 탭은 폴링 생략
            const rev = await storage.fetchRevision();
            const known = storage.getKnownRevision();
            if (rev != null && known != null && rev !== known) await reloadFromServer();
        }, REVISION_POLL_MS);
        return () => clearInterval(id);
    }, [isLoading, reloadFromServer, activeProjectId]);

    // ── 프로젝트 전환 ────────────────────────────────
    // 순서가 중요하다:
    // (1) 예약된 디바운스 저장을 동기적으로 취소 (새 프로젝트로의 유입 차단)
    // (2) isLoading 으로 저장/폴링 게이트
    // (3) 미저장 편집(dirty)이 있으면 이전 프로젝트에 flush
    //     (취소만 하면 최근 1.5초 편집이 유실된다)
    // (4) 스코프 전환 → (5) 새 데이터 로드 → (6) undo 히스토리 리셋
    //     리셋을 빠뜨리면 Ctrl+Z 가 이전 프로젝트 트리를 복원해 새 프로젝트에 저장된다
    const switchProject = useCallback(async (nextPid) => {
        if (nextPid === activeProjectId || isSwitchingRef.current) return;
        isSwitchingRef.current = true;
        clearTimeout(saveTimerRef.current);
        setIsLoading(true);
        try {
            if (dirtyRef.current) {
                const r = await storage.saveData(tasks);
                if (r?.conflict) toast.info('이전 프로젝트에 외부 변경이 있어 서버 상태가 유지됩니다.');
                dirtyRef.current = false;
            }
            storage.setProject(nextPid);
            setActiveProjectId(nextPid);
            rememberActiveProjectId(nextPid);

            const data = toTaskArray(await storage.loadData());
            skipNextSaveRef.current = true;
            resetTasks(migrateTaskData(data ?? []));
            onProjectSwitched?.();
        } finally {
            setIsLoading(false);
            isSwitchingRef.current = false;
        }
    }, [activeProjectId, tasks, toast, resetTasks, onProjectSwitched]);

    // ── 프로젝트 CRUD ────────────────────────────────
    const refreshProjects = useCallback(async () => {
        try {
            setProjects(await storage.listProjects());
        } catch { /* 오프라인 — 기존 목록 유지 */ }
    }, []);

    const createProject = useCallback(async (name) => {
        try {
            const p = await storage.createProject(name);
            await refreshProjects();
            await switchProject(p.id);
            toast.success(`'${name}' 프로젝트가 생성되었습니다.`);
        } catch {
            toast.error('프로젝트 생성에 실패했습니다.');
        }
    }, [refreshProjects, switchProject, toast]);

    const renameProject = useCallback(async (pid, name) => {
        try {
            await storage.renameProject(pid, name);
            await refreshProjects();
        } catch {
            toast.error('이름 변경에 실패했습니다.');
        }
    }, [refreshProjects, toast]);

    const deleteProject = useCallback(async (pid) => {
        try {
            await storage.deleteProject(pid);
        } catch (e) {
            if (e.status === 400) toast.warn('마지막 프로젝트는 삭제할 수 없습니다.');
            else toast.error('프로젝트 삭제에 실패했습니다.');
            return;
        }
        // setProjects 업데이터 안에서 전환을 호출하면 StrictMode 의 이중 호출로
        // 전환이 두 번 실행된다 — 업데이터는 순수하게 두고 밖에서 처리한다.
        const remaining = projects.filter(p => p.id !== pid);
        setProjects(remaining);
        toast.success('프로젝트가 삭제되었습니다.');
        if (pid === activeProjectId && remaining.length > 0) {
            await switchProject(remaining[0].id);
        }
    }, [projects, activeProjectId, switchProject, toast]);

    return {
        isLoading,
        projects,
        activeProjectId,
        switchProject,
        createProject,
        renameProject,
        deleteProject,
        refreshProjects,
    };
}
