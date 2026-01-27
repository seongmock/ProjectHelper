// localStorage 관리 유틸리티

const STORAGE_KEY = 'project-timeline-data';
const SETTINGS_KEY = 'project-timeline-settings';
const SNAPSHOTS_KEY = 'project-timeline-snapshots';

export const storage = {
    // 프로젝트 데이터 저장
    saveData: (data) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Failed to save data:', error);
            return false;
        }
    },

    // 프로젝트 데이터 로드
    loadData: () => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Failed to load data:', error);
            return null;
        }
    },

    // 설정 저장
    saveSettings: (settings) => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    },

    // 설정 로드
    loadSettings: () => {
        try {
            const settings = localStorage.getItem(SETTINGS_KEY);
            return settings ? JSON.parse(settings) : null;
        } catch (error) {
            console.error('Failed to load settings:', error);
            return null;
        }
    },

    // 데이터 내보내기 (JSON 파일)
    exportData: (data, filename = 'project-timeline.json') => {
        try {
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
            return true;
        } catch (error) {
            console.error('Failed to export data:', error);
            return false;
        }
    },

    // 데이터 가져오기 (JSON 파일)
    importData: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    },

    // 모든 데이터 삭제
    clearAll: () => {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem(SNAPSHOTS_KEY);
            return true;
        } catch (error) {
            console.error('Failed to clear data:', error);
            return false;
        }
    },

    // 스냅샷 저장
    saveSnapshot: (name, data) => {
        try {
            const snapshots = storage.loadSnapshots();
            const newSnapshot = {
                id: Date.now().toString(),
                name,
                date: new Date().toISOString(),
                data
            };
            snapshots.unshift(newSnapshot); // 최신순
            localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
            return true;
        } catch (error) {
            console.error('Failed to save snapshot:', error);
            return false;
        }
    },

    // 스냅샷 목록 로드 (메타데이터만 반환 권장하지만 로컬스토리지는 다 불러와짐. 일단 다 반환)
    loadSnapshots: () => {
        try {
            const saved = localStorage.getItem(SNAPSHOTS_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load snapshots:', error);
            return [];
        }
    },

    // 스냅샷 삭제
    deleteSnapshot: (id) => {
        try {
            const snapshots = storage.loadSnapshots();
            const filtered = snapshots.filter(s => s.id !== id);
            localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(filtered));
            return true;
        } catch (error) {
            console.error('Failed to delete snapshot:', error);
            return false;
        }
    },

    // 스냅샷 업데이트
    updateSnapshot: (id, data) => {
        try {
            const snapshots = storage.loadSnapshots();
            const index = snapshots.findIndex(s => s.id === id);

            if (index === -1) return false;

            // 업데이트: 데이터 교체 및 날짜 갱신 (이름은 유지하거나 변경 가능하지만 여기선 유지)
            snapshots[index] = {
                ...snapshots[index],
                date: new Date().toISOString(),
                data
            };

            // 최신순 정렬 (업데이트된 항목을 맨 위로?)
            // 선택 사항이지만, 보통 최근 수정된게 위로 오는게 좋음.
            const updatedItem = snapshots.splice(index, 1)[0];
            snapshots.unshift(updatedItem);

            localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
            return true;
        } catch (error) {
            console.error('Failed to update snapshot:', error);
            return false;
        }
    }
};
