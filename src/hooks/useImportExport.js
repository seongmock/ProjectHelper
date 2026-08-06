// 파일 내보내기 / 가져오기 / HTML 내보내기.
//
// 설정 값은 props 로 받지 않고 스토어 스냅샷을 직접 읽는다 — 내보내기는 "버튼을 누른
// 시점의 설정"만 필요하고, 설정 하나 늘 때마다 의존성 배열을 고치는 일을 없앤다.
import { useCallback, useMemo } from 'react';
import { storage } from '../utils/storage';
import { migrateTaskData } from '../utils/dataModel';
import { regenerateIds } from '../utils/taskTree';
import { getSettingsSnapshot } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';

const EXPORT_VERSION = '1.0';

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

    // exporter 모듈은 사용 시점에 지연 로드 — 초기 번들 축소
    const exportToHtml = useCallback(async () => {
        const { exportToHtml: render } = await import('../utils/htmlExporter');
        const s = getSettingsSnapshot();
        const html = render(tasks, { ...s, dayWidth: s.zoomLevel * 40 });
        try {
            await navigator.clipboard.writeText(html);
            toast.success('HTML 코드가 클립보드에 복사되었습니다!');
        } catch {
            toast.error('클립보드 복사에 실패했습니다.');
        }
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
