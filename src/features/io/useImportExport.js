// 파일 내보내기 / 가져오기 / HTML 내보내기.
//
// 설정 값은 props 로 받지 않고 스토어 스냅샷을 직접 읽는다 — 내보내기는 "버튼을 누른
// 시점의 설정"만 필요하고, 설정 하나 늘 때마다 의존성 배열을 고치는 일을 없앤다.
import { useCallback, useMemo } from 'react';
import { storage } from '../../utils/storage';
import { migrateTaskData } from '../../utils/dataModel';
import { regenerateIds } from '../../utils/taskTree';
import { getSettingsSnapshot } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';

const EXPORT_VERSION = '1.0';

// 클립보드 API 가 막히면 옛 방식으로 한 번 더 시도한다. API 는 두 경우에 실패한다 —
// http 로 열어 `navigator.clipboard` 자체가 없을 때(보안 컨텍스트 전용), 그리고
// 브라우저가 "사용자 조작 직후"만 허용하는데 모듈 지연 로드를 기다리는 사이 그 창이
// 닫혔을 때(Firefox·Safari). execCommand 는 폐기 예정이지만 두 경우 모두에서 아직 돈다.
const copyText = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            return document.execCommand('copy');
        } catch {
            return false;
        } finally {
            ta.remove();
        }
    }
};

// 내보내기 파일의 meta.viewSettings — 저장 설정 + viewMode(뷰 모드는 서버에 저장되지
// 않지만 파일에는 담아 왔다. 호환을 위해 유지)
const buildMeta = () => ({
    viewSettings: { ...getSettingsSnapshot(), viewMode: useUiStore.getState().viewMode },
    version: EXPORT_VERSION,
});

export function useImportExport({ tasks, setTasks, applySettings, toast }) {
    const openExport = useUiStore(s => s.openExport);
    const customExportData = useUiStore(s => s.customExportData);

    const getExportDataObject = useCallback(() => ({ meta: buildMeta(), data: tasks }), [tasks]);

    const exportToFile = useCallback(() => {
        const payload = customExportData || getExportDataObject();
        const timestamp = new Date().toISOString().slice(0, 10);
        storage.exportData(payload, `project-timeline-${timestamp}.json`);
    }, [getExportDataObject, customExportData]);

    // exporter 모듈은 사용 시점에 지연 로드 — 초기 번들 축소.
    //
    // 실패할 수 있는 곳이 셋이고 전부 **화면에 말해야 한다**. 예전에는 import 와 render 가
    // try 밖이라 둘 중 하나가 던지면 버튼이 아무 반응 없이 죽었다. 그중 흔한 것이 배포
    // 직후다: 청크 이름에 해시가 붙어 있어서, 배포 전에 열어 둔 탭은 이제 없는
    // `htmlExporter-<옛해시>.js` 를 요청하고 404 를 받는다 — 새로고침 말고는 답이 없다.
    const exportToHtml = useCallback(async () => {
        let render;
        try {
            ({ exportToHtml: render } = await import('./htmlExporter'));
        } catch (error) {
            console.error('HTML exporter load failed:', error);
            toast.error('앱이 새 버전으로 업데이트됐습니다. 새로고침(F5) 후 다시 눌러 주세요.');
            return;
        }

        let html;
        try {
            const s = getSettingsSnapshot();
            html = render(tasks, { ...s, dayWidth: s.zoomLevel * 40 });
        } catch (error) {
            console.error('HTML export failed:', error);
            toast.error(`HTML 생성 중 오류가 났습니다: ${error?.message || error}`);
            return;
        }

        if (await copyText(html)) toast.success('HTML 코드가 클립보드에 복사되었습니다!');
        else toast.error('클립보드 복사에 실패했습니다. HTTPS 주소(https://…:8443)로 열었는지 확인해 주세요.');
    }, [tasks, toast]);

    // 스냅샷을 현재 설정과 함께 내보내기 모달로 넘긴다
    const exportSnapshot = useCallback((snapshot) => {
        openExport({ meta: buildMeta(), data: snapshot.data });
    }, [openExport]);

    const processImportedData = useCallback((importedData, isMerge = false) => {
        try {
            let newTasks;
            if (Array.isArray(importedData)) {
                newTasks = importedData;
            } else if (importedData?.data && Array.isArray(importedData.data)) {
                newTasks = importedData.data;
                // 병합이 아니라 교체일 때만 파일의 뷰 설정을 따른다
                if (!isMerge && importedData.meta?.viewSettings) {
                    applySettings(importedData.meta.viewSettings);
                }
            } else {
                throw new Error('Invalid data format');
            }

            // 반드시 정규화한다. 가져온 JSON(사람이 손으로 쓰거나 AI가 만든 것)에는
            // children/timeRanges 가 없을 수 있고, 그러면 트리 조작 헬퍼가 깨진다.
            const normalized = migrateTaskData(newTasks);
            if (isMerge) setTasks(prev => [...prev, ...regenerateIds(normalized)]);
            else setTasks(normalized);
        } catch (error) {
            console.error('Failed to process data:', error);
            toast.error('데이터 처리 중 오류가 발생했습니다.');
        }
    }, [applySettings, setTasks, toast]);

    const importFromFile = useCallback((file, isMerge = false) => {
        storage.importData(file)
            .then(imported => {
                processImportedData(imported, isMerge);
                toast.success(isMerge ? '데이터가 성공적으로 병합되었습니다.' : '데이터를 성공적으로 가져왔습니다.');
            })
            .catch(error => {
                console.error('Failed to import data:', error);
                toast.error('데이터 가져오기에 실패했습니다.');
            });
    }, [processImportedData, toast]);

    // 객체 자체도 안정적이어야 한다 — 단축키 effect 가 이 객체를 의존성으로 쓴다
    return useMemo(() => ({
        getExportDataObject,
        exportToFile,
        exportToHtml,
        exportSnapshot,
        processImportedData,
        importFromFile,
    }), [getExportDataObject, exportToFile, exportToHtml, exportSnapshot,
        processImportedData, importFromFile]);
}
