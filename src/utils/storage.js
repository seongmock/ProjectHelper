// localStorage 관리 유틸리티

const STORAGE_KEY = 'project-timeline-data';
const SETTINGS_KEY = 'project-timeline-settings';

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
            return true;
        } catch (error) {
            console.error('Failed to clear data:', error);
            return false;
        }
    },
};
