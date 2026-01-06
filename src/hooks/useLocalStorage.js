// localStorage와 동기화되는 상태 관리 훅

import { useState, useEffect } from 'react';

export const useLocalStorage = (key, initialValue) => {
    // 초기값 로드
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(`Error loading ${key} from localStorage:`, error);
            return initialValue;
        }
    });

    // 값 설정 및 localStorage 업데이트
    const setValue = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(`Error saving ${key} to localStorage:`, error);
        }
    };

    return [storedValue, setValue];
};
